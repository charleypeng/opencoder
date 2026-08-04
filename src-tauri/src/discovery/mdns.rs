//! `mdns-sd` backend for LAN discovery (TASK-M1-07).
//!
//! The real backend (`MdnsSdBackend`) adapts `mdns-sd` browse events into
//! the plain [`ResolvedService`] type of the module, bridging the daemon's
//! sync receiver through a small forwarding thread so the scan loop only
//! ever deals with a single stream type. Tests inject a fake backend that
//! yields scripted services, keeping the network entirely out of the unit
//! tests.

use crate::discovery::{ResolvedService, OPENCODE_SERVICE_TYPE};
use mdns_sd::{ServiceDaemon, ServiceEvent};

/// Backend abstraction over the mDNS daemon; keeps the scan loop testable.
pub trait MdnsBackend: Send + Sync + 'static {
    /// Subscribes to resolved services of the given type.
    fn browse(&self, service_type: &str) -> Result<flume::Receiver<ResolvedService>, String>;
    /// Stops the daemon (idempotent).
    fn shutdown(&self);
}

/// Real backend backed by a `mdns-sd` daemon thread.
pub struct MdnsSdBackend {
    daemon: ServiceDaemon,
}

impl MdnsSdBackend {
    /// Starts the daemon; fails when mDNS is unavailable on this machine.
    pub fn new() -> Result<Self, String> {
        ServiceDaemon::new()
            .map(|daemon| Self { daemon })
            .map_err(|error| error.to_string())
    }
}

impl MdnsBackend for MdnsSdBackend {
    fn browse(&self, service_type: &str) -> Result<flume::Receiver<ResolvedService>, String> {
        let receiver = self
            .daemon
            .browse(service_type)
            .map_err(|error| error.to_string())?;
        let (sender, services) = flume::unbounded();
        let is_dedicated = service_type == OPENCODE_SERVICE_TYPE;
        std::thread::spawn(move || {
            while let Ok(event) = receiver.recv() {
                if let ServiceEvent::ServiceResolved(info) = event {
                    let service = ResolvedService {
                        fullname: info.get_fullname().to_string(),
                        hostname: info.get_hostname().to_string(),
                        port: info.get_port(),
                        addresses: info
                            .get_addresses()
                            .iter()
                            .map(|address| address.to_ip_addr())
                            .collect(),
                        properties: info.get_properties().clone().into_property_map_str(),
                    };
                    // The dedicated `_opencode._tcp` scan passes
                    // everything; the generic `_http._tcp` scan is filtered
                    // down to OpenCode's advertisement.
                    if (is_dedicated || is_opencode_service(&service))
                        && sender.send(service).is_err()
                    {
                        break;
                    }
                }
            }
        });
        Ok(services)
    }

    fn shutdown(&self) {
        let _ = self.daemon.shutdown();
    }
}

/// Matches services advertised by an OpenCode server: the current
/// implementation publishes an instance named `opencode` / `opencode-<port>`
/// on the host `opencode.local` (TXT `path=/`), so the generic `_http._tcp`
/// scan can be filtered to those instances.
pub fn is_opencode_service(service: &ResolvedService) -> bool {
    let instance = service.fullname.split('.').next().unwrap_or("");
    instance == "opencode"
        || instance.starts_with("opencode-")
        || service.hostname.starts_with("opencode")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn service(fullname: &str, hostname: &str) -> ResolvedService {
        ResolvedService {
            fullname: fullname.to_string(),
            hostname: hostname.to_string(),
            port: 14096,
            addresses: vec![],
            properties: HashMap::new(),
        }
    }

    #[test]
    fn matches_opencode_instances_and_hosts() {
        assert!(is_opencode_service(&service(
            "opencode-14096._http._tcp.local.",
            "opencode.local."
        )));
        assert!(is_opencode_service(&service(
            "opencode._http._tcp.local.",
            "opencode.local."
        )));
        assert!(is_opencode_service(&service(
            "anything._http._tcp.local.",
            "opencode.local."
        )));
        assert!(is_opencode_service(&service(
            "opencode-14096._http._tcp.local.",
            "custom-opencode.local."
        )));
    }

    #[test]
    fn rejects_unrelated_http_services() {
        assert!(!is_opencode_service(&service(
            "printer._http._tcp.local.",
            "printer.local."
        )));
        assert!(!is_opencode_service(&service(
            "airplay._http._tcp.local.",
            "apple-tv.local."
        )));
        assert!(!is_opencode_service(&service(
            "my-laptop._http._tcp.local.",
            "my-laptop.local."
        )));
    }
}
