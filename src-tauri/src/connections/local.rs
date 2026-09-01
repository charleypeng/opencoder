//! Lifecycle management for locally hosted `opencode serve` processes.
//!
//! A locally managed server is started through the same shell command users
//! run manually (`bash -lc "exec opencode serve"`). The manager keeps the
//! child handle for normal shutdown and starts a tiny copy of the application
//! as a watchdog. The watchdog owns a pipe whose other end lives in the app;
//! if the app crashes, the pipe closes and the watchdog terminates the server.

use std::collections::HashMap;
use std::io::Read;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

/// A locally managed process and its crash-cleanup watchdog.
struct ManagedProcess {
    child: Child,
    watchdog: Child,
    watchdog_stdin: Option<ChildStdin>,
}

/// Runtime state for all locally managed servers.
pub struct LocalServerManager {
    processes: Mutex<HashMap<String, ManagedProcess>>,
}

impl Default for LocalServerManager {
    fn default() -> Self {
        Self {
            processes: Mutex::new(HashMap::new()),
        }
    }
}

impl LocalServerManager {
    /// Starts the server identified by `server_id`, returning its process id.
    /// Calling start twice for a still-running server is idempotent.
    pub fn start(&self, server_id: &str) -> Result<u32, String> {
        let mut processes = self
            .processes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(existing) = processes.get_mut(server_id) {
            if existing
                .child
                .try_wait()
                .map_err(|err| err.to_string())?
                .is_none()
            {
                return Ok(existing.child.id());
            }
            stop_process(existing);
            processes.remove(server_id);
        }

        let mut command = Command::new("bash");
        command
            .args(["-lc", "exec opencode serve"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .current_dir(default_working_directory());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let mut child = command
            .spawn()
            .map_err(|err| format!("failed to start opencode serve: {err}"))?;
        // A missing `opencode` executable makes the shell exit immediately;
        // surface that failure to the Add Server flow instead of persisting a
        // server that can never become healthy.
        std::thread::sleep(Duration::from_millis(50));
        match child.try_wait() {
            Ok(Some(status)) => {
                let _ = child.wait();
                return Err(format!("opencode serve exited before startup ({status})"));
            }
            Ok(None) => {}
            Err(error) => {
                terminate_process(child.id());
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("failed to inspect opencode serve: {error}"));
            }
        }
        let pid = child.id();

        let executable = match std::env::current_exe() {
            Ok(path) => path,
            Err(error) => {
                terminate_process(pid);
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("failed to locate watchdog executable: {error}"));
            }
        };
        let mut watchdog = Command::new(executable);
        watchdog
            .arg("--opencoder-local-watchdog")
            .arg(pid.to_string())
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut watchdog = match watchdog.spawn() {
            Ok(process) => process,
            Err(err) => {
                terminate_process(pid);
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("failed to start local server watchdog: {err}"));
            }
        };
        let watchdog_stdin = match watchdog.stdin.take() {
            Some(stdin) => stdin,
            None => {
                terminate_process(pid);
                let _ = child.kill();
                let _ = child.wait();
                let _ = watchdog.kill();
                let _ = watchdog.wait();
                return Err("local server watchdog did not expose its pipe".to_string());
            }
        };
        processes.insert(
            server_id.to_string(),
            ManagedProcess {
                child,
                watchdog,
                watchdog_stdin: Some(watchdog_stdin),
            },
        );
        Ok(pid)
    }

    /// Stops one locally managed server. Missing or already-exited servers
    /// are treated as success so deleting a server remains idempotent.
    pub fn stop(&self, server_id: &str) {
        let mut processes = self
            .processes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(mut process) = processes.remove(server_id) {
            stop_process(&mut process);
        }
    }

    /// Stops every locally managed server before the Tauri runtime exits.
    pub fn stop_all(&self) {
        let mut processes = self
            .processes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        for (_, mut process) in processes.drain() {
            stop_process(&mut process);
        }
    }

    /// Returns whether a managed process is currently alive.
    pub fn is_running(&self, server_id: &str) -> bool {
        let mut processes = self
            .processes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(process) = processes.get_mut(server_id) else {
            return false;
        };
        match process.child.try_wait() {
            Ok(None) => true,
            Ok(Some(_)) | Err(_) => {
                stop_process(process);
                processes.remove(server_id);
                false
            }
        }
    }
}

impl Drop for LocalServerManager {
    fn drop(&mut self) {
        self.stop_all();
    }
}

/// Runs the crash-cleanup helper when the executable is launched with the
/// private watchdog argument. Returns true when the caller should exit
/// without creating a Tauri application.
pub fn run_watchdog_if_requested() -> bool {
    let mut args = std::env::args_os();
    let _ = args.next();
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--opencoder-local-watchdog")) {
        return false;
    }
    let Some(pid) = args
        .next()
        .and_then(|value| value.to_string_lossy().parse::<u32>().ok())
    else {
        return true;
    };

    let mut input = std::io::stdin();
    let mut buffer = [0_u8; 256];
    while input
        .read(&mut buffer)
        .map(|count| count > 0)
        .unwrap_or(false)
    {}
    terminate_process(pid);
    true
}

fn default_working_directory() -> std::path::PathBuf {
    #[cfg(windows)]
    if let Some(path) = std::env::var_os("USERPROFILE") {
        return path.into();
    }
    #[cfg(not(windows))]
    if let Some(path) = std::env::var_os("HOME") {
        return path.into();
    }
    std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
}

fn stop_process(process: &mut ManagedProcess) {
    // Closing the pipe tells the watchdog to terminate the whole process
    // group. The direct kill below makes normal shutdown deterministic even
    // if the watchdog is slow to start or has already exited.
    process.watchdog_stdin.take();
    if process.child.try_wait().ok().flatten().is_none() {
        terminate_process(process.child.id());
        let _ = process.child.kill();
    }
    let _ = process.child.wait();
    let _ = process.watchdog.kill();
    let _ = process.watchdog.wait();
}

fn terminate_process(pid: u32) {
    #[cfg(unix)]
    {
        let group = format!("-{pid}");
        if Command::new("kill")
            .args(["-TERM", &group])
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
        {
            return;
        }
    }
    #[cfg(windows)]
    {
        if Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
        {
            return;
        }
    }
    let _ = Command::new("kill").arg(pid.to_string()).status();
}

#[cfg(test)]
mod tests {
    use super::run_watchdog_if_requested;

    #[test]
    fn watchdog_mode_is_inactive_for_normal_processes() {
        assert!(!run_watchdog_if_requested());
    }
}
