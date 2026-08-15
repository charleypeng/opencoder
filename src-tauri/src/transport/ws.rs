//! PTY WebSocket data channel (ADR-002, TASK-M6-01).
//!
//! `pty_ws_connect` fetches a connect ticket through the REST transport
//! (`POST /pty/{ptyID}/connect-token`, TASK-M6-01 protocol verification —
//! the 1.18.11 contract names the query parameter `ticket`, not `token`),
//! assembles the WebSocket URL (`ws(s)://{base}/pty/{ptyID}/connect?ticket=…`),
//! connects with tokio-tungstenite and spawns a read loop. Binary frames are
//! forwarded to the frontend as `{ "bytes": [...] }` envelopes on a single
//! tauri Channel; when the connection terminates (server close, error, or
//! explicit `pty_ws_close`) a `{ "type": "pty.ws.closed" }` control frame is
//! pushed so the terminal view can mark the PTY dead.
//!
//! Payload format note: tauri 2.11's `Channel::send` only supports serde
//! serialization (no raw-byte send), so binary frames travel as JSON byte
//! arrays — acceptable for mock/dev; a raw binary channel can replace the
//! envelope once the tauri version offers one. Reconnects are intentionally
//! NOT implemented: a PTY dies with its WebSocket (the terminal process is
//! gone on disconnect), so the read loop closes the connection on any error.
//! One tokio task per connection; `pty_ws_send` and the pong replies share
//! the write half under an async mutex (WebSocket frames must be written
//! sequentially).

use crate::transport::http::{ApiError, Auth, HttpRequest};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use tokio::net::TcpStream;
use tokio::sync::Mutex as AsyncMutex;
use tokio_util::sync::CancellationToken;

use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

/// Stream type produced by `connect_async` with the rustls feature: a plain
/// TCP stream (ws://) or a rustls-wrapped one (wss://).
type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;
type WsWrite = SplitSink<WsStream, Message>;

/// Marker header the real server demands on `POST /pty/{id}/connect-token`
/// (packages/opencode/src/server/shared/pty-ticket.ts, v1.18.11): without
/// `x-opencode-ticket: 1` the handler answers 403 and the PTY channel can
/// never open. The mock mirrors this check so a regression fails at L3.
const PTY_CONNECT_TOKEN_HEADER: &str = "x-opencode-ticket";
const PTY_CONNECT_TOKEN_HEADER_VALUE: &str = "1";

/// Sink abstraction over the tauri IPC channel so the connection machinery
/// can be unit-tested without a WebView (mirrors `sse::SseSink`).
pub(crate) trait PtySink: Send + Sync {
    /// Sends one payload; `Err` means the WebView is gone (permanent).
    fn send(&self, payload: serde_json::Value) -> Result<(), String>;
}

impl PtySink for tauri::ipc::Channel<serde_json::Value> {
    fn send(&self, payload: serde_json::Value) -> Result<(), String> {
        tauri::ipc::Channel::send(self, payload).map_err(|err| err.to_string())
    }
}

/// Envelope for one binary frame pushed to the frontend.
pub(crate) fn binary_envelope(bytes: &[u8]) -> serde_json::Value {
    serde_json::json!({ "bytes": bytes })
}

/// Control frame pushed when the connection terminates for any reason.
pub(crate) fn closed_envelope() -> serde_json::Value {
    serde_json::json!({ "type": "pty.ws.closed" })
}

/// Resolves the `ws(s)` connect URL for a PTY: the base scheme is flipped
/// (http -> ws, https -> wss) and the ticket (+ optional directory) is
/// appended as query parameters, per the 1.18.11 contract's connect endpoint.
pub(crate) fn build_ws_url(
    base: &str,
    pty_id: &str,
    ticket: &str,
    directory: Option<&str>,
) -> Result<reqwest::Url, ApiError> {
    let base = reqwest::Url::parse(base)
        .map_err(|_| ApiError::invalid_url(format!("invalid base url: {base}")))?;
    let scheme = match base.scheme() {
        "https" => "wss",
        "http" => "ws",
        other => {
            return Err(ApiError::invalid_url(format!(
                "unsupported scheme for websocket: {other}"
            )))
        }
    };
    let authority = match base.host_str() {
        Some(host) => {
            let port = base
                .port()
                .map(|port| format!(":{port}"))
                .unwrap_or_default();
            format!("{host}{port}")
        }
        None => {
            return Err(ApiError::invalid_url("base url without host"));
        }
    };
    let mut url = reqwest::Url::parse(&format!("{scheme}://{authority}/pty/{pty_id}/connect"))
        .map_err(|_| ApiError::invalid_url(format!("invalid pty id: {pty_id}")))?;
    url.query_pairs_mut().append_pair("ticket", ticket);
    if let Some(directory) = directory {
        url.query_pairs_mut().append_pair("directory", directory);
    }
    Ok(url)
}

/// Exchanges a connect ticket via `POST /pty/{ptyID}/connect-token` and
/// returns the ticket string. The request carries the `x-opencode-ticket`
/// marker header the real server requires (403 without it).
async fn fetch_connect_ticket(
    base: &str,
    pty_id: &str,
    auth: Option<Auth>,
) -> Result<String, ApiError> {
    let request = HttpRequest {
        url: Some(base.to_string()),
        method: "POST".to_string(),
        path: format!("/pty/{pty_id}/connect-token"),
        headers: Some(HashMap::from([(
            PTY_CONNECT_TOKEN_HEADER.to_string(),
            PTY_CONNECT_TOKEN_HEADER_VALUE.to_string(),
        )])),
        auth,
        ..HttpRequest::default()
    };
    let response = crate::transport::http::http_request(request).await?;
    let ticket = response
        .body
        .as_ref()
        .and_then(|body| body.get("ticket"))
        .and_then(serde_json::Value::as_str);
    ticket
        .map(str::to_owned)
        .ok_or_else(|| ApiError::http(502, "invalid connect-token response: missing ticket"))
}

/// Handle of a live PTY connection: cancels the read task and holds the
/// write half for `pty_ws_send`.
struct PtyConnection {
    sink: Arc<AsyncMutex<WsWrite>>,
    token: CancellationToken,
}

/// Registry of live connections; the read task removes its own entry when it
/// terminates, so `pty_ws_close` stays idempotent (mirrors sse.rs).
struct PtyRegistry {
    connections: Mutex<HashMap<u64, PtyConnection>>,
    next_id: AtomicU64,
}

impl PtyRegistry {
    fn new() -> Self {
        Self {
            connections: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
        }
    }

    fn next_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    fn insert(&self, id: u64, connection: PtyConnection) {
        self.connections.lock().unwrap().insert(id, connection);
    }

    fn remove(&self, id: u64) -> Option<PtyConnection> {
        self.connections.lock().unwrap().remove(&id)
    }

    fn take_sink(&self, id: u64) -> Option<Arc<AsyncMutex<WsWrite>>> {
        self.connections
            .lock()
            .unwrap()
            .get(&id)
            .map(|connection| Arc::clone(&connection.sink))
    }
}

static PTY_REGISTRY: LazyLock<PtyRegistry> = LazyLock::new(PtyRegistry::new);

/// Full connect flow: fetch the ticket over REST, assemble the ws(s) URL and
/// spawn the read loop. `base_url` is resolved against the server registry in
/// the commands layer (TASK-M1-03) and passed in directly.
pub async fn pty_ws_connect(
    base_url: String,
    pty_id: String,
    directory: Option<String>,
    channel: tauri::ipc::Channel<serde_json::Value>,
    auth: Option<Auth>,
) -> Result<u64, ApiError> {
    pty_ws_connect_with_config(base_url, pty_id, directory, Arc::new(channel), auth).await
}

/// Testable variant of `pty_ws_connect` with a pluggable sink.
pub(crate) async fn pty_ws_connect_with_config(
    base_url: String,
    pty_id: String,
    directory: Option<String>,
    sink: Arc<dyn PtySink>,
    auth: Option<Auth>,
) -> Result<u64, ApiError> {
    let ticket = fetch_connect_ticket(&base_url, &pty_id, auth).await?;
    let url = build_ws_url(&base_url, &pty_id, &ticket, directory.as_deref())?;
    spawn_connection(url, sink).await
}

/// Connects to `url` and spawns the read loop; returns the connection id.
pub(crate) async fn spawn_connection(
    url: reqwest::Url,
    sink: Arc<dyn PtySink>,
) -> Result<u64, ApiError> {
    let (stream, response) = connect_async(url.as_str())
        .await
        .map_err(|err| ApiError::network(format!("websocket connect failed: {err}")))?;
    if !(response.status() == reqwest::StatusCode::SWITCHING_PROTOCOLS) {
        return Err(ApiError::http(
            response.status().as_u16(),
            format!("websocket upgrade rejected: {}", response.status()),
        ));
    }
    let id = PTY_REGISTRY.next_id();
    let token = CancellationToken::new();
    let (write, read) = stream.split();
    let shared_write = Arc::new(AsyncMutex::new(write));
    let task_write = Arc::clone(&shared_write);
    let task_token = token.clone();
    let task_sink = Arc::clone(&sink);
    tokio::spawn(async move {
        read_loop(read, &task_write, &task_sink, &task_token).await;
        // The task removes its own registry entry so a server-side close
        // never leaves a stale handle behind.
        let _ = task_sink.send(closed_envelope());
        PTY_REGISTRY.remove(id);
    });
    PTY_REGISTRY.insert(
        id,
        PtyConnection {
            sink: shared_write,
            token,
        },
    );
    Ok(id)
}

/// Forwards binary/text frames to the frontend until the connection dies or
/// the token is cancelled; responds to server pings. Control frames — a
/// 0x00 byte followed by UTF-8 JSON carrying the replay cursor
/// (`PtyProtocol.metaFrame`, packages/core/src/pty/protocol.ts) — are
/// dropped: they are not terminal output and the client has no replay
/// resume flow.
async fn read_loop(
    mut read: SplitStream<WsStream>,
    write: &Arc<AsyncMutex<WsWrite>>,
    sink: &Arc<dyn PtySink>,
    token: &CancellationToken,
) {
    loop {
        tokio::select! {
            biased;
            _ = token.cancelled() => break,
            next = read.next() => {
                match next {
                    Some(Ok(Message::Binary(bytes))) => {
                        if is_meta_frame(&bytes) {
                            continue;
                        }
                        if sink.send(binary_envelope(&bytes)).is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Text(text))) => {
                        // Text frames (e.g. server error notes) travel the
                        // same path so the terminal never loses output.
                        if sink.send(binary_envelope(text.as_bytes())).is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        let mut write = write.lock().await;
                        if write.send(Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                    Some(Ok(_)) => {}
                }
            }
        }
    }
}

/// A binary frame whose first byte is 0x00 is a PTY protocol control frame
/// (cursor metadata), not terminal output.
fn is_meta_frame(bytes: &[u8]) -> bool {
    bytes.first() == Some(&0)
}

/// Sends one binary frame on the connection's WebSocket.
pub async fn pty_ws_send(connection_id: u64, data: Vec<u8>) -> Result<(), ApiError> {
    let sink = PTY_REGISTRY
        .take_sink(connection_id)
        .ok_or_else(|| ApiError::not_found(format!("pty connection {connection_id} not found")))?;
    let mut write = sink.lock().await;
    write
        .send(Message::Binary(data.into()))
        .await
        .map_err(|err| ApiError::network(format!("pty ws send failed: {err}")))
}

/// Closes the connection with the given id (idempotent). The read loop
/// observes the cancellation, pushes the closed envelope and removes its own
/// registry entry.
pub fn pty_ws_close(connection_id: u64) {
    if let Some(connection) = PTY_REGISTRY.remove(connection_id) {
        connection.token.cancel();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    /// Sink capturing pushes for assertions.
    #[derive(Clone)]
    struct TestSink {
        pushes: Arc<Mutex<Vec<serde_json::Value>>>,
    }

    impl TestSink {
        fn new() -> Self {
            Self {
                pushes: Arc::new(Mutex::new(Vec::new())),
            }
        }

        fn pushes(&self) -> Vec<serde_json::Value> {
            self.pushes.lock().unwrap().clone()
        }

        fn is_closed(&self) -> bool {
            self.pushes().iter().any(|push| {
                push.get("type").and_then(serde_json::Value::as_str) == Some("pty.ws.closed")
            })
        }

        /// Polls until `predicate` holds or the timeout elapses.
        async fn wait_until(&self, timeout: Duration, predicate: impl Fn() -> bool) -> bool {
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
    }

    impl PtySink for TestSink {
        fn send(&self, payload: serde_json::Value) -> Result<(), String> {
            self.pushes.lock().unwrap().push(payload);
            Ok(())
        }
    }

    /// In-process server speaking both sides of the PTY protocol on one
    /// loopback port: `POST /pty/{id}/connect-token` answers the JSON ticket
    /// and `GET /pty/{id}/connect` upgrades to a WebSocket that echoes every
    /// frame back. Request type is detected with TCP peek so the WS handshake
    /// can consume the untouched request head.
    async fn spawn_pty_test_server() -> std::net::SocketAddr {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    break;
                };
                tokio::spawn(async move {
                    let mut head = [0u8; 2048];
                    let mut peeked = 0usize;
                    loop {
                        match stream.peek(&mut head[peeked..]).await {
                            Ok(0) => return,
                            Ok(n) => peeked += n,
                            Err(_) => return,
                        }
                        if head[..peeked].windows(4).any(|w| w == b"\r\n\r\n") || peeked >= 2048 {
                            break;
                        }
                    }
                    let head = &head[..peeked];
                    if head.starts_with(b"POST ") {
                        // Token exchange: mirror the real server, which
                        // requires the `x-opencode-ticket: 1` marker header
                        // (403 without it). Drain the head, then answer.
                        let mut buffer = vec![0u8; 8192];
                        while stream.readable().await.is_ok() {
                            let mut chunk = [0u8; 1024];
                            match stream.try_read(&mut chunk) {
                                Ok(0) | Err(_) => break,
                                Ok(n) => {
                                    buffer.extend_from_slice(&chunk[..n]);
                                    if buffer.len() >= 8192 {
                                        break;
                                    }
                                }
                            }
                        }
                        let marker = b"x-opencode-ticket: 1";
                        let authorized = head
                            .to_ascii_lowercase()
                            .windows(marker.len())
                            .any(|window| window == marker);
                        let (status_line, body) = if authorized {
                            ("200 OK", r#"{"ticket":"t-pty-1","expires_in":60}"#)
                        } else {
                            (
                                "403 Forbidden",
                                r#"{"error":"Invalid PTY connect token request"}"#,
                            )
                        };
                        let response = format!(
                            "HTTP/1.1 {status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                            body.len(),
                        );
                        let _ = stream.try_write(response.as_bytes());
                    } else if head.starts_with(b"GET ") {
                        // WebSocket upgrade: let accept_async read the
                        // (still buffered) request head and complete the
                        // handshake, then mirror the real protocol — a
                        // control frame (0x00 + JSON cursor) precedes the
                        // echoed output — echo the first frame back and
                        // close, exercising server-initiated closes.
                        let Ok(ws) = tokio_tungstenite::accept_async(stream).await else {
                            return;
                        };
                        let (mut send, mut read) = ws.split();
                        let meta = [
                            0u8, b'{', b'"', b'c', b'u', b'r', b's', b'o', b'r', b'"', b':', b'0',
                            b'}',
                        ];
                        let _ = send.send(Message::Binary(meta.to_vec().into())).await;
                        if let Some(Ok(frame)) = read.next().await {
                            if send.send(frame).await.is_err() {
                                return;
                            }
                            // Echo exactly one frame, then close — exercising
                            // server-initiated closes.
                            let _ = send.send(Message::Close(None)).await;
                        }
                    }
                });
            }
        });
        addr
    }

    #[test]
    fn builds_ws_url_with_ticket_and_directory() {
        let url = build_ws_url(
            "http://localhost:14096",
            "pty_abc123",
            "ticket-1",
            Some("/proj"),
        )
        .unwrap();
        assert_eq!(url.scheme(), "ws");
        assert_eq!(url.host_str(), Some("localhost"));
        assert_eq!(url.port(), Some(14096));
        assert_eq!(url.path(), "/pty/pty_abc123/connect");
        let pairs: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(pairs.get("ticket").map(String::as_str), Some("ticket-1"));
        assert_eq!(pairs.get("directory").map(String::as_str), Some("/proj"));
    }

    #[test]
    fn builds_wss_url_for_https_bases() {
        let url = build_ws_url("https://example.com", "pty_1", "t", None).unwrap();
        assert_eq!(url.scheme(), "wss");
        assert_eq!(url.as_str(), "wss://example.com/pty/pty_1/connect?ticket=t");
    }

    #[test]
    fn rejects_invalid_bases_and_schemes() {
        let err = build_ws_url("not a url", "pty_1", "t", None).unwrap_err();
        assert_eq!(err.code, "invalid_url");
        let err = build_ws_url("ftp://example.com", "pty_1", "t", None).unwrap_err();
        assert_eq!(err.code, "invalid_url");
        let err = build_ws_url("http://", "pty_1", "t", None).unwrap_err();
        assert_eq!(err.code, "invalid_url");
    }

    #[test]
    fn envelopes_round_trip_binary_and_text_frames() {
        let payload = b"\x1b[32mhello\x00world\x1b[0m";
        let envelope = binary_envelope(payload);
        let bytes = envelope["bytes"].as_array().unwrap();
        assert_eq!(bytes.len(), payload.len());
        let decoded: Vec<u8> = bytes.iter().map(|b| b.as_u64().unwrap() as u8).collect();
        assert_eq!(decoded, payload);

        let text = binary_envelope("error note".as_bytes());
        assert_eq!(text["bytes"].as_array().unwrap().len(), 10);

        let closed = closed_envelope();
        assert_eq!(closed["type"], "pty.ws.closed");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn fetch_connect_ticket_parses_the_token_response() {
        let addr = spawn_pty_test_server().await;
        let ticket = fetch_connect_ticket(&format!("http://{addr}"), "pty_1", None)
            .await
            .unwrap();
        assert_eq!(ticket, "t-pty-1");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn fetch_connect_ticket_propagates_http_errors() {
        // A connect to a closed port classifies as a network error (retriable)
        // instead of parsing a bogus body.
        let err = fetch_connect_ticket("http://127.0.0.1:1", "pty_1", None)
            .await
            .unwrap_err();
        assert_eq!(err.code, "network");
        assert!(err.retriable);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn connect_token_requires_the_marker_header() {
        // The real server answers 403 when `x-opencode-ticket: 1` is missing;
        // the transport's fetch_connect_ticket sends it, so this path only
        // fails when someone drops the header.
        let addr = spawn_pty_test_server().await;
        let request = HttpRequest {
            url: Some(format!("http://{addr}")),
            method: "POST".to_string(),
            path: "/pty/pty_1/connect-token".to_string(),
            ..HttpRequest::default()
        };
        let err = crate::transport::http::http_request(request)
            .await
            .unwrap_err();
        assert_eq!(err.code, "http");
        assert_eq!(err.status, Some(403));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn spawn_connection_echoes_bytes_and_closes() {
        let addr = spawn_pty_test_server().await;
        let url = build_ws_url(&format!("http://{addr}"), "pty_1", "t", None).unwrap();
        let sink = TestSink::new();

        let id = spawn_connection(url, Arc::new(sink.clone())).await.unwrap();
        assert!(id >= 1);

        pty_ws_send(id, b"echo me".to_vec()).await.unwrap();
        let echoed = sink
            .wait_until(Duration::from_secs(5), || {
                sink.pushes().iter().any(|push| {
                    push.get("bytes")
                        .and_then(serde_json::Value::as_array)
                        .is_some_and(|bytes| {
                            bytes
                                .iter()
                                .map(|b| b.as_u64().unwrap() as u8)
                                .collect::<Vec<_>>()
                                == b"echo me"
                        })
                })
            })
            .await;
        assert!(echoed, "echo never arrived: {:?}", sink.pushes());

        // The server precedes output with a protocol control frame (0x00 +
        // JSON cursor); the read loop must drop it so it never renders in
        // the terminal.
        let no_meta_leak = sink.pushes().iter().all(|push| {
            push.get("bytes")
                .and_then(serde_json::Value::as_array)
                .and_then(|bytes| bytes.first())
                .and_then(serde_json::Value::as_u64)
                != Some(0)
        });
        assert!(
            no_meta_leak,
            "control frame leaked into the terminal: {:?}",
            sink.pushes()
        );

        // Close is idempotent and terminates the read loop with the closed
        // control frame.
        pty_ws_close(id);
        pty_ws_close(id);
        let closed = sink
            .wait_until(Duration::from_secs(5), || sink.is_closed())
            .await;
        assert!(closed, "closed envelope never arrived");
        assert!(
            PTY_REGISTRY.take_sink(id).is_none(),
            "registry not cleaned up"
        );

        // Sending on a closed connection is a not_found error.
        let err = pty_ws_send(id, vec![1]).await.unwrap_err();
        assert_eq!(err.code, "not_found");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn server_close_terminates_the_connection() {
        let addr = spawn_pty_test_server().await;
        let url = build_ws_url(&format!("http://{addr}"), "pty_1", "t", None).unwrap();
        let sink = TestSink::new();
        let id = spawn_connection(url, Arc::new(sink.clone())).await.unwrap();

        // The echo server reflects a Close frame back: the read loop must end
        // and clean its registry entry up on its own.
        pty_ws_send(id, b"bye".to_vec()).await.unwrap();
        let closed = sink
            .wait_until(Duration::from_secs(5), || sink.is_closed())
            .await;
        assert!(closed, "server close did not terminate the connection");
        assert!(
            PTY_REGISTRY.take_sink(id).is_none(),
            "registry not cleaned up"
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn full_connect_flow_fetches_ticket_then_connects_and_echoes() {
        // One base URL serves both the token exchange (REST) and the WS
        // upgrade, exactly like a real server — the full flow under test.
        let addr = spawn_pty_test_server().await;
        let base = format!("http://{addr}");
        let sink = TestSink::new();

        let id = pty_ws_connect_with_config(
            base,
            "pty_abc".to_string(),
            Some("/proj".to_string()),
            Arc::new(sink.clone()),
            None,
        )
        .await
        .unwrap();

        // Bytes sent over the WebSocket come back as binary envelopes.
        pty_ws_send(id, b"ls -la\r".to_vec()).await.unwrap();
        let echoed = sink
            .wait_until(Duration::from_secs(5), || {
                sink.pushes().iter().any(|push| {
                    push.get("bytes")
                        .and_then(serde_json::Value::as_array)
                        .is_some_and(|bytes| {
                            bytes
                                .iter()
                                .map(|b| b.as_u64().unwrap() as u8)
                                .collect::<Vec<_>>()
                                == b"ls -la\r"
                        })
                })
            })
            .await;
        assert!(echoed, "full-flow echo never arrived: {:?}", sink.pushes());

        pty_ws_close(id);
        assert!(PTY_REGISTRY.take_sink(id).is_none());
    }
}
