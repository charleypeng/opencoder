//! Tauri command surface for the transport layer (ADR-002 §6.3).
//! Thin wrappers: the implementation lives in `crate::transport` so it can be
//! unit-tested without a Tauri runtime.

use crate::transport::http::{
    http_cancel as cancel_request, http_request as do_request, ApiError, Auth, HttpRequest,
    HttpResponse,
};
use crate::transport::sse::{sse_subscribe as subscribe, sse_unsubscribe as unsubscribe};

/// Performs a REST request against an OpenCode server (reqwest / rustls).
#[tauri::command]
pub async fn http_request(request: HttpRequest) -> Result<HttpResponse, ApiError> {
    do_request(request).await
}

/// Aborts the in-flight request registered under the given request id.
#[tauri::command]
pub fn http_cancel(request_id: String) {
    cancel_request(request_id);
}

/// Subscribes to a server's SSE stream; events arrive on `channel` as single
/// parsed values or 16ms batches of arrays.
#[tauri::command]
pub fn sse_subscribe(
    server_id: String,
    directory: Option<String>,
    channel: tauri::ipc::Channel<serde_json::Value>,
    auth: Option<Auth>,
) -> Result<u64, ApiError> {
    subscribe(server_id, directory, channel, auth)
}

/// Stops the subscription with the given id.
#[tauri::command]
pub fn sse_unsubscribe(subscription_id: u64) {
    unsubscribe(subscription_id);
}
