//! Server registry (TASK-M1-03).
//!
//! Pure in-memory registry core (CRUD + serialization, no Tauri
//! dependencies) plus the managed wrapper that persists changes through a
//! [`ServerStore`] and notifies the frontend with `servers-changed` events.
//! The transport channels (http.rs / sse.rs) resolve server base URLs through
//! this registry instead of the M1-01 placeholder map.

pub mod registry;
pub mod store;

use crate::connections::registry::{
    RegistryError, ServerEntry, ServerEntryInput, ServerRegistryCore,
};
use crate::connections::store::{PersistError, ServerStore};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

/// Managed server registry: all mutations persist through the backing store
/// and announce the new list to the frontend.
pub struct ServerRegistry {
    core: Mutex<ServerRegistryCore>,
    store: Box<dyn ServerStore>,
    app: AppHandle,
}

impl ServerRegistry {
    /// Loads the persisted entries (empty on first run) and returns a
    /// registry ready to serve commands.
    pub fn load(app: &AppHandle) -> Result<Self, PersistError> {
        let store = store::PluginServerStore::open(app)?;
        let entries = store.load().unwrap_or_default();
        Ok(Self {
            core: Mutex::new(ServerRegistryCore::from_entries(entries)),
            store: Box::new(store),
            app: app.clone(),
        })
    }

    pub fn list(&self) -> Vec<ServerEntry> {
        self.core.lock().unwrap().list()
    }

    pub fn get(&self, id: &str) -> Option<ServerEntry> {
        self.core.lock().unwrap().get(id)
    }

    /// Base URL of the server with the given id; used by the transport
    /// channels to resolve `serverID`-based requests.
    pub fn resolve_base_url(&self, id: &str) -> Option<String> {
        self.core.lock().unwrap().resolve_base_url(id)
    }

    pub fn add(&self, input: ServerEntryInput) -> Result<ServerEntry, RegistryError> {
        let entry = self.core.lock().unwrap().add(input);
        self.persist()
            .map_err(|err| RegistryError::Persist(err.to_string()))?;
        Ok(entry)
    }

    pub fn update(
        &self,
        id: String,
        input: ServerEntryInput,
    ) -> Result<ServerEntry, RegistryError> {
        let entry = self.core.lock().unwrap().update(&id, input)?;
        self.persist()
            .map_err(|err| RegistryError::Persist(err.to_string()))?;
        Ok(entry)
    }

    pub fn remove(&self, id: String) -> Result<(), RegistryError> {
        self.core.lock().unwrap().remove(&id)?;
        self.persist()
            .map_err(|err| RegistryError::Persist(err.to_string()))
    }

    /// Marks the server as last connected at the current time (used by the
    /// health monitor in M1-04).
    pub fn touch_last_connected(&self, id: String) -> Result<(), RegistryError> {
        self.core.lock().unwrap().touch_last_connected(&id)?;
        self.persist()
            .map_err(|err| RegistryError::Persist(err.to_string()))
    }

    /// Writes the current list through the store and broadcasts it; a failed
    /// emit (e.g. WebView already gone) is ignored.
    fn persist(&self) -> Result<(), PersistError> {
        let entries = self.core.lock().unwrap().list();
        self.store.save(&entries)?;
        let _ = self.app.emit("servers-changed", &entries);
        Ok(())
    }
}
