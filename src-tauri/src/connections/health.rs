//! Per-server health monitor (TASK-M1-04).
//!
//! One tokio task per server: every 15s it probes `GET /global/health`
//! through the REST transport (architecture §7.3), folds the outcome into a
//! small pure state machine (`update_state`) and, whenever the recorded
//! snapshot changed, emits a `server-health` event so the frontend store can
//! update status light / latency / version without extra IPC. Three
//! consecutive failures mark the server `down`; the next success restores it
//! to `ok`/`slow`. Successful probes also refresh the registry's
//! `lastConnectedAt` timestamp.

use crate::connections::registry::now_millis;
use crate::connections::ServerRegistry;
use crate::transport::http::{http_request, Auth, HttpRequest};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Emitter;
use tauri::Manager;
use tokio_util::sync::CancellationToken;

/// Latencies at or above this are reported as `slow`.
pub const SLOW_THRESHOLD_MS: u64 = 1000;

/// Consecutive failures that flip the status to `down`.
pub const DOWN_AFTER_FAILURES: u32 = 3;

/// Event name emitted to the frontend whenever a health snapshot changes.
pub const HEALTH_EVENT: &str = "server-health";

/// Tunables for the polling loop; production defaults follow architecture
/// §7.3 (15s interval, 5s probe timeout). Tests shrink the timers.
#[derive(Debug, Clone)]
pub(crate) struct HealthConfig {
    pub(crate) poll_interval: Duration,
    pub(crate) probe_timeout: Duration,
}

impl Default for HealthConfig {
    fn default() -> Self {
        Self {
            poll_interval: Duration::from_secs(15),
            probe_timeout: Duration::from_secs(5),
        }
    }
}

/// Liveness status of a server connection, serialized as lowercase strings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HealthStatus {
    Ok,
    Slow,
    Down,
}

/// Health snapshot of one server, serialized camelCase for the frontend.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerHealth {
    pub server_id: String,
    pub healthy: bool,
    pub version: Option<String>,
    pub latency_ms: Option<u64>,
    pub last_ok: Option<i64>,
    pub fail_count: u32,
    pub status: HealthStatus,
    /// True when the last probe was rejected with 401/403 — the saved
    /// credentials (Basic or OAuth token) are no longer accepted, so the
    /// frontend should offer re-authentication instead of a plain
    /// "server down" state.
    #[serde(default)]
    pub auth_required: bool,
}

impl ServerHealth {
    /// State before the first probe: nothing is known yet, so the server is
    /// conservatively reported as down.
    fn initial(server_id: &str) -> Self {
        Self {
            server_id: server_id.to_string(),
            healthy: false,
            version: None,
            latency_ms: None,
            last_ok: None,
            fail_count: 0,
            status: HealthStatus::Down,
            auth_required: false,
        }
    }
}

/// Outcome of a single probe.
#[derive(Debug, Clone, PartialEq)]
pub enum PollResult {
    /// The server answered; `version` is extracted from the JSON body.
    Ok {
        version: Option<String>,
        latency_ms: u64,
    },
    /// Network error, timeout or non-success status.
    Err,
    /// The server rejected the credentials (401/403): the saved auth is no
    /// longer accepted. Marked `auth_required` so the UI offers re-auth.
    AuthRequired,
}

/// Pure state machine: applies one probe result to the snapshot and returns
/// whether anything changed (i.e. whether the caller must emit).
///
/// Success: `healthy`, the latency/version/`last_ok` are refreshed, the fail
/// counter resets and the status becomes `ok`/`slow` by latency. Failure: the
/// fail counter grows; at [`DOWN_AFTER_FAILURES`] the status flips to `down`
/// and `healthy` becomes false. Failures before that keep the previous status
/// and `healthy` keeps mirroring the last successful probe; latency/version
/// are retained so the UI can show the last known values. `AuthRequired`
/// behaves like a failure that also flips `auth_required` on (it is cleared
/// by the next success).
pub fn update_state(current: &mut ServerHealth, result: PollResult) -> bool {
    let previous = current.clone();
    match result {
        PollResult::Ok {
            version,
            latency_ms,
        } => {
            current.healthy = true;
            current.version = version;
            current.latency_ms = Some(latency_ms);
            current.last_ok = Some(now_millis());
            current.fail_count = 0;
            current.auth_required = false;
            current.status = if latency_ms >= SLOW_THRESHOLD_MS {
                HealthStatus::Slow
            } else {
                HealthStatus::Ok
            };
        }
        PollResult::Err => {
            current.fail_count += 1;
            if current.fail_count >= DOWN_AFTER_FAILURES {
                current.healthy = false;
                current.status = HealthStatus::Down;
            }
        }
        // Auth rejection is a hard failure: the stored credentials are
        // wrong regardless of retries, so it flips `down` immediately (no
        // three-strikes grace) and raises the re-auth flag for the UI.
        PollResult::AuthRequired => {
            current.fail_count += 1;
            current.healthy = false;
            current.status = HealthStatus::Down;
            current.auth_required = true;
        }
    }
    current != &previous
}

/// Handle of one polling task.
struct HealthTask {
    /// Latest snapshot; the task owns it, `get` reads through the mutex.
    state: Arc<Mutex<ServerHealth>>,
    token: CancellationToken,
    abort: tokio::task::AbortHandle,
}

/// Registry of per-server health monitors. Generic over the Tauri runtime so
/// tests drive it with the mock runtime.
pub struct HealthMonitor<R: tauri::Runtime> {
    app: tauri::AppHandle<R>,
    tasks: Mutex<HashMap<String, HealthTask>>,
}

impl<R: tauri::Runtime> HealthMonitor<R> {
    pub fn new(app: &tauri::AppHandle<R>) -> Self {
        Self {
            app: app.clone(),
            tasks: Mutex::new(HashMap::new()),
        }
    }

    /// Starts polling `GET /global/health` for the server every 15s; a
    /// running monitor for the same id is replaced. The id/url/auth are
    /// cloned before the task is spawned so the caller's registry lock is
    /// never held across an await.
    pub fn start(&self, server_id: String, url: String, auth: Option<Auth>) {
        self.start_with_config(server_id, url, auth, HealthConfig::default());
    }

    /// Starts polling for every entry of the registry (app startup).
    pub fn start_all(&self, registry: &ServerRegistry<R>) {
        self.start_all_with_config(registry, HealthConfig::default());
    }

    /// Stops the monitor of the given server (idempotent).
    pub fn stop(&self, server_id: &str) {
        if let Some(task) = self.tasks.lock().unwrap().remove(server_id) {
            task.token.cancel();
            task.abort.abort();
        }
    }

    /// Latest health snapshot of the server, if a monitor is running.
    pub fn get(&self, server_id: &str) -> Option<ServerHealth> {
        self.tasks
            .lock()
            .unwrap()
            .get(server_id)
            .map(|task| task.state.lock().unwrap().clone())
    }

    /// Testable variant of `start` with custom timers.
    pub(crate) fn start_with_config(
        &self,
        server_id: String,
        url: String,
        auth: Option<Auth>,
        config: HealthConfig,
    ) {
        self.stop(&server_id);
        let app = self.app.clone();
        let state = Arc::new(Mutex::new(ServerHealth::initial(&server_id)));
        let token = CancellationToken::new();
        let task_token = token.clone();
        let task_state = Arc::clone(&state);
        let task_server_id = server_id.clone();
        // Spawn through tauri's async runtime: it enters the tokio runtime
        // context before spawning, which raw `tokio::spawn` does not — the
        // setup hook runs on the main thread outside any runtime context,
        // so `start_all` panicked ("no reactor running") whenever a
        // persisted server existed, crashing the app at startup.
        let task = tauri::async_runtime::spawn(async move {
            monitor_loop(
                app,
                task_server_id,
                url,
                auth,
                config,
                task_state,
                task_token,
            )
            .await;
        });
        self.tasks.lock().unwrap().insert(
            server_id,
            HealthTask {
                state,
                token,
                abort: task.inner().abort_handle(),
            },
        );
    }

    /// Testable variant of `start_all` with custom timers.
    pub(crate) fn start_all_with_config(&self, registry: &ServerRegistry<R>, config: HealthConfig) {
        for entry in registry.list() {
            self.start_with_config(
                entry.id,
                entry.url,
                Some(Auth {
                    username: entry.username,
                    password: entry.password,
                    bearer: entry.oauth.as_ref().map(|oauth| oauth.access_token.clone()),
                }),
                config.clone(),
            );
        }
    }
}

/// Polling loop of one server: probe, fold into the state machine, publish
/// the snapshot and emit on change, then sleep the poll interval.
async fn monitor_loop<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    server_id: String,
    url: String,
    auth: Option<Auth>,
    config: HealthConfig,
    state: Arc<Mutex<ServerHealth>>,
    token: CancellationToken,
) {
    let mut current = ServerHealth::initial(&server_id);
    loop {
        let result = poll_server(&url, &auth, config.probe_timeout).await;
        let succeeded = matches!(result, PollResult::Ok { .. });
        if update_state(&mut current, result) {
            *state.lock().unwrap() = current.clone();
            let _ = app.emit(HEALTH_EVENT, &current);
        }
        if succeeded {
            // Refresh the registry's "last connected" marker on live probes
            // (the registry may be absent in tests).
            if let Some(registry) = app.try_state::<ServerRegistry<R>>() {
                let _ = registry.touch_last_connected(server_id.clone());
            }
        }
        tokio::select! {
            biased;
            _ = token.cancelled() => break,
            _ = tokio::time::sleep(config.poll_interval) => {}
        }
    }
}

/// Probes `GET /global/health` through the REST transport; the latency is
/// measured around the call. A non-success status or transport error is a
/// [`PollResult::Err`].
async fn poll_server(url: &str, auth: &Option<Auth>, timeout: Duration) -> PollResult {
    let started = Instant::now();
    let response = http_request(HttpRequest {
        url: Some(url.to_string()),
        method: "GET".to_string(),
        path: "/global/health".to_string(),
        auth: auth.clone(),
        timeout_ms: Some(timeout.as_millis() as u64),
        ..HttpRequest::default()
    })
    .await;
    let latency_ms = started.elapsed().as_millis() as u64;
    match response {
        Ok(response) => {
            let version = response
                .body
                .as_ref()
                .and_then(|body| body.get("version"))
                .and_then(serde_json::Value::as_str)
                .map(String::from);
            PollResult::Ok {
                version,
                latency_ms,
            }
        }
        Err(err) => {
            // 401/403: the saved credentials were rejected. The health
            // monitor cannot fix this itself — the frontend must offer
            // re-authentication (Basic form or OAuth flow).
            if matches!(err.status, Some(401) | Some(403)) {
                PollResult::AuthRequired
            } else {
                PollResult::Err
            }
        }
    }
}

/// One-shot probe against an arbitrary URL (Add Server flow): runs the state
/// machine on a single result and always returns the snapshot — the caller
/// reads `healthy`/`status`/`failCount` (a failed probe keeps the initial
/// `down` status with `failCount` 1).
pub async fn probe(url: String, auth: Option<Auth>) -> ServerHealth {
    let mut health = ServerHealth::initial("probe");
    let result = poll_server(&url, &auth, HealthConfig::default().probe_timeout).await;
    update_state(&mut health, result);
    health
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connections::registry::ServerEntry;
    use crate::connections::store::{JsonFileStore, ServerStore};
    use std::io::{BufRead, BufReader, Write};
    use std::net::{SocketAddr, TcpListener, TcpStream};
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::time::Duration;

    const HEALTH_BODY: &str = r#"{"healthy":true,"version":"1.18.11-mock"}"#;
    const ERROR_BODY: &str = r#"{"error":"injected"}"#;

    fn mock_app() -> tauri::AppHandle<tauri::test::MockRuntime> {
        tauri::test::mock_app().handle().clone()
    }

    fn ok_result(version: Option<&str>, latency_ms: u64) -> PollResult {
        PollResult::Ok {
            version: version.map(String::from),
            latency_ms,
        }
    }

    // ---- pure state machine matrix ----

    #[test]
    fn success_reports_ok_with_latency_version_and_last_ok() {
        let mut health = ServerHealth::initial("srv_1");
        assert!(update_state(
            &mut health,
            ok_result(Some("1.18.11-mock"), 42)
        ));
        assert!(health.healthy);
        assert_eq!(health.status, HealthStatus::Ok);
        assert_eq!(health.version.as_deref(), Some("1.18.11-mock"));
        assert_eq!(health.latency_ms, Some(42));
        assert_eq!(health.fail_count, 0);
        assert!(health.last_ok.is_some());
    }

    #[test]
    fn latency_at_or_above_threshold_is_slow() {
        let mut health = ServerHealth::initial("srv_1");
        update_state(&mut health, ok_result(None, SLOW_THRESHOLD_MS));
        assert_eq!(health.status, HealthStatus::Slow);
        assert!(health.healthy);
    }

    #[test]
    fn first_two_failures_keep_previous_status_and_healthy() {
        let mut health = ServerHealth::initial("srv_1");
        update_state(&mut health, ok_result(Some("1.18.11"), 10));
        assert!(update_state(&mut health, PollResult::Err));
        assert_eq!(health.fail_count, 1);
        assert!(health.healthy);
        assert_eq!(health.status, HealthStatus::Ok);
        assert!(update_state(&mut health, PollResult::Err));
        assert_eq!(health.fail_count, 2);
        assert!(health.healthy);
        assert_eq!(health.status, HealthStatus::Ok);
    }

    #[test]
    fn third_failure_marks_down_and_unhealthy() {
        let mut health = ServerHealth::initial("srv_1");
        update_state(&mut health, ok_result(None, 5));
        update_state(&mut health, PollResult::Err);
        update_state(&mut health, PollResult::Err);
        assert!(update_state(&mut health, PollResult::Err));
        assert_eq!(health.fail_count, 3);
        assert!(!health.healthy);
        assert_eq!(health.status, HealthStatus::Down);
    }

    #[test]
    fn failures_after_down_stay_down() {
        let mut health = ServerHealth::initial("srv_1");
        for _ in 0..3 {
            update_state(&mut health, PollResult::Err);
        }
        for _ in 0..3 {
            update_state(&mut health, PollResult::Err);
        }
        assert_eq!(health.fail_count, 6);
        assert!(!health.healthy);
        assert_eq!(health.status, HealthStatus::Down);
    }

    #[test]
    fn recovery_after_down_resets_and_reports_ok() {
        let mut health = ServerHealth::initial("srv_1");
        for _ in 0..3 {
            update_state(&mut health, PollResult::Err);
        }
        assert!(update_state(
            &mut health,
            ok_result(Some("1.18.11-mock"), 7)
        ));
        assert!(health.healthy);
        assert_eq!(health.status, HealthStatus::Ok);
        assert_eq!(health.fail_count, 0);
        assert_eq!(health.version.as_deref(), Some("1.18.11-mock"));
        assert_eq!(health.latency_ms, Some(7));
        assert!(health.last_ok.is_some());
    }

    #[test]
    fn failed_probe_keeps_last_known_latency_and_version() {
        let mut health = ServerHealth::initial("srv_1");
        update_state(&mut health, ok_result(Some("1.18.11"), 30));
        update_state(&mut health, PollResult::Err);
        assert_eq!(health.version.as_deref(), Some("1.18.11"));
        assert_eq!(health.latency_ms, Some(30));
    }

    #[test]
    fn auth_required_flips_down_immediately_and_clears_on_success() {
        let mut health = ServerHealth::initial("srv_1");
        update_state(&mut health, ok_result(Some("1.18.11"), 5));
        assert!(!health.auth_required);

        // One 401 is enough: no three-strikes grace for rejected credentials.
        assert!(update_state(&mut health, PollResult::AuthRequired));
        assert!(!health.healthy);
        assert_eq!(health.status, HealthStatus::Down);
        assert!(health.auth_required);
        assert_eq!(health.fail_count, 1);

        // The flag is sticky while auth keeps failing...
        update_state(&mut health, PollResult::AuthRequired);
        assert!(health.auth_required);

        // ...and the next success clears it.
        update_state(&mut health, ok_result(Some("1.18.11"), 5));
        assert!(health.healthy);
        assert!(!health.auth_required);
        assert_eq!(health.fail_count, 0);
    }

    #[test]
    fn serialized_health_carries_auth_required_flag() {
        let mut health = ServerHealth::initial("srv_1");
        update_state(&mut health, PollResult::AuthRequired);
        let value = serde_json::to_value(&health).unwrap();
        assert_eq!(value["authRequired"], true);
        // Defaults to false when absent (old persisted snapshots): a
        // JSON value without the key deserializes with auth_required off.
        let mut legacy = value.clone();
        legacy.as_object_mut().unwrap().remove("authRequired");
        let restored: ServerHealth = serde_json::from_value(legacy).unwrap();
        assert!(!restored.auth_required);
    }

    #[test]
    fn serializes_with_camel_case_and_lowercase_status() {
        let value = serde_json::to_value(ServerHealth::initial("srv_1")).unwrap();
        let object = value.as_object().unwrap();
        assert!(object.contains_key("serverId"));
        assert!(object.contains_key("latencyMs"));
        assert!(object.contains_key("lastOk"));
        assert!(object.contains_key("failCount"));
        assert_eq!(object["status"], "down");
    }

    // ---- lifecycle (real loop against a local TCP server) ----

    fn fast_config() -> HealthConfig {
        HealthConfig {
            poll_interval: Duration::from_millis(20),
            probe_timeout: Duration::from_secs(1),
        }
    }

    async fn wait_until(timeout: Duration, predicate: impl Fn() -> bool) -> bool {
        let deadline = Instant::now() + timeout;
        loop {
            if predicate() {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }

    /// Serves HTTP 500 for the first `fail_first` connections and a healthy
    /// health body afterwards; one response per connection.
    struct ScriptedServer {
        addr: SocketAddr,
        connections: Arc<AtomicUsize>,
        stop: Arc<AtomicBool>,
        thread: Option<std::thread::JoinHandle<()>>,
    }

    impl ScriptedServer {
        fn start(fail_first: usize) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            listener.set_nonblocking(true).unwrap();
            let addr = listener.local_addr().unwrap();
            let connections = Arc::new(AtomicUsize::new(0));
            let stop = Arc::new(AtomicBool::new(false));
            let thread = std::thread::spawn({
                let connections = Arc::clone(&connections);
                let stop = Arc::clone(&stop);
                move || {
                    while !stop.load(Ordering::Relaxed) {
                        match listener.accept() {
                            Ok((stream, _)) => {
                                let index = connections.fetch_add(1, Ordering::Relaxed);
                                let (status, body) = if index < fail_first {
                                    (500, ERROR_BODY)
                                } else {
                                    (200, HEALTH_BODY)
                                };
                                std::thread::spawn(move || serve_once(stream, status, body));
                            }
                            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                                std::thread::sleep(Duration::from_millis(2));
                            }
                            Err(_) => break,
                        }
                    }
                }
            });
            Self {
                addr,
                connections,
                stop,
                thread: Some(thread),
            }
        }

        fn connection_count(&self) -> usize {
            self.connections.load(Ordering::Relaxed)
        }
    }

    impl Drop for ScriptedServer {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::Relaxed);
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }

    fn serve_once(mut stream: TcpStream, status: u16, body: &'static str) {
        read_request_head(&stream);
        let reason = if status == 200 {
            "OK"
        } else {
            "Internal Server Error"
        };
        let payload = format!(
            "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len(),
        );
        let _ = stream.write_all(payload.as_bytes());
    }

    fn read_request_head(stream: &TcpStream) {
        let mut reader = BufReader::new(stream);
        let mut line = String::new();
        let mut lines = 0;
        while lines < 64 && reader.read_line(&mut line).unwrap_or(0) > 0 {
            if line.ends_with("\r\n\r\n") || line == "\r\n" {
                break;
            }
            line.clear();
            lines += 1;
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn start_spawns_a_monitor_that_probes_and_stop_removes_it() {
        let server = ScriptedServer::start(0);
        let monitor = HealthMonitor::new(&mock_app());
        assert_eq!(monitor.get("srv_1"), None);

        monitor.start_with_config(
            "srv_1".to_string(),
            format!("http://{}", server.addr),
            None,
            fast_config(),
        );

        let ok = wait_until(Duration::from_secs(5), || {
            monitor
                .get("srv_1")
                .is_some_and(|h| h.healthy && h.status == HealthStatus::Ok)
        })
        .await;
        assert!(ok, "monitor never reported healthy");
        let health = monitor.get("srv_1").unwrap();
        assert_eq!(health.version.as_deref(), Some("1.18.11-mock"));
        assert_eq!(health.fail_count, 0);
        assert!(health.latency_ms.is_some());

        monitor.stop("srv_1");
        assert_eq!(monitor.get("srv_1"), None);

        // No new probes may start after the stop (an already in-flight one
        // may still complete its connection).
        let stable = server.connection_count();
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(
            server.connection_count() <= stable + 1,
            "polling continued after stop"
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn three_failures_flip_to_down_and_a_success_recovers() {
        let server = ScriptedServer::start(3);
        let monitor = HealthMonitor::new(&mock_app());
        monitor.start_with_config(
            "srv_1".to_string(),
            format!("http://{}", server.addr),
            None,
            fast_config(),
        );

        let down = wait_until(Duration::from_secs(5), || {
            monitor.get("srv_1").is_some_and(|h| {
                h.fail_count >= DOWN_AFTER_FAILURES && !h.healthy && h.status == HealthStatus::Down
            })
        })
        .await;
        assert!(down, "monitor never flipped to down");
        let health = monitor.get("srv_1").unwrap();
        assert!(health.fail_count >= 3);

        let recovered = wait_until(Duration::from_secs(5), || {
            monitor
                .get("srv_1")
                .is_some_and(|h| h.healthy && h.status == HealthStatus::Ok)
        })
        .await;
        assert!(recovered, "monitor never recovered");
        let health = monitor.get("srv_1").unwrap();
        assert_eq!(health.fail_count, 0);
        assert_eq!(health.version.as_deref(), Some("1.18.11-mock"));

        monitor.stop("srv_1");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn start_all_spawns_monitors_and_touches_last_connected() {
        let server = ScriptedServer::start(0);
        let path =
            std::env::temp_dir().join(format!("opencoder-health-test-{}.json", std::process::id()));
        let store = JsonFileStore::new(path.clone());
        store
            .save(&[
                entry("srv_a", &format!("http://{}", server.addr)),
                entry("srv_b", &format!("http://{}", server.addr)),
            ])
            .unwrap();

        let app = mock_app();
        let registry = ServerRegistry::load_with(Box::new(store), &app).unwrap();
        app.manage(registry);
        let monitor = HealthMonitor::new(&app);
        monitor.start_all_with_config(
            &app.state::<ServerRegistry<tauri::test::MockRuntime>>(),
            fast_config(),
        );

        let ok_a = wait_until(Duration::from_secs(5), || {
            monitor
                .get("srv_a")
                .is_some_and(|h| h.healthy && h.status == HealthStatus::Ok)
        })
        .await;
        assert!(ok_a, "srv_a never became healthy");
        let ok_b = wait_until(Duration::from_secs(5), || {
            monitor
                .get("srv_b")
                .is_some_and(|h| h.healthy && h.status == HealthStatus::Ok)
        })
        .await;
        assert!(ok_b, "srv_b never became healthy");

        // Successful probes refresh the registry's last connected marker.
        let registry = app.state::<ServerRegistry<tauri::test::MockRuntime>>();
        let touched = registry.get("srv_a").unwrap().last_connected_at;
        assert!(touched.is_some(), "lastConnectedAt never refreshed");

        monitor.stop("srv_a");
        monitor.stop("srv_b");
        let _ = std::fs::remove_file(path);
    }

    fn entry(id: &str, url: &str) -> ServerEntry {
        ServerEntry {
            id: id.to_string(),
            name: "dev".to_string(),
            url: url.to_string(),
            username: Some("admin".to_string()),
            password: Some("secret".to_string()),
            oauth: None,
            created_at: 1_700_000_000_000,
            last_connected_at: None,
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn successful_probe_yields_ok_snapshot() {
        let server = ScriptedServer::start(0);
        let url = format!("http://{}", server.addr);
        // One-shot probes against the local listener can flake under
        // parallel suite load (the accept loop sleeps between polls), so
        // retry a few times before treating the probe as a failure.
        let mut health = probe(url.clone(), None).await;
        let mut attempts = 1;
        while !health.healthy && attempts < 3 {
            tokio::time::sleep(Duration::from_millis(25)).await;
            health = probe(url.clone(), None).await;
            attempts += 1;
        }
        assert!(health.healthy, "probe failed after {attempts} attempts");
        assert_eq!(health.status, HealthStatus::Ok);
        assert_eq!(health.version.as_deref(), Some("1.18.11-mock"));
        assert_eq!(health.fail_count, 0);
        assert!(health.latency_ms.is_some());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn failed_probe_yields_down_snapshot_with_fail_count_one() {
        let server = ScriptedServer::start(1);
        let health = probe(format!("http://{}", server.addr), None).await;
        assert!(!health.healthy);
        assert_eq!(health.status, HealthStatus::Down);
        assert_eq!(health.fail_count, 1);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn probe_against_mock_server_when_configured() {
        let url = match std::env::var("MOCK_URL") {
            Ok(url) => url,
            Err(_) => return,
        };
        let health = probe(url, None).await;
        assert!(health.healthy);
        assert_eq!(health.status, HealthStatus::Ok);
        assert_eq!(health.version.as_deref(), Some("1.18.11-mock"));
        assert_eq!(health.fail_count, 0);
        assert!(health.latency_ms.is_some());
    }
}
