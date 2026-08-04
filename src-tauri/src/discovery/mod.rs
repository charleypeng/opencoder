//! mDNS LAN auto-discovery of OpenCode servers (TASK-M1-07).
//!
//! Scans the local network for OpenCode servers through the `mdns-sd`
//! daemon (backend in `mdns.rs`), deduplicates the resolved services into a
//! small cache and announces each new server to the frontend via a
//! `server-discovered` event. The daemon runs on its own thread and the
//! scan loop is a background tokio task, so a missing LAN interface or a
//! failed browse degrades silently: nothing is emitted and the UI simply
//! shows an empty list.

pub mod mdns;

use crate::discovery::mdns::MdnsBackend;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use tauri::Emitter;
use tokio_util::sync::CancellationToken;

/// Service type of an OpenCode server per the M1-07 contract.
pub const OPENCODE_SERVICE_TYPE: &str = "_opencode._tcp.local.";

/// The `_http._tcp` service type: the current `opencode serve --mdns`
/// implementation publishes a plain HTTP service named `opencode-<port>`
/// (TXT `path=/`) instead of `_opencode._tcp`, so both types are scanned.
pub const HTTP_SERVICE_TYPE: &str = "_http._tcp.local.";

/// Event emitted to the frontend for every newly discovered server.
pub const DISCOVERED_EVENT: &str = "server-discovered";

/// A server found on the LAN, serialized camelCase for the frontend.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredServer {
    /// Dedupe key: the full mDNS service name of the instance.
    pub id: String,
    pub name: String,
    pub url: String,
    pub host: String,
    pub port: u16,
}

/// Minimal view of a resolved mDNS service, decoupled from the `mdns-sd`
/// types so parsing and dedupe can be unit-tested without a daemon.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedService {
    /// Full service name, e.g. `opencode-14096._http._tcp.local.`.
    pub fullname: String,
    /// Host name, e.g. `opencode.local.`.
    pub hostname: String,
    pub port: u16,
    /// Resolved IP addresses (IPv4 preferred, IPv6 allowed).
    pub addresses: Vec<IpAddr>,
    /// Decoded TXT properties as key/value strings.
    pub properties: HashMap<String, String>,
}

/// Converts a resolved mDNS service into a [`DiscoveredServer`].
///
/// Display name: the TXT `name` property when present, else the service
/// instance name (e.g. `opencode-14096`), else the hostname without its
/// trailing dot. URL host: the first non-loopback IPv4 address, falling
/// back to IPv6 and finally to the raw hostname. The id is the full
/// service name, which is stable per instance and doubles as dedupe key.
pub fn parse_resolved(service: &ResolvedService) -> DiscoveredServer {
    let name = service
        .properties
        .get("name")
        .filter(|name| !name.is_empty())
        .cloned()
        .unwrap_or_else(|| {
            instance_name(&service.fullname).unwrap_or_else(|| {
                service
                    .hostname
                    .strip_suffix('.')
                    .unwrap_or(&service.hostname)
                    .to_string()
            })
        });
    let host = service
        .addresses
        .iter()
        .find(|address| address.is_ipv4() && !address.is_loopback())
        .or_else(|| service.addresses.iter().find(|address| address.is_ipv4()))
        .or_else(|| {
            service
                .addresses
                .iter()
                .find(|address| !address.is_loopback())
        })
        .or_else(|| service.addresses.first())
        .map(|address| address.to_string())
        .unwrap_or_else(|| service.hostname.trim_end_matches('.').to_string());
    DiscoveredServer {
        id: service.fullname.clone(),
        name,
        url: format!("http://{}:{}", url_host(&host), service.port),
        host,
        port: service.port,
    }
}

/// Renders a host for the authority component of a URL: IPv6 literals get
/// bracketed (`fd00::1` -> `[fd00::1]`) per RFC 3986 section 3.2.2, IPv4
/// addresses and hostnames pass through unchanged.
fn url_host(host: &str) -> String {
    if host.contains(':') {
        format!("[{host}]")
    } else {
        host.to_string()
    }
}

/// The instance part of a full service name (`opencode-14096` in
/// `opencode-14096._http._tcp.local.`).
fn instance_name(fullname: &str) -> Option<String> {
    let instance = fullname.split('.').next()?;
    (!instance.is_empty()).then(|| instance.to_string())
}

/// Deduplicated set of discovered servers, keyed by the full service name.
#[derive(Debug, Default)]
pub struct DiscoveryCache {
    servers: Vec<DiscoveredServer>,
    known: HashSet<String>,
}

impl DiscoveryCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers a server; returns it when it is new, or `None` when the
    /// same id (mDNS instance) is already known.
    pub fn insert(&mut self, server: DiscoveredServer) -> Option<DiscoveredServer> {
        if self.known.insert(server.id.clone()) {
            self.servers.push(server.clone());
            Some(server)
        } else {
            None
        }
    }

    pub fn list(&self) -> Vec<DiscoveredServer> {
        self.servers.clone()
    }
}

/// One active discovery session: the scan task, the dedupe cache and the
/// backend (kept alive for `shutdown` on stop).
struct Session {
    cache: Arc<Mutex<DiscoveryCache>>,
    token: CancellationToken,
    abort: tokio::task::AbortHandle,
    backend: Box<dyn MdnsBackend>,
}

impl Session {
    /// Cancels the scan task and shuts the daemon down.
    fn stop(self) {
        self.token.cancel();
        self.abort.abort();
        self.backend.shutdown();
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        // Safety net for app teardown without an explicit stop: cancel the
        // scan task. The daemon thread is shut down by `stop` and dies with
        // the process otherwise.
        self.token.cancel();
    }
}

/// Managed mDNS discovery: start/stop lifecycle around a scan task plus a
/// dedupe cache the frontend can pull from. Generic over the Tauri runtime
/// so tests drive it with the mock runtime and a mock backend.
pub struct MdnsDiscovery<R: tauri::Runtime> {
    app: tauri::AppHandle<R>,
    inner: Mutex<Option<Session>>,
}

impl<R: tauri::Runtime> MdnsDiscovery<R> {
    pub fn new(app: &tauri::AppHandle<R>) -> Self {
        Self {
            app: app.clone(),
            inner: Mutex::new(None),
        }
    }

    /// Starts scanning both opencode service types; a running session is
    /// left untouched (idempotent). When the daemon cannot be created or
    /// no browse could be registered (e.g. no LAN interface), the session
    /// degrades silently to nothing.
    pub fn start(&self) {
        if self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_some()
        {
            return;
        }
        match mdns::MdnsSdBackend::new() {
            Ok(backend) => self.start_with_backend(Box::new(backend)),
            Err(error) => {
                eprintln!("mdns discovery: daemon unavailable ({error}); LAN discovery disabled")
            }
        }
    }

    /// Stops the scan and drops the cache (idempotent).
    pub fn stop(&self) {
        let mut guard = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(session) = guard.take() {
            session.stop();
        }
    }

    /// Discovered servers so far (empty when not scanning).
    pub fn discovered(&self) -> Vec<DiscoveredServer> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .map(|session| session.cache.lock().unwrap().list())
            .unwrap_or_default()
    }

    /// Testable start with an injected backend.
    pub(crate) fn start_with_backend(&self, backend: Box<dyn MdnsBackend>) {
        let mut guard = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if guard.is_some() {
            return;
        }
        let mut receivers = Vec::new();
        for service_type in [OPENCODE_SERVICE_TYPE, HTTP_SERVICE_TYPE] {
            match backend.browse(service_type) {
                Ok(receiver) => receivers.push(receiver),
                Err(error) => {
                    eprintln!("mdns discovery: browse {service_type} failed ({error}); skipping")
                }
            }
        }
        if receivers.is_empty() {
            // No browse could be registered (e.g. LAN unreachable): degrade
            // silently without keeping a dead session alive.
            backend.shutdown();
            return;
        }
        let cache = Arc::new(Mutex::new(DiscoveryCache::new()));
        let token = CancellationToken::new();
        let app = self.app.clone();
        let task_cache = Arc::clone(&cache);
        let task_token = token.clone();
        let task = tokio::spawn(async move {
            scan_loop(app, task_cache, task_token, receivers).await;
        });
        *guard = Some(Session {
            cache,
            token,
            abort: task.abort_handle(),
            backend,
        });
    }
}

/// Consumes resolved services from all browse streams, dedupes them into
/// the cache and emits `server-discovered` for each new server.
async fn scan_loop<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    cache: Arc<Mutex<DiscoveryCache>>,
    token: CancellationToken,
    receivers: Vec<flume::Receiver<ResolvedService>>,
) {
    use futures_util::StreamExt;
    let mut services =
        futures_util::stream::select_all(receivers.iter().map(|receiver| receiver.stream()));
    loop {
        tokio::select! {
            biased;
            _ = token.cancelled() => break,
            service = services.next() => match service {
                Some(service) => handle_resolved(&app, &cache, service),
                None => break,
            },
        }
    }
}

/// Dedupes one resolved service into the cache and emits it when new.
fn handle_resolved<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    cache: &Mutex<DiscoveryCache>,
    service: ResolvedService,
) {
    let server = parse_resolved(&service);
    let is_new = cache
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(server.clone())
        .is_some();
    if is_new {
        let _ = app.emit(DISCOVERED_EVENT, &server);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::discovery::mdns::MdnsBackend;
    use std::net::{Ipv4Addr, Ipv6Addr};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;
    use tauri::Listener;
    fn mock_app() -> tauri::AppHandle<tauri::test::MockRuntime> {
        tauri::test::mock_app().handle().clone()
    }

    fn resolved(
        fullname: &str,
        hostname: &str,
        port: u16,
        addresses: Vec<IpAddr>,
        properties: &[(&str, &str)],
    ) -> ResolvedService {
        ResolvedService {
            fullname: fullname.to_string(),
            hostname: hostname.to_string(),
            port,
            addresses,
            properties: properties
                .iter()
                .map(|(key, value)| (key.to_string(), value.to_string()))
                .collect(),
        }
    }

    fn v4(octets: [u8; 4]) -> IpAddr {
        IpAddr::V4(Ipv4Addr::from(octets))
    }

    // ---- parse_resolved ----

    #[test]
    fn name_prefers_the_txt_name_property() {
        let service = resolved(
            "opencode-14096._http._tcp.local.",
            "opencode.local.",
            14096,
            vec![v4([192, 168, 1, 5])],
            &[("name", "Workshop"), ("path", "/")],
        );
        let server = parse_resolved(&service);
        assert_eq!(server.name, "Workshop");
    }

    #[test]
    fn name_falls_back_to_the_instance_name() {
        let service = resolved(
            "opencode-14096._http._tcp.local.",
            "opencode.local.",
            14096,
            vec![v4([192, 168, 1, 5])],
            &[],
        );
        let server = parse_resolved(&service);
        assert_eq!(server.name, "opencode-14096");
    }

    #[test]
    fn name_falls_back_to_the_hostname_without_trailing_dot() {
        let service = resolved(
            "my-server._opencode._tcp.local.",
            "my-server.local.",
            9000,
            vec![v4([10, 0, 0, 7])],
            &[],
        );
        let server = parse_resolved(&service);
        assert_eq!(server.name, "my-server");
    }

    #[test]
    fn url_prefers_a_non_loopback_ipv4_address() {
        let service = resolved(
            "opencode-14096._http._tcp.local.",
            "opencode.local.",
            14096,
            vec![v4([127, 0, 0, 1]), v4([192, 168, 1, 5])],
            &[],
        );
        let server = parse_resolved(&service);
        assert_eq!(server.url, "http://192.168.1.5:14096");
        assert_eq!(server.host, "192.168.1.5");
        assert_eq!(server.port, 14096);
    }

    #[test]
    fn url_host_brackets_ipv6_literals_only() {
        assert_eq!(url_host("192.168.1.5"), "192.168.1.5");
        assert_eq!(url_host("fd00::1"), "[fd00::1]");
        assert_eq!(url_host("opencode.local"), "opencode.local");
    }

    #[test]
    fn url_falls_back_to_ipv6_and_then_to_the_hostname() {
        let ipv6_only = resolved(
            "opencode-8080._http._tcp.local.",
            "opencode.local.",
            8080,
            vec![IpAddr::V6(Ipv6Addr::new(0xfd00, 0, 0, 0, 0, 0, 0, 0x1))],
            &[],
        );
        let server = parse_resolved(&ipv6_only);
        assert_eq!(server.url, "http://[fd00::1]:8080");
        assert_eq!(server.host, "fd00::1");

        let unresolved = resolved(
            "opencode-8080._http._tcp.local.",
            "opencode.local.",
            8080,
            vec![],
            &[],
        );
        let server = parse_resolved(&unresolved);
        assert_eq!(server.url, "http://opencode.local:8080");
        assert_eq!(server.host, "opencode.local");
    }

    #[test]
    fn id_is_the_full_service_name() {
        let service = resolved(
            "opencode-14096._http._tcp.local.",
            "opencode.local.",
            14096,
            vec![v4([192, 168, 1, 5])],
            &[],
        );
        assert_eq!(
            parse_resolved(&service).id,
            "opencode-14096._http._tcp.local."
        );
    }

    #[test]
    fn serializes_with_camel_case_fields() {
        let service = resolved(
            "opencode-14096._http._tcp.local.",
            "opencode.local.",
            14096,
            vec![v4([192, 168, 1, 5])],
            &[],
        );
        let value = serde_json::to_value(parse_resolved(&service)).unwrap();
        let object = value.as_object().unwrap();
        assert!(object.contains_key("id"));
        assert!(object.contains_key("name"));
        assert!(object.contains_key("url"));
        assert!(object.contains_key("host"));
        assert!(object.contains_key("port"));
    }

    // ---- dedupe ----

    #[test]
    fn cache_keeps_only_new_ids() {
        let mut cache = DiscoveryCache::new();
        let first = parse_resolved(&resolved(
            "opencode-14096._http._tcp.local.",
            "opencode.local.",
            14096,
            vec![v4([192, 168, 1, 5])],
            &[],
        ));
        let duplicate = parse_resolved(&resolved(
            "opencode-14096._http._tcp.local.",
            "opencode.local.",
            14096,
            vec![v4([192, 168, 1, 9])],
            &[],
        ));
        let other = parse_resolved(&resolved(
            "opencode-14097._http._tcp.local.",
            "opencode.local.",
            14097,
            vec![v4([192, 168, 1, 6])],
            &[],
        ));
        assert_eq!(cache.insert(first.clone()), Some(first.clone()));
        assert_eq!(cache.insert(duplicate), None);
        assert_eq!(cache.insert(other.clone()), Some(other.clone()));
        assert_eq!(cache.list(), vec![first, other]);
    }

    // ---- lifecycle with a mock backend ----

    /// Backend with scriptable browse streams; every browse call receives
    /// a fresh channel so the test can push resolved services into all of
    /// them at once (mirroring the two service types of a real scan).
    #[derive(Clone)]
    struct MockBackend {
        browse_calls: Arc<AtomicUsize>,
        shutdown_calls: Arc<AtomicUsize>,
        senders: Arc<Mutex<Vec<flume::Sender<ResolvedService>>>>,
    }

    impl MockBackend {
        fn new() -> Self {
            Self {
                browse_calls: Arc::new(AtomicUsize::new(0)),
                shutdown_calls: Arc::new(AtomicUsize::new(0)),
                senders: Arc::new(Mutex::new(Vec::new())),
            }
        }

        fn push(&self, service: &ResolvedService) {
            let senders = self.senders.lock().unwrap();
            for sender in senders.iter() {
                let _ = sender.send(service.clone());
            }
        }
    }

    impl MdnsBackend for MockBackend {
        fn browse(&self, _service_type: &str) -> Result<flume::Receiver<ResolvedService>, String> {
            self.browse_calls.fetch_add(1, Ordering::SeqCst);
            let (sender, receiver) = flume::unbounded();
            self.senders.lock().unwrap().push(sender);
            Ok(receiver)
        }

        fn shutdown(&self) {
            self.shutdown_calls.fetch_add(1, Ordering::SeqCst);
        }
    }

    /// Backend whose browse always fails, simulating a machine without any
    /// usable network interface.
    struct DeadBackend;

    impl MdnsBackend for DeadBackend {
        fn browse(&self, _service_type: &str) -> Result<flume::Receiver<ResolvedService>, String> {
            Err("no network interface".to_string())
        }

        fn shutdown(&self) {}
    }

    async fn wait_until(timeout: Duration, predicate: impl Fn() -> bool) -> bool {
        let deadline = std::time::Instant::now() + timeout;
        loop {
            if predicate() {
                return true;
            }
            if std::time::Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }

    fn sample_service() -> ResolvedService {
        resolved(
            "opencode-14096._http._tcp.local.",
            "opencode.local.",
            14096,
            vec![v4([192, 168, 1, 5])],
            &[("path", "/")],
        )
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn start_is_idempotent_and_stop_is_idempotent() {
        let app = mock_app();
        let discovery = MdnsDiscovery::new(&app);
        let backend = MockBackend::new();

        discovery.start_with_backend(Box::new(backend.clone()));
        discovery.start_with_backend(Box::new(backend.clone()));
        assert_eq!(backend.browse_calls.load(Ordering::SeqCst), 2);

        discovery.stop();
        discovery.stop();
        assert_eq!(backend.shutdown_calls.load(Ordering::SeqCst), 1);
        assert!(discovery.discovered().is_empty());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn resolved_services_are_deduped_cached_and_emitted() {
        let app = mock_app();
        let emitted: Arc<Mutex<Vec<DiscoveredServer>>> = Arc::new(Mutex::new(Vec::new()));
        {
            let emitted = Arc::clone(&emitted);
            let _guard = app.listen(DISCOVERED_EVENT, move |event| {
                // Tauri 2.11 event payloads are raw JSON strings on the
                // Rust side; deserialize them here.
                let server: DiscoveredServer = serde_json::from_str(event.payload()).unwrap();
                emitted.lock().unwrap().push(server);
            });
        }

        let discovery = MdnsDiscovery::new(&app);
        let backend = MockBackend::new();
        discovery.start_with_backend(Box::new(backend.clone()));

        // Both browse streams see the same two instances; the shared cache
        // dedupes them to one server each and emits a single event per id.
        backend.push(&sample_service());
        backend.push(&sample_service());
        backend.push(&resolved(
            "opencode-14097._http._tcp.local.",
            "opencode.local.",
            14097,
            vec![v4([192, 168, 1, 6])],
            &[],
        ));

        let ok = wait_until(Duration::from_secs(5), || {
            discovery.discovered().len() == 2 && emitted.lock().unwrap().len() == 2
        })
        .await;
        assert!(ok, "servers were neither cached nor emitted");

        let servers = discovery.discovered();
        assert_eq!(servers[0].url, "http://192.168.1.5:14096");
        assert_eq!(servers[0].name, "opencode-14096");
        assert_eq!(servers[1].url, "http://192.168.1.6:14097");

        discovery.stop();
        assert!(discovery.discovered().is_empty());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn browse_failures_degrade_silently() {
        let app = mock_app();
        let discovery = MdnsDiscovery::new(&app);
        discovery.start_with_backend(Box::new(DeadBackend));
        assert!(discovery.discovered().is_empty());
        // Still usable afterwards: a later start with a working backend is
        // not blocked by the failed attempt.
        let backend = MockBackend::new();
        discovery.start_with_backend(Box::new(backend.clone()));
        backend.push(&sample_service());
        let ok = wait_until(Duration::from_secs(5), || discovery.discovered().len() == 1).await;
        assert!(ok, "no servers after a failed browse");
        discovery.stop();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn stop_cancels_the_scan() {
        let app = mock_app();
        let discovery = MdnsDiscovery::new(&app);
        let backend = MockBackend::new();
        discovery.start_with_backend(Box::new(backend.clone()));

        let ok = wait_until(Duration::from_secs(5), || {
            backend.browse_calls.load(Ordering::SeqCst) == 2
        })
        .await;
        assert!(ok, "browse never registered");
        discovery.stop();

        // Events arriving after the stop must not resurface anything.
        backend.push(&sample_service());
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(discovery.discovered().is_empty());
    }

    #[test]
    fn empty_name_property_falls_back_to_instance() {
        // Guard against the "name" property being present but empty.
        let service = resolved(
            "opencode-8080._http._tcp.local.",
            "opencode.local.",
            8080,
            vec![v4([192, 168, 1, 5])],
            &[("name", "")],
        );
        assert_eq!(parse_resolved(&service).name, "opencode-8080");
    }
}
