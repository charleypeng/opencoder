//! REST transport channel (ADR-002, TASK-M1-01).
//!
//! Exposes `http_request` / `http_cancel` to the Tauri commands layer.
//! All requests go through reqwest (rustls TLS) so the WebView never makes
//! cross-origin requests; Basic Auth is injected here and never logged.

use reqwest::Method;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

/// Credentials for Basic Auth. The header is only sent when `password` is
/// present (matching the OpenCode `OPENCODE_SERVER_PASSWORD` behavior).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Auth {
    pub username: Option<String>,
    pub password: Option<String>,
}

/// Input of the `http_request` command.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    #[serde(rename = "serverID")]
    pub server_id: Option<String>,
    pub url: Option<String>,
    pub method: String,
    pub path: String,
    pub query: Option<serde_json::Value>,
    pub body: Option<serde_json::Value>,
    pub auth: Option<Auth>,
    pub timeout_ms: Option<u64>,
    #[serde(rename = "requestID")]
    pub request_id: Option<String>,
}

/// Error classification serialized to the frontend. `status` is set for HTTP
/// error responses and registry lookups (404); `code` is one of "network",
/// "timeout", "http", "invalid_url", "cancelled", "not_found", "persist".
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiError {
    pub status: Option<u16>,
    pub code: String,
    pub message: String,
    pub retriable: bool,
}

impl ApiError {
    fn new(code: &str, status: Option<u16>, message: impl Into<String>, retriable: bool) -> Self {
        Self {
            status,
            code: code.to_string(),
            message: message.into(),
            retriable,
        }
    }

    pub(crate) fn network(message: impl Into<String>) -> Self {
        Self::new("network", None, message, true)
    }

    fn timeout(message: impl Into<String>) -> Self {
        Self::new("timeout", None, message, true)
    }

    pub(crate) fn invalid_url(message: impl Into<String>) -> Self {
        Self::new("invalid_url", None, message, false)
    }

    fn cancelled(message: impl Into<String>) -> Self {
        Self::new("cancelled", None, message, false)
    }

    pub(crate) fn http(status: u16, message: impl Into<String>) -> Self {
        Self::new("http", Some(status), message, status >= 500)
    }

    /// Server registry lookup failed (unknown id).
    pub(crate) fn not_found(message: impl Into<String>) -> Self {
        Self::new("not_found", Some(404), message, false)
    }

    /// Server registry persistence failed.
    pub(crate) fn persist(message: impl Into<String>) -> Self {
        Self::new("persist", Some(500), message, false)
    }
}

/// Response of a successful request; `body` is the parsed JSON (when the
/// response is JSON) and `body_text` always carries the raw text.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: Option<serde_json::Value>,
    pub body_text: Option<String>,
}

/// Per-request cancellation tokens keyed by `requestID`.
static CANCEL_REGISTRY: LazyLock<Mutex<HashMap<String, CancellationToken>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// The base URL comes from the request's `url` field; `serverID`-based
/// requests are resolved against the server registry in the commands layer
/// (TASK-M1-03) before reaching the transport.
fn resolve_base_url(request: &HttpRequest) -> Option<String> {
    request.url.clone()
}

fn register_cancellation(request_id: Option<&str>) -> Option<CancellationToken> {
    let id = request_id?;
    let token = CancellationToken::new();
    CANCEL_REGISTRY
        .lock()
        .unwrap()
        .insert(id.to_string(), token.clone());
    Some(token)
}

fn unregister_cancellation(request_id: Option<&str>) {
    if let Some(id) = request_id {
        CANCEL_REGISTRY.lock().unwrap().remove(id);
    }
}

/// Aborts the in-flight request registered under `request_id` (if any).
pub fn http_cancel(request_id: String) {
    if let Some(token) = CANCEL_REGISTRY.lock().unwrap().remove(&request_id) {
        token.cancel();
    }
}

/// Performs the REST request described by `request`.
pub async fn http_request(request: HttpRequest) -> Result<HttpResponse, ApiError> {
    let token = register_cancellation(request.request_id.as_deref());
    let result = match &token {
        Some(token) => {
            let send = std::pin::pin!(send_request(&request));
            tokio::select! {
                _ = token.cancelled() => Err(ApiError::cancelled("request cancelled")),
                result = send => result,
            }
        }
        None => send_request(&request).await,
    };
    unregister_cancellation(request.request_id.as_deref());
    result
}

async fn send_request(request: &HttpRequest) -> Result<HttpResponse, ApiError> {
    let client = reqwest::Client::builder()
        .use_rustls_tls()
        .timeout(Duration::from_millis(request.timeout_ms.unwrap_or(30_000)))
        .build()
        .map_err(|err| ApiError::network(err.to_string()))?;
    let req = assemble_request(&client, request)?;
    let response = client.execute(req).await.map_err(classify_error)?;
    let status = response.status();
    if status.is_client_error() || status.is_server_error() {
        let status_code = status.as_u16();
        // First line only: keeps the message short and avoids echoing bodies.
        let message = response
            .text()
            .await
            .unwrap_or_default()
            .lines()
            .next()
            .unwrap_or_default()
            .to_string();
        return Err(ApiError::http(status_code, message));
    }
    to_http_response(response).await
}

fn assemble_request(
    client: &reqwest::Client,
    request: &HttpRequest,
) -> Result<reqwest::Request, ApiError> {
    let base = resolve_base_url(request)
        .ok_or_else(|| ApiError::invalid_url("missing url or serverID"))?;
    let mut url = reqwest::Url::parse(&base)
        .map_err(|_| ApiError::invalid_url(format!("invalid base url: {base}")))?;
    url = url
        .join(&request.path)
        .map_err(|_| ApiError::invalid_url(format!("invalid path: {}", request.path)))?;
    merge_query(&mut url, &request.query)?;
    let method = Method::from_bytes(request.method.as_bytes())
        .map_err(|_| ApiError::invalid_url(format!("invalid method: {}", request.method)))?;
    let mut builder = client.request(method, url);
    if let Some(auth) = &request.auth {
        if let Some(password) = &auth.password {
            let username = auth.username.as_deref().unwrap_or("");
            builder = builder.basic_auth(username, Some(password));
        }
    }
    if let Some(body) = &request.body {
        builder = builder.json(body);
    }
    builder
        .build()
        .map_err(|err| ApiError::network(err.to_string()))
}

fn merge_query(url: &mut reqwest::Url, query: &Option<serde_json::Value>) -> Result<(), ApiError> {
    let Some(query) = query else {
        return Ok(());
    };
    let Some(object) = query.as_object() else {
        return Err(ApiError::invalid_url("query must be a JSON object"));
    };
    for (key, value) in object {
        let value = match value {
            serde_json::Value::String(s) => s.clone(),
            serde_json::Value::Number(n) => n.to_string(),
            serde_json::Value::Bool(b) => b.to_string(),
            serde_json::Value::Null => continue,
            _ => {
                return Err(ApiError::invalid_url(format!(
                    "invalid query value for {key}"
                )))
            }
        };
        url.query_pairs_mut().append_pair(key, &value);
    }
    Ok(())
}

fn classify_error(err: reqwest::Error) -> ApiError {
    if err.is_timeout() {
        ApiError::timeout(err.to_string())
    } else if err.is_connect() {
        ApiError::network(err.to_string())
    } else {
        // Cancellation never surfaces here: the `http_request` select! branch
        // produces "cancelled" before the reqwest future is dropped.
        ApiError::network(err.to_string())
    }
}

async fn to_http_response(response: reqwest::Response) -> Result<HttpResponse, ApiError> {
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .map(|(key, value)| {
            (
                key.as_str().to_string(),
                value.to_str().unwrap_or_default().to_string(),
            )
        })
        .collect();
    let text = response.text().await.map_err(classify_error)?;
    let mut body = None;
    let mut body_text = None;
    if !text.is_empty() {
        body_text = Some(text.clone());
        body = serde_json::from_str(&text).ok();
    }
    Ok(HttpResponse {
        status,
        headers,
        body,
        body_text,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::net::{SocketAddr, TcpListener, TcpStream};
    use std::time::Duration;

    const REASON: [(&str, &str); 4] = [
        ("200", "OK"),
        ("401", "Unauthorized"),
        ("500", "Internal Server Error"),
        ("501", "Not Implemented"),
    ];

    fn reason(status: u16) -> &'static str {
        REASON
            .iter()
            .find(|(code, _)| *code == status.to_string())
            .map(|(_, reason)| *reason)
            .unwrap_or("Status")
    }

    /// Spawns a single-connection HTTP server replying with a canned JSON
    /// response; returns the base URL.
    fn spawn_http_server(status: u16, body: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                read_request_head(&stream);
                let payload = format!(
                    "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len(),
                    reason = reason(status),
                );
                let mut stream = stream;
                let _ = stream.write_all(payload.as_bytes());
            }
        });
        format!("http://{addr}")
    }

    /// Spawns a server that accepts connections but never responds.
    fn spawn_silent_server() -> SocketAddr {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                std::thread::sleep(Duration::from_secs(60));
                drop(stream);
            }
        });
        addr
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

    fn base_request(url: &str) -> HttpRequest {
        HttpRequest {
            url: Some(url.to_string()),
            method: "GET".to_string(),
            path: "/".to_string(),
            ..HttpRequest::default()
        }
    }

    fn assert_assembly(base: &str, path: &str, query: Option<serde_json::Value>) -> String {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            let client = reqwest::Client::new();
            let request = HttpRequest {
                url: Some(base.to_string()),
                method: "GET".to_string(),
                path: path.to_string(),
                query,
                ..HttpRequest::default()
            };
            let req = assemble_request(&client, &request).unwrap();
            req.url().to_string()
        })
    }

    #[test]
    fn joins_base_path_and_query() {
        assert_eq!(
            assert_assembly(
                "http://example.com:14096",
                "/global/health",
                Some(serde_json::json!({ "directory": "/proj", "limit": 5, "verbose": true })),
            ),
            "http://example.com:14096/global/health?directory=%2Fproj&limit=5&verbose=true"
        );
    }

    #[test]
    fn handles_trailing_slashes_on_base_and_path() {
        assert_eq!(
            assert_assembly("http://example.com:14096/", "/global/health", None),
            "http://example.com:14096/global/health"
        );
        assert_eq!(
            assert_assembly("http://example.com:14096/", "global/health", None),
            "http://example.com:14096/global/health"
        );
    }

    #[test]
    fn server_id_is_not_a_base_url_in_the_transport() {
        // serverID resolution happens in the commands layer via the server
        // registry; the transport itself only accepts concrete URLs.
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let err = runtime.block_on(async {
            let client = reqwest::Client::new();
            let request = HttpRequest {
                server_id: Some("nope".to_string()),
                method: "GET".to_string(),
                path: "/project".to_string(),
                ..HttpRequest::default()
            };
            assemble_request(&client, &request).unwrap_err()
        });
        assert_eq!(err.code, "invalid_url");
    }

    #[test]
    fn missing_url_and_server_id_is_invalid() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let err = runtime.block_on(async {
            let client = reqwest::Client::new();
            assemble_request(&client, &HttpRequest::default()).unwrap_err()
        });
        assert_eq!(err.code, "invalid_url");
        assert!(!err.retriable);
    }

    #[test]
    fn unknown_server_id_is_invalid() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let err = runtime.block_on(async {
            let client = reqwest::Client::new();
            let request = HttpRequest {
                server_id: Some("nope".to_string()),
                ..HttpRequest::default()
            };
            assemble_request(&client, &request).unwrap_err()
        });
        assert_eq!(err.code, "invalid_url");
    }

    #[test]
    fn malformed_base_url_is_invalid() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let err = runtime.block_on(async {
            let client = reqwest::Client::new();
            assemble_request(&client, &base_request("not a url")).unwrap_err()
        });
        assert_eq!(err.code, "invalid_url");
    }

    #[test]
    fn basic_auth_header_only_when_password_present() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            let client = reqwest::Client::new();
            let request = HttpRequest {
                auth: Some(Auth {
                    username: Some("user".to_string()),
                    password: Some("pass".to_string()),
                }),
                ..base_request("http://example.com")
            };
            let req = assemble_request(&client, &request).unwrap();
            let auth = req.headers().get(reqwest::header::AUTHORIZATION).unwrap();
            assert_eq!(auth, "Basic dXNlcjpwYXNz");

            let request = HttpRequest {
                auth: Some(Auth {
                    username: Some("user".to_string()),
                    password: None,
                }),
                ..base_request("http://example.com")
            };
            let req = assemble_request(&client, &request).unwrap();
            assert!(req.headers().get(reqwest::header::AUTHORIZATION).is_none());
        });
    }

    #[test]
    fn body_is_serialized_as_json() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            let client = reqwest::Client::new();
            let request = HttpRequest {
                method: "POST".to_string(),
                body: Some(serde_json::json!({ "level": "info", "message": "hi" })),
                ..base_request("http://example.com")
            };
            let req = assemble_request(&client, &request).unwrap();
            assert!(req.body().is_some());
        });
    }

    #[test]
    fn reject_nested_query_values() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let err = runtime.block_on(async {
            let client = reqwest::Client::new();
            let request = HttpRequest {
                query: Some(serde_json::json!({ "bad": ["array"] })),
                ..base_request("http://example.com")
            };
            assemble_request(&client, &request).unwrap_err()
        });
        assert_eq!(err.code, "invalid_url");
    }

    #[test]
    fn success_response_parses_body_and_text() {
        let base = spawn_http_server(200, r#"{"healthy":true,"version":"1.18.11-mock"}"#);
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let response = runtime.block_on(async {
            let request = base_request(&base);
            http_request(request).await.unwrap()
        });
        assert_eq!(response.status, 200);
        assert_eq!(response.body.unwrap()["healthy"], true);
        assert!(response.body_text.unwrap().contains("1.18.11-mock"));
    }

    #[test]
    fn server_error_is_retriable_http_error() {
        let base = spawn_http_server(500, r#"{"error":"boom"}"#);
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let err = runtime.block_on(async { http_request(base_request(&base)).await.unwrap_err() });
        assert_eq!(err.code, "http");
        assert_eq!(err.status, Some(500));
        assert!(err.retriable);
    }

    #[test]
    fn client_error_is_non_retriable_http_error() {
        let base = spawn_http_server(401, r#"{"error":"unauthorized"}"#);
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let err = runtime.block_on(async { http_request(base_request(&base)).await.unwrap_err() });
        assert_eq!(err.code, "http");
        assert_eq!(err.status, Some(401));
        assert!(!err.retriable);
        assert!(err.message.contains("unauthorized"));
    }

    #[test]
    fn timeout_classified_as_timeout() {
        let addr = spawn_silent_server();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let err = runtime.block_on(async {
            let request = HttpRequest {
                timeout_ms: Some(100),
                ..base_request(&format!("http://{addr}"))
            };
            http_request(request).await.unwrap_err()
        });
        assert_eq!(err.code, "timeout");
        assert!(err.retriable);
    }

    #[test]
    fn connection_refused_classified_as_network() {
        let addr = {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            listener.local_addr().unwrap()
        };
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let err = runtime.block_on(async {
            let request = HttpRequest {
                timeout_ms: Some(1000),
                ..base_request(&format!("http://{addr}"))
            };
            http_request(request).await.unwrap_err()
        });
        assert_eq!(err.code, "network");
        assert!(err.retriable);
    }

    #[test]
    fn cancel_aborts_in_flight_request() {
        let addr = spawn_silent_server();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let err = runtime.block_on(async {
            let request = HttpRequest {
                timeout_ms: Some(60_000),
                request_id: Some("req-cancel-1".to_string()),
                ..base_request(&format!("http://{addr}"))
            };
            let handle = tokio::spawn(http_request(request));
            tokio::time::sleep(Duration::from_millis(200)).await;
            http_cancel("req-cancel-1".to_string());
            handle.await.unwrap().unwrap_err()
        });
        assert_eq!(err.code, "cancelled");
        assert!(!err.retriable);
    }

    #[test]
    fn cancel_registry_is_cleaned_up_after_request() {
        let base = spawn_http_server(200, r#"{"ok":true}"#);
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            let request = HttpRequest {
                request_id: Some("req-clean-1".to_string()),
                ..base_request(&base)
            };
            http_request(request).await.unwrap();
        });
        let registry = CANCEL_REGISTRY.lock().unwrap();
        assert!(!registry.contains_key("req-clean-1"));
    }

    #[test]
    fn cancel_unknown_request_is_a_no_op() {
        // The global registry is shared across parallel tests, so only the
        // unknown id itself may be asserted absent (an in-flight request of
        // another test may legitimately hold a token).
        http_cancel("does-not-exist".to_string());
        assert!(!CANCEL_REGISTRY
            .lock()
            .unwrap()
            .contains_key("does-not-exist"));
    }
}
