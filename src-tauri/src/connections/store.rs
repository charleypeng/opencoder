//! Persistence for the server registry (TASK-M1-03).
//!
//! Production persistence goes through tauri-plugin-store (a key-value JSON
//! file under the app data dir); tests use a plain JSON file implementation
//! behind the same [`ServerStore`] abstraction so the format contract is
//! exercised without a Tauri runtime.

use crate::connections::registry::ServerEntry;
use std::fmt;
use std::sync::Arc;
use tauri::AppHandle;
use tauri_plugin_store::{Store, StoreExt};

#[cfg(test)]
use std::path::PathBuf;

/// Failures of the backing store.
#[derive(Debug)]
pub enum PersistError {
    Io(std::io::Error),
    Json(serde_json::Error),
    Plugin(String),
}

impl fmt::Display for PersistError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PersistError::Io(err) => write!(formatter, "io error: {err}"),
            PersistError::Json(err) => write!(formatter, "invalid store contents: {err}"),
            PersistError::Plugin(err) => write!(formatter, "store plugin error: {err}"),
        }
    }
}

impl std::error::Error for PersistError {}

/// Abstraction over the on-disk store so the registry can be tested without
/// a Tauri runtime. A missing file (first run) yields an empty list.
pub(crate) trait ServerStore: Send + Sync {
    fn load(&self) -> Result<Vec<ServerEntry>, PersistError>;
    fn save(&self, entries: &[ServerEntry]) -> Result<(), PersistError>;
}

/// Plain JSON file store (test utility: entries are serialized as an array
/// of [`ServerEntry`] values) exercising the same [`ServerStore`] contract as
/// the production plugin-backed store.
#[cfg(test)]
pub(crate) struct JsonFileStore {
    path: PathBuf,
}

#[cfg(test)]
impl JsonFileStore {
    pub(crate) fn new(path: PathBuf) -> Self {
        Self { path }
    }
}

#[cfg(test)]
impl ServerStore for JsonFileStore {
    fn load(&self) -> Result<Vec<ServerEntry>, PersistError> {
        match std::fs::read_to_string(&self.path) {
            Ok(contents) => serde_json::from_str(&contents).map_err(PersistError::Json),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(err) => Err(PersistError::Io(err)),
        }
    }

    fn save(&self, entries: &[ServerEntry]) -> Result<(), PersistError> {
        let json = serde_json::to_string_pretty(entries).map_err(PersistError::Json)?;
        std::fs::write(&self.path, json).map_err(PersistError::Io)
    }
}

/// Store backed by tauri-plugin-store (production): the entries live under
/// the `servers` key of the plugin's JSON file.
pub(crate) struct PluginServerStore {
    store: Arc<Store<tauri::Wry>>,
}

impl PluginServerStore {
    /// Opens the `servers.json` store file (created on first run).
    pub(crate) fn open(app: &AppHandle) -> Result<Self, PersistError> {
        let store = app
            .store("servers.json")
            .map_err(|err| PersistError::Plugin(err.to_string()))?;
        Ok(Self { store })
    }
}

impl ServerStore for PluginServerStore {
    fn load(&self) -> Result<Vec<ServerEntry>, PersistError> {
        match self.store.get("servers") {
            Some(value) => serde_json::from_value(value).map_err(PersistError::Json),
            None => Ok(Vec::new()),
        }
    }

    fn save(&self, entries: &[ServerEntry]) -> Result<(), PersistError> {
        let value = serde_json::to_value(entries).map_err(PersistError::Json)?;
        self.store.set("servers", value);
        self.store
            .save()
            .map_err(|err| PersistError::Plugin(err.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_path() -> PathBuf {
        let counter = TEST_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "opencoder-store-test-{}-{counter}.json",
            std::process::id()
        ))
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

    #[test]
    fn save_then_load_round_trip() {
        let path = temp_path();
        let store = JsonFileStore::new(path.clone());
        store.save(&[entry("a"), entry("b")]).unwrap();
        assert_eq!(store.load().unwrap(), vec![entry("a"), entry("b")]);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn load_missing_file_returns_empty() {
        let path = temp_path();
        let store = JsonFileStore::new(path);
        assert_eq!(store.load().unwrap(), Vec::new());
    }

    #[test]
    fn save_overwrites_the_previous_list() {
        let path = temp_path();
        let store = JsonFileStore::new(path.clone());
        store.save(&[entry("a")]).unwrap();
        store.save(&[entry("b")]).unwrap();
        assert_eq!(store.load().unwrap(), vec![entry("b")]);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn file_contains_camel_case_fields() {
        let path = temp_path();
        let store = JsonFileStore::new(path.clone());
        store.save(&[entry("a")]).unwrap();
        let contents = std::fs::read_to_string(&path).unwrap();
        assert!(contents.contains("\"createdAt\""));
        assert!(contents.contains("\"lastConnectedAt\""));
        assert!(!contents.contains("created_at"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn corrupt_file_is_a_load_error() {
        let path = temp_path();
        std::fs::write(&path, "{not json").unwrap();
        let store = JsonFileStore::new(path.clone());
        assert!(matches!(store.load(), Err(PersistError::Json(_))));
        let _ = std::fs::remove_file(path);
    }
}
