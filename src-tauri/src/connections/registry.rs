//! Pure server registry core (TASK-M1-03).
//!
//! No Tauri dependencies: CRUD + serialization live here so the whole
//! registry can be unit-tested without an app runtime. The managed wrapper
//! (mod.rs) adds persistence and sync events around this core.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// A saved server connection. Timestamps are epoch milliseconds.
///
/// `password` currently lives in the same store file as the rest of the
/// entry; hardening it with a separate encrypted slot or the OS keyring
/// lands in a later task.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerEntry {
    pub id: String,
    pub name: String,
    pub url: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub created_at: i64,
    pub last_connected_at: Option<i64>,
}

/// User-supplied fields of a server entry; id and timestamps are generated
/// by the registry.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerEntryInput {
    pub name: String,
    pub url: String,
    pub username: Option<String>,
    pub password: Option<String>,
}

/// Failures of registry mutations.
#[derive(Debug, Clone, PartialEq)]
pub enum RegistryError {
    /// No entry with the given id exists.
    NotFound(String),
    /// The backing store rejected the mutation.
    Persist(String),
}

/// In-memory server registry with all CRUD operations; mutations are applied
/// in place and serialized with camelCase field names.
#[derive(Debug, Default)]
pub struct ServerRegistryCore {
    entries: Vec<ServerEntry>,
}

impl ServerRegistryCore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Rebuilds the core from persisted entries (load path).
    pub fn from_entries(entries: Vec<ServerEntry>) -> Self {
        Self { entries }
    }

    pub fn list(&self) -> Vec<ServerEntry> {
        self.entries.clone()
    }

    pub fn get(&self, id: &str) -> Option<ServerEntry> {
        self.entries.iter().find(|entry| entry.id == id).cloned()
    }

    /// Base URL of the server with the given id, used to resolve
    /// `serverID`-based transport requests.
    pub fn resolve_base_url(&self, id: &str) -> Option<String> {
        self.get(id).map(|entry| entry.url)
    }

    /// Inserts a new entry with a generated id and creation timestamp.
    pub fn add(&mut self, input: ServerEntryInput) -> ServerEntry {
        let entry = ServerEntry {
            id: new_id(),
            name: input.name,
            url: input.url,
            username: input.username,
            password: input.password,
            created_at: now_millis(),
            last_connected_at: None,
        };
        self.entries.push(entry.clone());
        entry
    }

    /// Replaces the user-supplied fields of the entry with the given id;
    /// timestamps are preserved.
    pub fn update(
        &mut self,
        id: &str,
        input: ServerEntryInput,
    ) -> Result<ServerEntry, RegistryError> {
        let entry = self
            .entries
            .iter_mut()
            .find(|entry| entry.id == id)
            .ok_or_else(|| RegistryError::NotFound(id.to_string()))?;
        entry.name = input.name;
        entry.url = input.url;
        entry.username = input.username;
        entry.password = input.password;
        Ok(entry.clone())
    }

    pub fn remove(&mut self, id: &str) -> Result<ServerEntry, RegistryError> {
        let index = self
            .entries
            .iter()
            .position(|entry| entry.id == id)
            .ok_or_else(|| RegistryError::NotFound(id.to_string()))?;
        Ok(self.entries.remove(index))
    }

    pub fn touch_last_connected(&mut self, id: &str) -> Result<(), RegistryError> {
        let entry = self
            .entries
            .iter_mut()
            .find(|entry| entry.id == id)
            .ok_or_else(|| RegistryError::NotFound(id.to_string()))?;
        entry.last_connected_at = Some(now_millis());
        Ok(())
    }
}

/// Monotonic per-process counter; combined with the epoch millis it keeps ids
/// unique within a process and practically unique across restarts.
static NEXT_ID: AtomicU64 = AtomicU64::new(0);

fn new_id() -> String {
    let millis = now_millis();
    let counter = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    format!("srv_{millis:013x}_{counter:x}")
}

/// Shared by the registry and the health monitor (TASK-M1-04) for timestamp
/// fields.
pub(crate) fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(name: &str, url: &str) -> ServerEntryInput {
        ServerEntryInput {
            name: name.to_string(),
            url: url.to_string(),
            username: Some("admin".to_string()),
            password: Some("secret".to_string()),
        }
    }

    #[test]
    fn add_then_list_round_trip() {
        let mut core = ServerRegistryCore::new();
        let entry = core.add(input("dev", "http://localhost:14096"));
        assert_eq!(core.list(), vec![entry]);
    }

    #[test]
    fn get_returns_none_for_unknown_id() {
        let core = ServerRegistryCore::new();
        assert_eq!(core.get("nope"), None);
    }

    #[test]
    fn update_replaces_user_fields_and_keeps_timestamps() {
        let mut core = ServerRegistryCore::new();
        let entry = core.add(input("dev", "http://localhost:14096"));
        let updated = core
            .update(
                &entry.id,
                ServerEntryInput {
                    name: "prod".to_string(),
                    url: "https://opencode.example.com".to_string(),
                    username: None,
                    password: None,
                },
            )
            .unwrap();
        assert_eq!(updated.name, "prod");
        assert_eq!(updated.url, "https://opencode.example.com");
        assert_eq!(updated.username, None);
        assert_eq!(updated.password, None);
        assert_eq!(updated.created_at, entry.created_at);
        assert_eq!(updated.last_connected_at, None);
    }

    #[test]
    fn update_unknown_id_is_not_found() {
        let mut core = ServerRegistryCore::new();
        assert_eq!(
            core.update("nope", input("x", "http://localhost:1")),
            Err(RegistryError::NotFound("nope".to_string()))
        );
    }

    #[test]
    fn remove_deletes_the_entry() {
        let mut core = ServerRegistryCore::new();
        let entry = core.add(input("dev", "http://localhost:14096"));
        assert_eq!(core.remove(&entry.id), Ok(entry.clone()));
        assert_eq!(core.list(), Vec::new());
    }

    #[test]
    fn remove_unknown_id_is_not_found() {
        let mut core = ServerRegistryCore::new();
        assert_eq!(
            core.remove("nope"),
            Err(RegistryError::NotFound("nope".to_string()))
        );
    }

    #[test]
    fn touch_last_connected_sets_epoch_millis() {
        let mut core = ServerRegistryCore::new();
        let entry = core.add(input("dev", "http://localhost:14096"));
        core.touch_last_connected(&entry.id).unwrap();
        let touched = core.get(&entry.id).unwrap();
        assert!(touched.last_connected_at.is_some());
        assert!(touched.last_connected_at.unwrap() >= entry.created_at);
    }

    #[test]
    fn touch_last_connected_unknown_id_is_not_found() {
        let mut core = ServerRegistryCore::new();
        assert_eq!(
            core.touch_last_connected("nope"),
            Err(RegistryError::NotFound("nope".to_string()))
        );
    }

    #[test]
    fn generated_ids_are_unique() {
        let mut core = ServerRegistryCore::new();
        let mut ids = Vec::new();
        for index in 0..1000 {
            let entry = core.add(input(&format!("s{index}"), "http://localhost:1"));
            assert!(entry.id.starts_with("srv_"));
            ids.push(entry.id);
        }
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), 1000);
    }

    #[test]
    fn resolve_base_url_returns_url_or_none() {
        let mut core = ServerRegistryCore::new();
        let entry = core.add(input("dev", "http://localhost:14096"));
        assert_eq!(core.resolve_base_url(&entry.id), Some(entry.url));
        assert_eq!(core.resolve_base_url("nope"), None);
    }

    #[test]
    fn serializes_with_camel_case_fields() {
        let mut core = ServerRegistryCore::new();
        let entry = core.add(input("dev", "http://localhost:14096"));
        core.touch_last_connected(&entry.id).unwrap();
        let value = serde_json::to_value(core.get(&entry.id).unwrap()).unwrap();
        let object = value.as_object().unwrap();
        assert!(object.contains_key("id"));
        assert!(object.contains_key("name"));
        assert!(object.contains_key("url"));
        assert!(object.contains_key("username"));
        assert!(object.contains_key("password"));
        assert!(object.contains_key("createdAt"));
        assert!(object.contains_key("lastConnectedAt"));
        assert!(!object.contains_key("created_at"));
        assert!(!object.contains_key("last_connected_at"));
    }

    #[test]
    fn deserializes_camel_case_input() {
        let entry: ServerEntry = serde_json::from_value(serde_json::json!({
            "id": "srv_1",
            "name": "dev",
            "url": "http://localhost:14096",
            "username": null,
            "password": null,
            "createdAt": 1_700_000_000_000_i64,
            "lastConnectedAt": null,
        }))
        .unwrap();
        assert_eq!(entry.id, "srv_1");
        assert_eq!(entry.created_at, 1_700_000_000_000);
        assert_eq!(entry.last_connected_at, None);
    }

    #[test]
    fn from_entries_round_trips_saved_state() {
        let mut core = ServerRegistryCore::new();
        let entry = core.add(input("dev", "http://localhost:14096"));
        let restored = ServerRegistryCore::from_entries(core.list());
        assert_eq!(restored.list(), vec![entry]);
    }
}
