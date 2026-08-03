//! L3 contract tests against the Mock OpenCode Server (docs/testing.md §3).
//!
//! Requires the mock server to be running and `MOCK_URL` to be set, e.g.:
//!
//!   pnpm mock:start &        # default http://localhost:14096
//!   MOCK_URL=http://localhost:14096 cargo test --test transport_test
//!
//! Skipped by default so `pnpm verify` never needs a network connection.

use opencode_client_lib::transport::http::{http_request, ApiError, HttpRequest};

fn mock_base_url() -> Option<String> {
    std::env::var("MOCK_URL").ok().filter(|v| !v.is_empty())
}

fn request(base: &str, method: &str, path: &str) -> HttpRequest {
    HttpRequest {
        url: Some(base.to_string()),
        method: method.to_string(),
        path: path.to_string(),
        ..HttpRequest::default()
    }
}

#[test]
fn contract_get_health_succeeds() {
    let Some(base) = mock_base_url() else {
        eprintln!("skipped: MOCK_URL not set");
        return;
    };
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let response = runtime
        .block_on(async { http_request(request(&base, "GET", "/global/health")).await })
        .unwrap();
    assert_eq!(response.status, 200);
    let body = response.body.unwrap();
    assert_eq!(body["healthy"], true);
    assert_eq!(body["version"], "1.18.11-mock");
}

#[test]
fn contract_post_is_assembled_and_classified() {
    let Some(base) = mock_base_url() else {
        eprintln!("skipped: MOCK_URL not set");
        return;
    };
    let runtime = tokio::runtime::Runtime::new().unwrap();
    // /log is known to the OpenAPI contract but not registered by the mock,
    // which answers 501 — proving POST assembly reaches the wire and 5xx is
    // classified as retriable.
    let err = runtime.block_on(async {
        let mut req = request(&base, "POST", "/log");
        req.body = Some(serde_json::json!({ "level": "info", "message": "contract" }));
        http_request(req).await.unwrap_err()
    });
    assert_eq!(err.code, "http");
    assert_eq!(err.status, Some(501));
    assert!(err.retriable);
}

#[test]
fn contract_fault_injection_classification() {
    let Some(base) = mock_base_url() else {
        eprintln!("skipped: MOCK_URL not set");
        return;
    };
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let classified = runtime.block_on(async {
        let mut bad = request(&base, "GET", "/global/health");
        bad.query = Some(serde_json::json!({ "__fail": "401" }));
        let unauthorized: Result<_, ApiError> = http_request(bad).await;
        let mut slow = request(&base, "GET", "/global/health");
        slow.query = Some(serde_json::json!({ "__slow": "500" }));
        slow.timeout_ms = Some(50);
        let timed_out: Result<_, ApiError> = http_request(slow).await;
        (unauthorized, timed_out)
    });
    let (unauthorized, timed_out) = classified;
    let unauthorized = unauthorized.unwrap_err();
    assert_eq!(unauthorized.code, "http");
    assert_eq!(unauthorized.status, Some(401));
    assert!(!unauthorized.retriable);
    let timed_out = timed_out.unwrap_err();
    assert_eq!(timed_out.code, "timeout");
    assert!(timed_out.retriable);
}
