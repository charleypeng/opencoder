//! Server registry (TASK-M1-03) and per-server health monitoring
//! (TASK-M1-04).
//!
//! Pure in-memory registry core (CRUD + serialization, no Tauri
//! dependencies) plus the managed wrapper that persists changes through a
//! [`ServerStore`] and notifies the frontend with `servers-changed` events.
//! The transport channels (http.rs / sse.rs) resolve server base URLs through
//! this registry instead of the M1-01 placeholder map. The health monitor
//! (health.rs) polls each server and emits `server-health` snapshots.

pub mod health;
pub mod oauth;
pub mod registry;
pub mod store;

use crate::connections::registry::{
    RegistryError, ServerEntry, ServerEntryInput, ServerOAuth, ServerRegistryCore,
};
use crate::connections::store::{PersistError, ServerStore};
use std::sync::Mutex;
use tauri::Emitter;

/// Managed server registry: all mutations persist through the backing store
/// and announce the new list to the frontend. Generic over the Tauri
/// runtime so tests can drive it with the mock runtime.
pub struct ServerRegistry<R: tauri::Runtime> {
    core: Mutex<ServerRegistryCore>,
    store: Box<dyn ServerStore>,
    app: tauri::AppHandle<R>,
}

impl ServerRegistry<tauri::Wry> {
    /// Loads the persisted entries (empty on first run) and returns a
    /// registry ready to serve commands.
    pub fn load(app: &tauri::AppHandle<tauri::Wry>) -> Result<Self, PersistError> {
        let store = store::PluginServerStore::open(app)?;
        Self::load_with(Box::new(store), app)
    }
}

impl<R: tauri::Runtime> ServerRegistry<R> {
    /// Loads a registry through an arbitrary store; `load` uses the plugin
    /// store, tests inject in-memory or failing ones.
    ///
    /// A missing store file is reported as an empty list by the store
    /// itself. A store file that exists but cannot be parsed (e.g. corrupt
    /// JSON) is reported with a warning and treated as empty as well; the
    /// file is deliberately left in place so an unreadable startup never
    /// destroys the user's data — the next successful persist overwrites
    /// it.
    pub(crate) fn load_with(
        store: Box<dyn ServerStore>,
        app: &tauri::AppHandle<R>,
    ) -> Result<Self, PersistError> {
        let entries = match store.load() {
            Ok(entries) => entries,
            Err(err) => {
                eprintln!(
                    "server registry: failed to load persisted servers ({err}); starting with an empty list, leaving the store file untouched"
                );
                Vec::new()
            }
        };
        Ok(Self {
            core: Mutex::new(ServerRegistryCore::from_entries(entries)),
            store,
            app: app.clone(),
        })
    }

    /// Locks the core, recovering from a poisoned mutex (a panicked holder)
    /// so one failed mutation cannot wedge the registry.
    fn lock(&self) -> std::sync::MutexGuard<'_, ServerRegistryCore> {
        self.core
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn list(&self) -> Vec<ServerEntry> {
        self.lock().list()
    }

    pub fn get(&self, id: &str) -> Option<ServerEntry> {
        self.lock().get(id)
    }

    /// Base URL of the server with the given id; used by the transport
    /// channels to resolve `serverID`-based requests.
    pub fn resolve_base_url(&self, id: &str) -> Option<String> {
        self.lock().resolve_base_url(id)
    }

    /// Applies a mutation to a clone of the entries, persists the clone
    /// first and only commits it to memory on success, so a failed persist
    /// never leaves the mutation visible while the caller got an error.
    pub fn add(&self, input: ServerEntryInput) -> Result<ServerEntry, RegistryError> {
        let mut core = self.lock();
        let mut next = ServerRegistryCore::from_entries(core.list());
        let entry = next.add(input);
        self.persist_entries(&next.list())
            .map_err(|err| RegistryError::Persist(err.to_string()))?;
        *core = next;
        Ok(entry)
    }

    pub fn update(
        &self,
        id: String,
        input: ServerEntryInput,
    ) -> Result<ServerEntry, RegistryError> {
        let mut core = self.lock();
        let mut next = ServerRegistryCore::from_entries(core.list());
        let entry = next.update(&id, input)?;
        self.persist_entries(&next.list())
            .map_err(|err| RegistryError::Persist(err.to_string()))?;
        *core = next;
        Ok(entry)
    }

    pub fn remove(&self, id: String) -> Result<(), RegistryError> {
        let mut core = self.lock();
        let mut next = ServerRegistryCore::from_entries(core.list());
        next.remove(&id)?;
        self.persist_entries(&next.list())
            .map_err(|err| RegistryError::Persist(err.to_string()))?;
        *core = next;
        Ok(())
    }

    /// Stores (or clears) the OAuth credentials of a server through the
    /// same persist-first discipline as the other mutations.
    pub fn set_oauth(&self, id: String, oauth: Option<ServerOAuth>) -> Result<(), RegistryError> {
        let mut core = self.lock();
        let mut next = ServerRegistryCore::from_entries(core.list());
        next.set_oauth(&id, oauth)?;
        self.persist_entries(&next.list())
            .map_err(|err| RegistryError::Persist(err.to_string()))?;
        *core = next;
        Ok(())
    }

    /// Marks the server as last connected at the current time (used by the
    /// health monitor in M1-04).
    pub fn touch_last_connected(&self, id: String) -> Result<(), RegistryError> {
        self.lock().touch_last_connected(&id)?;
        self.persist()
            .map_err(|err| RegistryError::Persist(err.to_string()))
    }

    /// Writes the given list through the store and broadcasts it; a failed
    /// emit (e.g. WebView already gone) is ignored.
    fn persist_entries(&self, entries: &[ServerEntry]) -> Result<(), PersistError> {
        self.store.save(entries)?;
        let _ = self.app.emit("servers-changed", entries);
        Ok(())
    }

    /// Writes the current list through the store and broadcasts it.
    fn persist(&self) -> Result<(), PersistError> {
        let entries = self.lock().list();
        self.persist_entries(&entries)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connections::store::JsonFileStore;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_path() -> PathBuf {
        let counter = TEST_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "opencoder-registry-test-{}-{counter}.json",
            std::process::id()
        ))
    }

    fn input(name: &str, url: &str) -> ServerEntryInput {
        ServerEntryInput {
            name: name.to_string(),
            url: url.to_string(),
            username: Some("admin".to_string()),
            password: Some("secret".to_string()),
        }
    }

    fn entry(id: &str) -> ServerEntry {
        ServerEntry {
            id: id.to_string(),
            name: "dev".to_string(),
            url: "http://localhost:14096".to_string(),
            username: Some("admin".to_string()),
            password: Some("secret".to_string()),
            oauth: None,
            created_at: 1_700_000_000_000,
            last_connected_at: Some(1_700_000_060_000),
        }
    }

    fn mock_app() -> tauri::AppHandle<tauri::test::MockRuntime> {
        tauri::test::mock_app().handle().clone()
    }

    /// Store whose `save` always fails, simulating a full disk or a broken
    /// plugin; `load` returns the seeded entries.
    struct FailingStore {
        seeded: Vec<ServerEntry>,
    }

    impl ServerStore for FailingStore {
        fn load(&self) -> Result<Vec<ServerEntry>, PersistError> {
            Ok(self.seeded.clone())
        }

        fn save(&self, _entries: &[ServerEntry]) -> Result<(), PersistError> {
            Err(PersistError::Io(std::io::Error::other(
                "simulated persist failure",
            )))
        }
    }

    #[test]
    fn load_with_corrupt_file_starts_empty_and_preserves_the_file() {
        let path = temp_path();
        std::fs::write(&path, "{not json").unwrap();
        let store = JsonFileStore::new(path.clone());
        let registry = ServerRegistry::load_with(Box::new(store), &mock_app()).unwrap();
        assert!(registry.list().is_empty());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{not json");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn add_with_failing_store_keeps_the_list_unchanged() {
        let registry =
            ServerRegistry::load_with(Box::new(FailingStore { seeded: Vec::new() }), &mock_app())
                .unwrap();
        let result = registry.add(input("dev", "http://localhost:14096"));
        assert!(matches!(result, Err(RegistryError::Persist(_))));
        assert!(registry.list().is_empty());
    }

    #[test]
    fn update_with_failing_store_keeps_the_list_unchanged() {
        let seeded = vec![entry("srv_1")];
        let registry = ServerRegistry::load_with(
            Box::new(FailingStore {
                seeded: seeded.clone(),
            }),
            &mock_app(),
        )
        .unwrap();
        let result = registry.update("srv_1".to_string(), input("prod", "https://example.com"));
        assert!(matches!(result, Err(RegistryError::Persist(_))));
        assert_eq!(registry.list(), seeded);
    }

    #[test]
    fn remove_with_failing_store_keeps_the_list_unchanged() {
        let seeded = vec![entry("srv_1")];
        let registry = ServerRegistry::load_with(
            Box::new(FailingStore {
                seeded: seeded.clone(),
            }),
            &mock_app(),
        )
        .unwrap();
        let result = registry.remove("srv_1".to_string());
        assert!(matches!(result, Err(RegistryError::Persist(_))));
        assert_eq!(registry.list(), seeded);
    }
}
