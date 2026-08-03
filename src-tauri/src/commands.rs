//! Tauri command surface for the transport layer (ADR-002 §6.3).
//! Thin wrappers: the implementation lives in `crate::transport` so it can be
//! unit-tested without a Tauri runtime.

use crate::transport::http::{
    http_cancel as cancel_request, http_request as do_request, ApiError, HttpRequest, HttpResponse,
};

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
