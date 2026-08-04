// Transport layer (ADR-002): all server traffic flows through Rust.
pub mod http;
pub mod sse;
pub mod ws;
