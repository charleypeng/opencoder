//! SSE subscription manager (ADR-002, TASK-M1-02).
//!
//! One tokio task per subscription: reqwest streams `text/event-stream`,
//! lines are parsed incrementally (surviving chunk boundaries and CRLF),
//! client-irrelevant events (`tui.*`, `workspace.*`) are dropped, and events
//! are batched into a single Channel push per 16ms window (IPC rate cap
//! ~60/s). Streams are kept alive with exponential-backoff reconnects
//! (1s -> 30s cap; reset to base after a connection that survived a minute)
//! and a 60s heartbeat timeout that forces a reconnect; after a successful
//! reconnect (i.e. a stream was already established at least once) a
//! `server.connected` event with `reconnected: true` is pushed so the TS
//! layer can trigger a full re-sync. Oversized payloads
//! (>64KB) are forwarded as raw JSON strings (`{ "__raw": ... }`) so the TS
//! side lazy-parses them instead of paying double serialization.

use crate::transport::http::{ApiError, Auth};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

use futures_util::StreamExt;

/// Payloads above this size are forwarded as `{ "__raw": <json string> }`.
const LARGE_PAYLOAD_BYTES: usize = 64 * 1024;

/// Sink abstraction over the tauri IPC channel so the stream machinery can be
/// unit-tested without a WebView.
pub(crate) trait SseSink: Send + Sync {
    /// Sends one payload; `Err` means the WebView is gone (permanent).
    fn send(&self, payload: serde_json::Value) -> Result<(), String>;
}

impl SseSink for tauri::ipc::Channel<serde_json::Value> {
    fn send(&self, payload: serde_json::Value) -> Result<(), String> {
        tauri::ipc::Channel::send(self, payload).map_err(|err| err.to_string())
    }
}

/// Tunables for the subscription loop; production defaults follow ADR-002
/// (1s backoff base, 30s cap, 60s heartbeat, 16ms batch window). Tests shrink
/// the timers to keep the suite fast.
#[derive(Debug, Clone)]
pub(crate) struct SseConfig {
    pub(crate) backoff_base: Duration,
    pub(crate) backoff_cap: Duration,
    /// A connection that lived at least this long proves the server is
    /// healthy, so the next retry starts from the backoff base again.
    pub(crate) backoff_reset_after: Duration,
    pub(crate) heartbeat_timeout: Duration,
    pub(crate) batch_window: Duration,
}

impl Default for SseConfig {
    fn default() -> Self {
        Self {
            backoff_base: Duration::from_secs(1),
            backoff_cap: Duration::from_secs(30),
            backoff_reset_after: Duration::from_secs(60),
            heartbeat_timeout: Duration::from_secs(60),
            batch_window: Duration::from_millis(16),
        }
    }
}

/// Per-subscription request details resolved before the task is spawned.
struct SubscribeParams {
    url: reqwest::Url,
    auth: Option<Auth>,
}

/// State shared between the stream task and its flusher task.
struct SubscriptionShared {
    sink: Arc<dyn SseSink>,
    /// Pending events merged into one push by the flusher.
    buffer: Mutex<Vec<serde_json::Value>>,
    /// Wakes the flusher when new events are buffered.
    notify: Notify,
    /// Set when the channel can no longer deliver (WebView destroyed).
    dead: AtomicBool,
}

impl SubscriptionShared {
    fn new(sink: Arc<dyn SseSink>) -> Self {
        Self {
            sink,
            buffer: Mutex::new(Vec::new()),
            notify: Notify::new(),
            dead: AtomicBool::new(false),
        }
    }

    fn push(&self, payload: serde_json::Value) {
        self.buffer.lock().unwrap().push(payload);
        self.notify.notify_one();
    }

    fn drain(&self) -> Vec<serde_json::Value> {
        std::mem::take(&mut *self.buffer.lock().unwrap())
    }

    fn is_dead(&self) -> bool {
        self.dead.load(Ordering::Relaxed)
    }
}

/// Handle of a live subscription: cancels the task and aborts it on demand.
struct SubscriptionHandle {
    token: CancellationToken,
    abort: tokio::task::AbortHandle,
}

/// Registry of live subscriptions; the task removes its own entry when it
/// terminates for any reason, so `sse_unsubscribe` stays idempotent.
struct SseRegistry {
    subscriptions: Mutex<HashMap<u64, SubscriptionHandle>>,
    next_id: AtomicU64,
}

impl SseRegistry {
    fn new() -> Self {
        Self {
            subscriptions: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
        }
    }

    fn next_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    fn insert(&self, id: u64, handle: SubscriptionHandle) {
        self.subscriptions.lock().unwrap().insert(id, handle);
    }

    fn remove(&self, id: u64) -> Option<SubscriptionHandle> {
        self.subscriptions.lock().unwrap().remove(&id)
    }
}

static SSE_REGISTRY: LazyLock<SseRegistry> = LazyLock::new(SseRegistry::new);

/// Subscribes to a server's SSE stream and returns a subscription id.
///
/// `directory` selects `/event?directory=...`; without one the global
/// `/global/event` stream is used. The base URL is resolved against the
/// server registry in the commands layer (TASK-M1-03) and passed in
/// directly. Events arrive on `channel` as single parsed values or 16ms
/// batches of arrays.
pub fn sse_subscribe(
    base_url: String,
    directory: Option<String>,
    channel: tauri::ipc::Channel<serde_json::Value>,
    auth: Option<Auth>,
) -> Result<u64, ApiError> {
    subscribe_with_config(
        base_url,
        directory,
        Arc::new(channel),
        auth,
        SseConfig::default(),
    )
}

/// Stops the subscription with the given id: the task is cancelled and
/// aborted, dropping the stream and any pending reconnect.
pub fn sse_unsubscribe(subscription_id: u64) {
    if let Some(handle) = SSE_REGISTRY.remove(subscription_id) {
        handle.token.cancel();
        handle.abort.abort();
    }
}

/// Testable variant of `sse_subscribe` with a pluggable sink and timers.
pub(crate) fn subscribe_with_config(
    base_url: String,
    directory: Option<String>,
    sink: Arc<dyn SseSink>,
    auth: Option<Auth>,
    config: SseConfig,
) -> Result<u64, ApiError> {
    let params = SubscribeParams {
        url: build_url(&base_url, directory.as_deref())?,
        auth,
    };
    Ok(spawn_subscription(config, params, sink))
}

fn build_url(base: &str, directory: Option<&str>) -> Result<reqwest::Url, ApiError> {
    let base = reqwest::Url::parse(base)
        .map_err(|_| ApiError::invalid_url(format!("invalid base url: {base}")))?;
    let path = if directory.is_some() {
        "/event"
    } else {
        "/global/event"
    };
    let mut url = base
        .join(path)
        .map_err(|_| ApiError::invalid_url(format!("invalid path: {path}")))?;
    if let Some(directory) = directory {
        url.query_pairs_mut().append_pair("directory", directory);
    }
    Ok(url)
}

fn spawn_subscription(config: SseConfig, params: SubscribeParams, sink: Arc<dyn SseSink>) -> u64 {
    let id = SSE_REGISTRY.next_id();
    let token = CancellationToken::new();
    let shared = Arc::new(SubscriptionShared::new(sink));

    let flush_token = token.child_token();
    let flusher_shared = Arc::clone(&shared);
    let flusher_token = flush_token.clone();
    let batch_window = config.batch_window;
    // Spawn through tauri's async runtime: `sse_subscribe` is a sync Tauri
    // command running on the main thread outside any tokio runtime context,
    // so raw `tokio::spawn` panicked ("no reactor running") on subscribe.
    let flusher = tauri::async_runtime::spawn(async move {
        flusher_loop(&flusher_shared, &flusher_token, batch_window).await;
    });

    let task_token = token.clone();
    let task = tauri::async_runtime::spawn(async move {
        run_subscription(config, params, Arc::clone(&shared), task_token).await;
        // Cancel the flusher and drain whatever is still buffered.
        flush_token.cancel();
        let _ = flusher.await;
        SSE_REGISTRY.remove(id);
    });

    SSE_REGISTRY.insert(
        id,
        SubscriptionHandle {
            token,
            abort: task.inner().abort_handle(),
        },
    );
    id
}

/// Drains the shared buffer every `window` after being notified; one push per
/// batch. Exits on cancellation and flushes whatever remains.
async fn flusher_loop(
    shared: &Arc<SubscriptionShared>,
    token: &CancellationToken,
    window: Duration,
) {
    loop {
        tokio::select! {
            biased;
            _ = token.cancelled() => break,
            _ = shared.notify.notified() => {
                // Let the window elapse so a burst of deltas coalesces.
                tokio::select! {
                    biased;
                    _ = token.cancelled() => break,
                    _ = tokio::time::sleep(window) => {}
                }
                if !flush(shared) {
                    break;
                }
            }
        }
    }
    flush(shared);
}

/// Sends the buffered batch as a single array push; `false` when the sink is
/// permanently broken.
fn flush(shared: &Arc<SubscriptionShared>) -> bool {
    let batch = shared.drain();
    if batch.is_empty() {
        return true;
    }
    match shared.sink.send(serde_json::Value::Array(batch)) {
        Ok(()) => true,
        Err(_) => {
            shared.dead.store(true, Ordering::Relaxed);
            false
        }
    }
}

enum StreamFailure {
    /// Connection or heartbeat problem; retry with backoff.
    Transient,
    /// Permanent (4xx response or destroyed channel); stop the subscription.
    Fatal,
}

/// Reconnect loop: connects, streams, and on any failure waits with
/// exponential backoff before retrying. Non-retriable failures (4xx HTTP,
/// destroyed channel) end the subscription.
async fn run_subscription(
    config: SseConfig,
    params: SubscribeParams,
    shared: Arc<SubscriptionShared>,
    token: CancellationToken,
) {
    let client = match reqwest::Client::builder().use_rustls_tls().build() {
        Ok(client) => client,
        Err(_) => return,
    };
    let mut backoff = config.backoff_base;
    let mut ever_connected = false;
    loop {
        if token.is_cancelled() || shared.is_dead() {
            break;
        }
        let attempt_started = Instant::now();
        match connect_and_stream(
            &config,
            &params,
            &client,
            &shared,
            &token,
            &mut ever_connected,
        )
        .await
        {
            Err(StreamFailure::Fatal) => break,
            Ok(()) | Err(StreamFailure::Transient) => {}
        }
        // A stream that survived long enough proves the server is healthy;
        // reset the backoff so a subsequent drop reconnects promptly
        // instead of compounding the delay at the 30s cap.
        if attempt_started.elapsed() >= config.backoff_reset_after {
            backoff = config.backoff_base;
        }
        if token.is_cancelled() || shared.is_dead() {
            break;
        }
        tokio::select! {
            biased;
            _ = token.cancelled() => break,
            _ = tokio::time::sleep(backoff) => {}
        }
        backoff = (backoff * 2).min(config.backoff_cap);
    }
}

/// Opens one SSE connection, parses the stream and forwards events into the
/// shared batch buffer. Returns when the stream ends (EOF, error, heartbeat
/// timeout, or explicit cancellation).
///
/// `ever_connected` tracks whether any stream has been established so far:
/// reconnects (a stream was already established once) announce themselves
/// with a `server.connected` marker; the first successful stream never does.
async fn connect_and_stream(
    config: &SseConfig,
    params: &SubscribeParams,
    client: &reqwest::Client,
    shared: &Arc<SubscriptionShared>,
    token: &CancellationToken,
    ever_connected: &mut bool,
) -> Result<(), StreamFailure> {
    let mut request = client.get(params.url.clone());
    if let Some(auth) = &params.auth {
        if let Some(password) = &auth.password {
            let username = auth.username.as_deref().unwrap_or("");
            request = request.basic_auth(username, Some(password));
        }
    }
    let response = match request.send().await {
        Ok(response) => response,
        Err(_) => return Err(StreamFailure::Transient),
    };
    if !response.status().is_success() {
        return if response.status().as_u16() < 500 {
            Err(StreamFailure::Fatal)
        } else {
            Err(StreamFailure::Transient)
        };
    }
    // Reconnects are announced so the TS layer can re-align its state; a
    // stream that never established once is not a reconnect, so only the
    // second successful connection onwards pushes the marker.
    if *ever_connected {
        shared.push(serde_json::json!({
            "type": "server.connected",
            "properties": { "reconnected": true },
        }));
    }
    *ever_connected = true;

    let last_activity = Arc::new(Mutex::new(Instant::now()));
    let stream_token = token.child_token();

    // Heartbeat monitor: when the stream produces no data for the timeout,
    // cancel the stream so the reconnect loop takes over.
    let monitor_token = stream_token.clone();
    let cancel_stream = stream_token.clone();
    let monitor_activity = Arc::clone(&last_activity);
    let monitor_interval = config.heartbeat_timeout / 4;
    let monitor_timeout = config.heartbeat_timeout;
    let monitor = tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(monitor_interval);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        interval.tick().await;
        loop {
            tokio::select! {
                _ = monitor_token.cancelled() => break,
                _ = interval.tick() => {
                    if monitor_activity.lock().unwrap().elapsed() > monitor_timeout {
                        cancel_stream.cancel();
                        break;
                    }
                }
            }
        }
    });

    let stream = response.bytes_stream();
    tokio::pin!(stream);
    let mut splitter = LineSplitter::new();
    let mut assembler = EventAssembler::default();
    let mut outcome = Ok(());
    loop {
        let next = tokio::select! {
            biased;
            _ = stream_token.cancelled() => {
                outcome = Err(StreamFailure::Transient);
                break;
            }
            next = stream.next() => next,
        };
        match next {
            Some(Ok(bytes)) => {
                *last_activity.lock().unwrap() = Instant::now();
                for line in splitter.feed(&bytes) {
                    if let Some(event) = assembler.on_line(&line) {
                        enqueue_event(shared, event);
                    }
                }
                if shared.is_dead() {
                    outcome = Err(StreamFailure::Fatal);
                    break;
                }
            }
            Some(Err(_)) => {
                outcome = Err(StreamFailure::Transient);
                break;
            }
            None => break,
        }
    }
    // Flush a trailing event without its terminating blank line, then stop
    // the heartbeat monitor.
    for line in splitter.finish() {
        if let Some(event) = assembler.on_line(&line) {
            enqueue_event(shared, event);
        }
    }
    if let Some(event) = assembler.finish() {
        enqueue_event(shared, event);
    }
    stream_token.cancel();
    let _ = monitor.await;
    outcome
}

/// Filters and buffers one parsed event; oversized payloads are forwarded as
/// raw JSON strings for lazy parsing on the TS side.
fn enqueue_event(shared: &Arc<SubscriptionShared>, event: ParsedEvent) {
    if is_filtered(&event) {
        return;
    }
    let payload = if event.raw.len() > LARGE_PAYLOAD_BYTES {
        serde_json::json!({ "__raw": event.raw })
    } else {
        event.value
    };
    shared.push(payload);
}

/// A single SSE event: the parsed envelope plus its raw `data:` payload.
struct ParsedEvent {
    value: serde_json::Value,
    raw: String,
}

/// Client-irrelevant event types (`tui.*`, `workspace.*`) are dropped here;
/// global envelopes carry the event type inside `payload`.
fn is_filtered(event: &ParsedEvent) -> bool {
    let event_type = event
        .value
        .get("type")
        .and_then(serde_json::Value::as_str)
        .or_else(|| {
            event
                .value
                .get("payload")
                .and_then(|payload| payload.get("type"))
                .and_then(serde_json::Value::as_str)
        });
    matches!(
        event_type,
        Some(event_type) if event_type.starts_with("tui.") || event_type.starts_with("workspace.")
    )
}

/// Incremental line splitter that survives chunk boundaries: a chunk may end
/// mid-line and a later chunk completes it. CRLF streams are handled by
/// stripping a trailing `\r`.
struct LineSplitter {
    pending: Vec<u8>,
}

impl LineSplitter {
    fn new() -> Self {
        Self {
            pending: Vec::new(),
        }
    }

    /// Appends a chunk and returns every completed line (without the `\n`).
    fn feed(&mut self, chunk: &[u8]) -> Vec<Vec<u8>> {
        self.pending.extend_from_slice(chunk);
        let mut lines = Vec::new();
        let mut start = 0;
        for (index, byte) in self.pending.iter().enumerate() {
            if *byte == b'\n' {
                lines.push(Self::strip_cr(&self.pending[start..index]));
                start = index + 1;
            }
        }
        if start > 0 {
            self.pending.drain(..start);
        }
        lines
    }

    /// Remaining partial line when the stream ends without a trailing `\n`.
    fn finish(self) -> Vec<Vec<u8>> {
        if self.pending.is_empty() {
            Vec::new()
        } else {
            vec![Self::strip_cr(&self.pending)]
        }
    }

    fn strip_cr(line: &[u8]) -> Vec<u8> {
        if line.last() == Some(&b'\r') {
            line[..line.len() - 1].to_vec()
        } else {
            line.to_vec()
        }
    }
}

/// Assembles SSE events from lines: `data:` payloads accumulate until a blank
/// line completes the event; comments and `event:`/`id:` fields are ignored.
#[derive(Default)]
struct EventAssembler {
    data: Vec<String>,
}

impl EventAssembler {
    /// Feeds one line; `Some` when a blank line completed an event.
    fn on_line(&mut self, line: &[u8]) -> Option<ParsedEvent> {
        if line.is_empty() {
            return self.finish();
        }
        if line.starts_with(b":") {
            return None;
        }
        if let Some(rest) = line.strip_prefix(b"data:") {
            let text = rest.strip_prefix(b" ").unwrap_or(rest);
            self.data.push(String::from_utf8_lossy(text).into_owned());
        }
        None
    }

    /// Completes the pending event (blank line or end of stream). Malformed
    /// JSON payloads are dropped.
    fn finish(&mut self) -> Option<ParsedEvent> {
        if self.data.is_empty() {
            return None;
        }
        let raw = self.data.join("\n");
        self.data.clear();
        serde_json::from_str(&raw)
            .ok()
            .map(|value| ParsedEvent { value, raw })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::{SocketAddr, TcpListener, TcpStream};
    use std::sync::atomic::AtomicUsize;

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

        fn push_count(&self) -> usize {
            self.pushes.lock().unwrap().len()
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

    impl SseSink for TestSink {
        fn send(&self, payload: serde_json::Value) -> Result<(), String> {
            self.pushes.lock().unwrap().push(payload);
            Ok(())
        }
    }

    /// A scripted SSE server: each accepted connection gets the scripted
    /// response for its connection index. Handlers run on their own thread so
    /// a slow connection never blocks the accept loop.
    struct SseTestServer {
        addr: SocketAddr,
        connections: Arc<AtomicUsize>,
        accepted_at: Arc<Mutex<Vec<Instant>>>,
        closed_at: Arc<Mutex<Vec<Instant>>>,
        stop: Arc<AtomicBool>,
        thread: Option<std::thread::JoinHandle<()>>,
    }

    impl SseTestServer {
        fn start(script: impl Fn(usize) -> ScriptedResponse + Send + Sync + 'static) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            listener.set_nonblocking(true).unwrap();
            let addr = listener.local_addr().unwrap();
            let connections = Arc::new(AtomicUsize::new(0));
            let accepted_at = Arc::new(Mutex::new(Vec::new()));
            let closed_at = Arc::new(Mutex::new(Vec::new()));
            let stop = Arc::new(AtomicBool::new(false));
            let thread = std::thread::spawn({
                let connections = Arc::clone(&connections);
                let accepted_at = Arc::clone(&accepted_at);
                let closed_at = Arc::clone(&closed_at);
                let stop = Arc::clone(&stop);
                move || {
                    let mut index = 0usize;
                    while !stop.load(Ordering::Relaxed) {
                        match listener.accept() {
                            Ok((stream, _)) => {
                                connections.fetch_add(1, Ordering::Relaxed);
                                accepted_at.lock().unwrap().push(Instant::now());
                                let response = script(index);
                                index += 1;
                                let closed_at = Arc::clone(&closed_at);
                                std::thread::spawn(move || {
                                    serve_connection(stream, response, closed_at)
                                });
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
                accepted_at,
                closed_at,
                stop,
                thread: Some(thread),
            }
        }

        fn connection_count(&self) -> usize {
            self.connections.load(Ordering::Relaxed)
        }

        fn accepted_times(&self) -> Vec<Instant> {
            self.accepted_at.lock().unwrap().clone()
        }

        /// Timestamps of every server-side connection close, indexed like
        /// `accepted_times`; lets tests measure the client's retry delay
        /// independently of how long a connection stayed alive.
        fn closed_times(&self) -> Vec<Instant> {
            self.closed_at.lock().unwrap().clone()
        }
    }

    impl Drop for SseTestServer {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::Relaxed);
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }

    #[derive(Clone)]
    struct ScriptedResponse {
        status: String,
        frames: Vec<String>,
        close: bool,
        /// When set, the connection stays open for this long before closing.
        close_after: Option<Duration>,
    }

    impl ScriptedResponse {
        fn ok(frames: Vec<String>, close: bool) -> Self {
            Self {
                status: "HTTP/1.1 200 OK".to_string(),
                frames,
                close,
                close_after: None,
            }
        }

        fn status_only(status: u16) -> Self {
            Self {
                status: format!("HTTP/1.1 {status} Error"),
                frames: Vec::new(),
                close: true,
                close_after: None,
            }
        }
    }

    fn sse_frame(value: &serde_json::Value) -> String {
        format!("data: {}\n\n", serde_json::to_string(value).unwrap())
    }

    fn serve_connection(
        mut stream: TcpStream,
        response: ScriptedResponse,
        closed_at: Arc<Mutex<Vec<Instant>>>,
    ) {
        read_request_head(&stream);
        let mut payload = format!(
            "{}\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n\r\n",
            response.status,
        );
        for frame in &response.frames {
            payload.push_str(frame);
        }
        let _ = stream.write_all(payload.as_bytes());
        let _ = stream.flush();
        if let Some(hold) = response.close_after {
            std::thread::sleep(hold);
            closed_at.lock().unwrap().push(Instant::now());
            let _ = stream.shutdown(std::net::Shutdown::Both);
        } else if response.close {
            closed_at.lock().unwrap().push(Instant::now());
            let _ = stream.shutdown(std::net::Shutdown::Both);
        } else {
            // Keep the connection open until the client goes away.
            let mut buf = [0u8; 1024];
            while stream.read(&mut buf).unwrap_or(0) > 0 {}
            closed_at.lock().unwrap().push(Instant::now());
        }
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

    /// Runs a full stream-fed event parse (chunk, then EOF flush).
    fn parse_frames(frames: &[u8]) -> Vec<serde_json::Value> {
        let mut splitter = LineSplitter::new();
        let mut assembler = EventAssembler::default();
        let mut events = Vec::new();
        for line in splitter.feed(frames) {
            if let Some(event) = assembler.on_line(&line) {
                events.push(event.value);
            }
        }
        for line in splitter.finish() {
            if let Some(event) = assembler.on_line(&line) {
                events.push(event.value);
            }
        }
        if let Some(event) = assembler.finish() {
            events.push(event.value);
        }
        events
    }

    fn parse_chunked(chunks: &[&[u8]]) -> Vec<serde_json::Value> {
        let mut splitter = LineSplitter::new();
        let mut assembler = EventAssembler::default();
        let mut events = Vec::new();
        for chunk in chunks {
            for line in splitter.feed(chunk) {
                if let Some(event) = assembler.on_line(&line) {
                    events.push(event.value);
                }
            }
        }
        for line in splitter.finish() {
            if let Some(event) = assembler.on_line(&line) {
                events.push(event.value);
            }
        }
        if let Some(event) = assembler.finish() {
            events.push(event.value);
        }
        events
    }

    #[test]
    fn parses_event_split_across_chunk_boundaries() {
        let events = parse_chunked(&[
            b"data: {\"id\": \"a\", \"ty",
            b"pe\": \"session.created\", \"properties\": {}}\n\n",
        ]);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0]["id"], "a");
        assert_eq!(events[0]["type"], "session.created");
    }

    #[test]
    fn handles_crlf_line_endings() {
        let events = parse_frames(b"data: {\"type\": \"session.idle\"}\r\n\r\n");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0]["type"], "session.idle");
    }

    #[test]
    fn ignores_comment_lines_and_fields() {
        let events = parse_frames(
            b": ping\nid: 42\nevent: custom\ndata: {\"type\": \"a\"}\n\n: keep-alive\n",
        );
        assert_eq!(events.len(), 1);
        assert_eq!(events[0]["type"], "a");
    }

    #[test]
    fn drops_malformed_data_payloads() {
        let events = parse_frames(b"data: {not json\n\n");
        assert!(events.is_empty());
    }

    #[test]
    fn flushes_trailing_event_without_blank_line() {
        let events = parse_frames(b"data: {\"type\": \"c\"}");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0]["type"], "c");
    }

    #[test]
    fn joins_multiple_data_lines_into_one_payload() {
        // Two `data:` lines are joined with a newline; a JSON object spanning
        // them stays parseable.
        let events = parse_frames(b"data: {\"type\": \"d\",\ndata: \"n\": 1}\n\n");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0]["type"], "d");
        assert_eq!(events[0]["n"], 1);
    }

    #[test]
    fn drops_tui_and_workspace_event_types() {
        let filtered = |event_type: &str| {
            is_filtered(&ParsedEvent {
                value: serde_json::json!({ "type": event_type }),
                raw: String::new(),
            })
        };
        assert!(filtered("tui.preview"));
        assert!(filtered("tui.theme.updated"));
        assert!(filtered("workspace.files.updated"));
        assert!(!filtered("session.created"));
        assert!(!filtered("message.part.delta"));

        let global = ParsedEvent {
            value: serde_json::json!({
                "directory": "/x",
                "payload": { "type": "workspace.synced" },
            }),
            raw: String::new(),
        };
        assert!(is_filtered(&global));
    }

    #[test]
    fn builds_directory_and_global_urls() {
        let url = build_url("http://localhost:14096", Some("/proj")).unwrap();
        assert_eq!(
            url.as_str(),
            "http://localhost:14096/event?directory=%2Fproj"
        );
        let url = build_url("http://localhost:14096/", None).unwrap();
        assert_eq!(url.as_str(), "http://localhost:14096/global/event");
    }

    #[test]
    fn invalid_base_url_is_invalid() {
        let sink = TestSink::new();
        let err = subscribe_with_config(
            "not a url".to_string(),
            None,
            Arc::new(sink),
            None,
            SseConfig::default(),
        )
        .unwrap_err();
        assert_eq!(err.code, "invalid_url");
        assert!(!err.retriable);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn batch_window_merges_events_into_one_push() {
        let sink = TestSink::new();
        let shared = Arc::new(SubscriptionShared::new(Arc::new(sink.clone())));
        let token = CancellationToken::new();
        let flush_token = token.child_token();
        let flusher_shared = Arc::clone(&shared);
        let flusher = tokio::spawn(async move {
            flusher_loop(&flusher_shared, &flush_token, Duration::from_millis(50)).await;
        });

        // Three deltas arriving within the window coalesce into one push.
        for index in 0..3 {
            shared.push(serde_json::json!({
                "id": index.to_string(),
                "type": "message.part.delta",
            }));
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        let flushed = sink
            .wait_until(Duration::from_secs(2), || sink.push_count() >= 1)
            .await;
        assert!(flushed, "batch never flushed");
        assert_eq!(sink.push_count(), 1);
        let pushes = sink.pushes();
        let batch = pushes[0].as_array().unwrap();
        assert_eq!(batch.len(), 3);
        assert_eq!(batch[0]["id"], "0");
        assert_eq!(batch[2]["id"], "2");

        // Nothing else arrives after the batch settles.
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(sink.push_count(), 1);

        token.cancel();
        let _ = flusher.await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn flusher_drains_pending_events_on_cancel() {
        let sink = TestSink::new();
        let shared = Arc::new(SubscriptionShared::new(Arc::new(sink.clone())));
        let token = CancellationToken::new();
        let flush_token = token.child_token();
        let flusher_shared = Arc::clone(&shared);
        let flusher = tokio::spawn(async move {
            flusher_loop(&flusher_shared, &flush_token, Duration::from_secs(60)).await;
        });

        shared.push(serde_json::json!({ "type": "session.created" }));
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(sink.push_count(), 0);

        // Cancelling mid-window still flushes the buffered events.
        token.cancel();
        let _ = flusher.await;
        assert_eq!(sink.push_count(), 1);
        let pushes = sink.pushes();
        assert_eq!(pushes[0].as_array().unwrap().len(), 1);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn reconnects_with_backoff_and_replays_events() {
        let server = SseTestServer::start(|connection| {
            if connection == 0 {
                ScriptedResponse::ok(
                    vec![
                        sse_frame(&serde_json::json!({
                            "id": "e1",
                            "type": "session.created",
                            "properties": {},
                        })),
                        sse_frame(&serde_json::json!({
                            "id": "e2",
                            "type": "session.status",
                            "properties": { "status": { "type": "busy" } },
                        })),
                    ],
                    true,
                )
            } else {
                // Later connections stay open so the test observes exactly
                // one reconnect.
                ScriptedResponse::ok(
                    vec![sse_frame(&serde_json::json!({
                        "id": "e3",
                        "type": "session.idle",
                        "properties": {},
                    }))],
                    false,
                )
            }
        });
        let base_url = format!("http://{}", server.addr);

        let sink = TestSink::new();
        let config = SseConfig {
            backoff_base: Duration::from_millis(50),
            heartbeat_timeout: Duration::from_secs(5),
            ..SseConfig::default()
        };
        let id = subscribe_with_config(
            base_url,
            Some("/proj".to_string()),
            Arc::new(sink.clone()),
            None,
            config,
        )
        .unwrap();

        // Events from both connections plus the reconnected marker.
        let arrived = sink
            .wait_until(Duration::from_secs(5), || {
                flattened(sink.pushes()).len() >= 4
            })
            .await;
        assert!(
            arrived,
            "events after reconnect never arrived: {:?}",
            sink.pushes()
        );

        let events = flattened(sink.pushes());
        let types: Vec<String> = events
            .iter()
            .map(|event| event["type"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(
            types,
            vec![
                "session.created".to_string(),
                "session.status".to_string(),
                "server.connected".to_string(),
                "session.idle".to_string(),
            ]
        );
        let marker = events
            .iter()
            .find(|event| event["type"] == "server.connected")
            .unwrap();
        assert_eq!(marker["properties"]["reconnected"], true);

        // The retry only happens after the backoff base elapsed.
        let times = server.accepted_times();
        assert!(times.len() >= 2, "expected a second connection attempt");
        assert!(
            times[1].duration_since(times[0]) >= Duration::from_millis(40),
            "reconnect happened before the backoff delay"
        );

        sse_unsubscribe(id);
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(server.connection_count(), 2);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn heartbeat_timeout_forces_reconnect() {
        let server = SseTestServer::start(|_| ScriptedResponse::ok(Vec::new(), false));
        let base_url = format!("http://{}", server.addr);

        let sink = TestSink::new();
        let config = SseConfig {
            backoff_base: Duration::from_millis(50),
            heartbeat_timeout: Duration::from_millis(200),
            ..SseConfig::default()
        };
        let id =
            subscribe_with_config(base_url, None, Arc::new(sink.clone()), None, config).unwrap();

        // A silent stream trips the heartbeat timeout and reconnects.
        let reconnected = sink
            .wait_until(Duration::from_secs(5), || server.connection_count() >= 2)
            .await;
        assert!(reconnected, "heartbeat timeout did not trigger a reconnect");
        assert!(
            sink.pushes().is_empty(),
            "silent stream must not emit events"
        );

        sse_unsubscribe(id);
        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn backoff_resets_after_a_long_lived_connection() {
        let event = |id: &str| {
            sse_frame(&serde_json::json!({
                "id": id,
                "type": "session.idle",
                "properties": {},
            }))
        };
        let server = SseTestServer::start(move |connection| match connection {
            // Short-lived: drops immediately, so the backoff would escalate.
            0 => ScriptedResponse::ok(vec![event("e0")], true),
            // Long-lived: survives past the reset threshold (300ms > 250ms).
            1 => ScriptedResponse {
                status: "HTTP/1.1 200 OK".to_string(),
                frames: vec![event("e1")],
                close: false,
                close_after: Some(Duration::from_millis(300)),
            },
            // Stays open so the test observes the reset reconnect.
            _ => ScriptedResponse::ok(vec![event("e2")], false),
        });
        let base_url = format!("http://{}", server.addr);

        let sink = TestSink::new();
        let config = SseConfig {
            backoff_base: Duration::from_millis(50),
            backoff_reset_after: Duration::from_millis(250),
            heartbeat_timeout: Duration::from_secs(2),
            ..SseConfig::default()
        };
        let id =
            subscribe_with_config(base_url, None, Arc::new(sink.clone()), None, config).unwrap();

        let reconnected = sink
            .wait_until(Duration::from_secs(5), || server.connection_count() >= 3)
            .await;
        assert!(
            reconnected,
            "third connection never established: {:?}",
            server.accepted_times()
        );

        // After the 300ms connection the retry must come at the 50ms base,
        // not at the doubled 100ms a never-resetting backoff would use.
        // The delay is measured from the server-side close so the
        // connection's own 300ms lifetime does not skew the gap.
        let times = server.accepted_times();
        let closes = server.closed_times();
        let backoff_delay = times[2].duration_since(closes[1]);
        assert!(
            backoff_delay >= Duration::from_millis(40),
            "reconnect happened before the backoff base: {backoff_delay:?}"
        );
        assert!(
            backoff_delay < Duration::from_millis(75),
            "backoff did not reset after a long-lived connection: {backoff_delay:?}"
        );

        sse_unsubscribe(id);
        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn no_reconnect_marker_before_first_successful_stream() {
        let server = SseTestServer::start(|connection| match connection {
            // The first attempt fails before any stream is established.
            0 => ScriptedResponse::status_only(500),
            // The second attempt succeeds; it is not a reconnect.
            1 => ScriptedResponse::ok(
                vec![sse_frame(&serde_json::json!({
                    "id": "e1",
                    "type": "session.created",
                    "properties": {},
                }))],
                true,
            ),
            // Later connections are reconnects and announce the marker.
            _ => ScriptedResponse::ok(
                vec![sse_frame(&serde_json::json!({
                    "id": "e2",
                    "type": "session.idle",
                    "properties": {},
                }))],
                false,
            ),
        });
        let base_url = format!("http://{}", server.addr);

        let sink = TestSink::new();
        let config = SseConfig {
            backoff_base: Duration::from_millis(20),
            heartbeat_timeout: Duration::from_secs(2),
            ..SseConfig::default()
        };
        let id =
            subscribe_with_config(base_url, None, Arc::new(sink.clone()), None, config).unwrap();

        let arrived = sink
            .wait_until(Duration::from_secs(5), || {
                flattened(sink.pushes()).len() >= 3
            })
            .await;
        assert!(
            arrived,
            "events after reconnect never arrived: {:?}",
            sink.pushes()
        );

        // No marker may precede the first successful stream's events.
        let events = flattened(sink.pushes());
        let types: Vec<String> = events
            .iter()
            .map(|event| event["type"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(
            types,
            vec![
                "session.created".to_string(),
                "server.connected".to_string(),
                "session.idle".to_string(),
            ]
        );
        let marker = events
            .iter()
            .find(|event| event["type"] == "server.connected")
            .unwrap();
        assert_eq!(marker["properties"]["reconnected"], true);

        sse_unsubscribe(id);
        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn auth_failure_terminates_without_reconnect() {
        let server = SseTestServer::start(|_| ScriptedResponse::status_only(401));
        let base_url = format!("http://{}", server.addr);

        let sink = TestSink::new();
        let id = subscribe_with_config(
            base_url,
            None,
            Arc::new(sink.clone()),
            None,
            SseConfig::default(),
        )
        .unwrap();

        tokio::time::sleep(Duration::from_millis(500)).await;
        assert_eq!(
            server.connection_count(),
            1,
            "401 must not trigger a reconnect"
        );
        assert!(sink.pushes().is_empty());

        sse_unsubscribe(id);
    }

    #[test]
    fn oversized_payloads_are_forwarded_as_raw_strings() {
        let sink = TestSink::new();
        let shared = Arc::new(SubscriptionShared::new(Arc::new(sink.clone())));
        let big = "x".repeat(LARGE_PAYLOAD_BYTES + 10);
        enqueue_event(
            &shared,
            ParsedEvent {
                value: serde_json::json!({ "type": "message.part.delta", "properties": {} }),
                raw: format!("{{\"delta\":\"{big}\"}}"),
            },
        );
        enqueue_event(
            &shared,
            ParsedEvent {
                value: serde_json::json!({ "type": "session.idle", "properties": {} }),
                raw: "{\"type\":\"session.idle\"}".to_string(),
            },
        );
        assert_eq!(shared.buffer.lock().unwrap().len(), 2);
        let raw = shared.buffer.lock().unwrap()[0].clone();
        assert!(
            raw.get("__raw").is_some(),
            "large payload must be wrapped in __raw"
        );
        let small = shared.buffer.lock().unwrap()[1].clone();
        assert!(small.get("__raw").is_none());
        assert_eq!(small["type"], "session.idle");
    }

    fn flattened(pushes: Vec<serde_json::Value>) -> Vec<serde_json::Value> {
        pushes
            .into_iter()
            .flat_map(|push| match push {
                serde_json::Value::Array(items) => items.into_iter().collect::<Vec<_>>(),
                other => vec![other],
            })
            .collect()
    }
}
