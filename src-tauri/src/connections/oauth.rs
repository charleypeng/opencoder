//! OAuth 2.0 client for servers protected by an RFC 9728 resource server
//! (TASK-UI-01; Cloudflare Access managed OAuth is the reference flow).
//!
//! The client is a PUBLIC OAuth client: PKCE (S256) instead of a client
//! secret, which is what Cloudflare Access and other RFC 9728 servers
//! expect from agents. The flow:
//!
//! 1. `discover` — GET the RFC 9728 discovery document at
//!    `/.well-known/oauth-authorization-server` (the `www-authenticate`
//!    header of a 401 points there, or the path is probed directly) and
//!    parse the authorization/token endpoints.
//! 2. `authorize_url` — build the authorization request with PKCE
//!    challenge + state; the user completes it in the system browser.
//! 3. `exchange` — swap the returned authorization code (plus the PKCE
//!    verifier) for tokens at the token endpoint.
//! 4. `refresh` — use the refresh token to mint a new access token when
//!    the old one expires.
//!
//! The module is pure (no Tauri): discovery parsing, PKCE math, request
//! form building and token-response parsing are unit-tested here; the
//! command layer feeds it through the HTTP transport.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

/// RFC 9728 discovery document (`oauth-authorization-server` metadata).
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
pub struct OAuthServerMetadata {
    /// Authorization endpoint (required by RFC 9728).
    pub authorization_endpoint: String,
    /// Token endpoint (required by RFC 9728).
    pub token_endpoint: String,
    /// Client identifier issued by the authorization server, when it
    /// provides one; otherwise the client generates its own.
    #[serde(default)]
    pub client_id: Option<String>,
    /// Scopes the server understands, when advertised.
    #[serde(default)]
    pub scopes_supported: Option<Vec<String>>,
    /// Code challenge methods; PKCE S256 is used whenever supported
    /// (and required otherwise, since this is a public client).
    #[serde(default)]
    pub code_challenge_methods_supported: Option<Vec<String>>,
}

/// The discovery URL for an app domain (RFC 9728 §3).
pub fn discovery_url(base_url: &str) -> String {
    format!(
        "{}/.well-known/oauth-authorization-server",
        base_url.trim_end_matches('/')
    )
}

/// Parses an RFC 9728 discovery document; rejects documents without the
/// two required endpoints.
pub fn parse_discovery(body: &str) -> Result<OAuthServerMetadata, OAuthError> {
    let metadata: OAuthServerMetadata =
        serde_json::from_str(body).map_err(|_| OAuthError::InvalidDiscovery)?;
    if metadata.authorization_endpoint.is_empty() || metadata.token_endpoint.is_empty() {
        return Err(OAuthError::InvalidDiscovery);
    }
    Ok(metadata)
}

/// PKCE pair: the plaintext verifier and the S256 challenge.
#[derive(Debug, Clone, PartialEq)]
pub struct PkcePair {
    pub verifier: String,
    pub challenge: String,
}

/// Generates a PKCE verifier (43 random URL-safe chars, RFC 7636 §4.1)
/// and its S256 challenge (§4.2).
pub fn generate_pkce() -> PkcePair {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    let verifier = URL_SAFE_NO_PAD.encode(bytes);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    PkcePair {
        verifier,
        challenge,
    }
}

/// Builds the authorization request URL. `redirect_uri` must be the URI
/// the authorization server is configured to accept for this client.
pub fn authorize_url(
    metadata: &OAuthServerMetadata,
    client_id: &str,
    redirect_uri: &str,
    pkce: &PkcePair,
    state: &str,
    scope: Option<&str>,
) -> Result<String, OAuthError> {
    let mut url = reqwest::Url::parse(&metadata.authorization_endpoint)
        .map_err(|_| OAuthError::InvalidEndpoint("authorization_endpoint".to_string()))?;
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("state", state)
        .append_pair("code_challenge", &pkce.challenge)
        .append_pair("code_challenge_method", "S256");
    if let Some(scope) = scope {
        if !scope.is_empty() {
            url.query_pairs_mut().append_pair("scope", scope);
        }
    }
    Ok(url.to_string())
}

/// Token response from the token endpoint (RFC 6749 §5.1).
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub token_type: Option<String>,
    pub expires_in: Option<u64>,
    pub refresh_token: Option<String>,
    pub scope: Option<String>,
}

/// Parsed token grant result: (access token, refresh token, expiry millis,
/// scope).
pub type TokenGrant = (String, Option<String>, Option<i64>, Option<String>);

/// Parses a token endpoint response. `now` is epoch millis (injectable for
/// tests); the expiry is computed from it when `expires_in` is present.
pub fn parse_token_response(body: &str, now: i64) -> Result<TokenGrant, OAuthError> {
    let response: TokenResponse =
        serde_json::from_str(body).map_err(|_| OAuthError::InvalidTokenResponse)?;
    if response.access_token.is_empty() {
        return Err(OAuthError::InvalidTokenResponse);
    }
    let expires_at = response
        .expires_in
        .map(|seconds| now + seconds as i64 * 1000);
    Ok((
        response.access_token,
        response.refresh_token,
        expires_at,
        response.scope,
    ))
}

/// Builds the token exchange form body (authorization code grant with
/// PKCE, RFC 7636 §4.5).
pub fn exchange_form(
    client_id: &str,
    redirect_uri: &str,
    code: &str,
    verifier: &str,
) -> Vec<(&'static str, String)> {
    vec![
        ("grant_type", "authorization_code".to_string()),
        ("client_id", client_id.to_string()),
        ("redirect_uri", redirect_uri.to_string()),
        ("code", code.to_string()),
        ("code_verifier", verifier.to_string()),
    ]
}

/// Builds the refresh grant form body (RFC 6749 §6).
pub fn refresh_form(client_id: &str, refresh_token: &str) -> Vec<(&'static str, String)> {
    vec![
        ("grant_type", "refresh_token".to_string()),
        ("client_id", client_id.to_string()),
        ("refresh_token", refresh_token.to_string()),
    ]
}

/// Builds the `www-authenticate` challenge parser input: extracts the
/// RFC 9728 discovery URL from a `WWW-Authenticate` header value when the
/// challenge carries an `oauth-authorization-server` parameter.
pub fn challenge_discovery_url(header: &str) -> Option<String> {
    for parameter in header.split(',') {
        let parameter = parameter.trim();
        if let Some(value) = parameter.strip_prefix("oauth-authorization-server=") {
            let value = value.trim().trim_matches('"');
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

/// Failures of the pure OAuth flow.
#[derive(Debug, Clone, PartialEq)]
pub enum OAuthError {
    /// The discovery document is missing or malformed.
    InvalidDiscovery,
    /// The discovery document has no usable endpoint.
    InvalidEndpoint(String),
    /// The token endpoint response is missing or malformed.
    InvalidTokenResponse,
    /// A refresh was attempted without a stored refresh token.
    NoRefreshToken,
}

impl std::fmt::Display for OAuthError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OAuthError::InvalidDiscovery => write!(formatter, "invalid OAuth discovery document"),
            OAuthError::InvalidEndpoint(endpoint) => {
                write!(formatter, "invalid {endpoint} in OAuth discovery document")
            }
            OAuthError::InvalidTokenResponse => write!(formatter, "invalid token response"),
            OAuthError::NoRefreshToken => write!(formatter, "no refresh token stored"),
        }
    }
}

/// Current epoch millis; shared with the registry's clock.
pub fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DISCOVERY: &str = r#"{
        "issuer": "https://app.example.com",
        "authorization_endpoint": "https://app.example.com/oauth/authorize",
        "token_endpoint": "https://app.example.com/oauth/token",
        "code_challenge_methods_supported": ["S256"],
        "scopes_supported": ["openid", "profile"]
    }"#;

    #[test]
    fn discovery_url_joins_without_double_slash() {
        assert_eq!(
            discovery_url("https://app.example.com/"),
            "https://app.example.com/.well-known/oauth-authorization-server"
        );
        assert_eq!(
            discovery_url("https://app.example.com"),
            "https://app.example.com/.well-known/oauth-authorization-server"
        );
    }

    #[test]
    fn parse_discovery_reads_endpoints_and_extras() {
        let metadata = parse_discovery(DISCOVERY).unwrap();
        assert_eq!(
            metadata.authorization_endpoint,
            "https://app.example.com/oauth/authorize"
        );
        assert_eq!(
            metadata.token_endpoint,
            "https://app.example.com/oauth/token"
        );
        assert_eq!(metadata.client_id, None);
        assert_eq!(
            metadata.code_challenge_methods_supported,
            Some(vec!["S256".to_string()])
        );
    }

    #[test]
    fn parse_discovery_accepts_client_id_and_rejects_missing_endpoints() {
        let with_client_id = r#"{
            "authorization_endpoint": "https://app.example.com/oauth/authorize",
            "token_endpoint": "https://app.example.com/oauth/token",
            "client_id": "managed-oauth-client"
        }"#;
        let metadata = parse_discovery(with_client_id).unwrap();
        assert_eq!(metadata.client_id.as_deref(), Some("managed-oauth-client"));

        assert_eq!(parse_discovery(r#"{}"#), Err(OAuthError::InvalidDiscovery));
        assert_eq!(
            parse_discovery("not json"),
            Err(OAuthError::InvalidDiscovery)
        );
        let missing_token = r#"{"authorization_endpoint": "https://x/authorize"}"#;
        assert_eq!(
            parse_discovery(missing_token),
            Err(OAuthError::InvalidDiscovery)
        );
    }

    #[test]
    fn pkce_verifier_is_43_url_safe_chars_and_challenge_is_s256() {
        let pair = generate_pkce();
        assert_eq!(pair.verifier.len(), 43);
        assert_eq!(pair.challenge.len(), 43);
        // S256: base64url(sha256(verifier)) without padding.
        let expected = URL_SAFE_NO_PAD.encode(Sha256::digest(pair.verifier.as_bytes()));
        assert_eq!(pair.challenge, expected);
        // Two generations differ.
        let other = generate_pkce();
        assert_ne!(pair.verifier, other.verifier);
    }

    #[test]
    fn authorize_url_carries_pkce_state_and_scope() {
        let metadata = parse_discovery(DISCOVERY).unwrap();
        let pkce = PkcePair {
            verifier: "v".repeat(43),
            challenge: "c".repeat(43),
        };
        let url = authorize_url(
            &metadata,
            "opencoder-client",
            "http://127.0.0.1:41000/callback",
            &pkce,
            "state-123",
            Some("openid profile"),
        )
        .unwrap();
        assert!(url.starts_with("https://app.example.com/oauth/authorize?"));
        let parsed = reqwest::Url::parse(&url).unwrap();
        let query: std::collections::HashMap<_, _> = parsed.query_pairs().into_owned().collect();
        assert_eq!(query.get("response_type").map(String::as_str), Some("code"));
        assert_eq!(
            query.get("client_id").map(String::as_str),
            Some("opencoder-client")
        );
        assert_eq!(
            query.get("redirect_uri").map(String::as_str),
            Some("http://127.0.0.1:41000/callback")
        );
        assert_eq!(query.get("state").map(String::as_str), Some("state-123"));
        assert_eq!(
            query.get("code_challenge").map(String::as_str),
            Some("c".repeat(43).as_str())
        );
        assert_eq!(
            query.get("code_challenge_method").map(String::as_str),
            Some("S256")
        );
        assert_eq!(
            query.get("scope").map(String::as_str),
            Some("openid profile")
        );
    }

    #[test]
    fn authorize_url_omits_empty_scope_and_rejects_bad_endpoint() {
        let metadata = parse_discovery(DISCOVERY).unwrap();
        let pkce = PkcePair {
            verifier: "v".repeat(43),
            challenge: "c".repeat(43),
        };
        let url = authorize_url(&metadata, "c", "http://127.0.0.1:1/cb", &pkce, "s", None).unwrap();
        assert!(!url.contains("scope="));

        let bad = OAuthServerMetadata {
            authorization_endpoint: "not a url".to_string(),
            token_endpoint: "https://x/token".to_string(),
            client_id: None,
            scopes_supported: None,
            code_challenge_methods_supported: None,
        };
        assert_eq!(
            authorize_url(&bad, "c", "http://127.0.0.1:1/cb", &pkce, "s", None),
            Err(OAuthError::InvalidEndpoint(
                "authorization_endpoint".to_string()
            ))
        );
    }

    #[test]
    fn parse_token_response_extracts_tokens_and_expiry() {
        let body = r#"{
            "access_token": "at_123",
            "token_type": "Bearer",
            "expires_in": 3600,
            "refresh_token": "rt_456",
            "scope": "openid profile"
        }"#;
        let (access, refresh, expires_at, scope) =
            parse_token_response(body, 1_700_000_000_000).unwrap();
        assert_eq!(access, "at_123");
        assert_eq!(refresh.as_deref(), Some("rt_456"));
        assert_eq!(expires_at, Some(1_700_003_600_000));
        assert_eq!(scope.as_deref(), Some("openid profile"));
    }

    #[test]
    fn parse_token_response_without_expiry_yields_none_and_rejects_empty() {
        let (access, refresh, expires_at, _) =
            parse_token_response(r#"{"access_token":"at","refresh_token":"rt"}"#, 42).unwrap();
        assert_eq!(access, "at");
        assert_eq!(refresh.as_deref(), Some("rt"));
        assert_eq!(expires_at, None);

        assert_eq!(
            parse_token_response(r#"{"error":"invalid_grant"}"#, 42),
            Err(OAuthError::InvalidTokenResponse)
        );
        assert_eq!(
            parse_token_response("", 42),
            Err(OAuthError::InvalidTokenResponse)
        );
    }

    #[test]
    fn exchange_and_refresh_forms_carry_the_standard_fields() {
        let exchange = exchange_form("c1", "http://127.0.0.1:1/cb", "code_x", "verifier_y");
        let map: std::collections::HashMap<_, _> = exchange.into_iter().collect();
        assert_eq!(
            map.get("grant_type").map(String::as_str),
            Some("authorization_code")
        );
        assert_eq!(map.get("client_id").map(String::as_str), Some("c1"));
        assert_eq!(map.get("code").map(String::as_str), Some("code_x"));
        assert_eq!(
            map.get("code_verifier").map(String::as_str),
            Some("verifier_y")
        );

        let refresh = refresh_form("c1", "rt_old");
        let map: std::collections::HashMap<_, _> = refresh.into_iter().collect();
        assert_eq!(
            map.get("grant_type").map(String::as_str),
            Some("refresh_token")
        );
        assert_eq!(map.get("refresh_token").map(String::as_str), Some("rt_old"));
    }

    #[test]
    fn challenge_discovery_url_extracts_the_rfc9728_url() {
        assert_eq!(
            challenge_discovery_url(
                r#"Bearer realm="opencode", oauth-authorization-server="https://app.example.com/.well-known/oauth-authorization-server""#
            ),
            Some("https://app.example.com/.well-known/oauth-authorization-server".to_string())
        );
        // No oauth parameter -> none (plain Basic challenge).
        assert_eq!(challenge_discovery_url(r#"Basic realm="opencode""#), None);
        // No challenge at all -> none.
        assert_eq!(challenge_discovery_url(""), None);
    }
}
