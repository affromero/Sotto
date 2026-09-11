//! Sotto Host — a no-terminal desktop launcher for a self-hosted Sotto stack.
//!
//! The Rust side is intentionally tiny: it shells out to Docker Compose (the same
//! stack the installer uses, in ~/.sotto), reports health, and opens the app in
//! the browser. All UI lives in the webview (../src).

use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

async fn command_output(
    command: &mut tokio::process::Command,
    timeout: Duration,
) -> Result<std::process::Output, String> {
    command.kill_on_drop(true);
    tokio::time::timeout(timeout, command.output())
        .await
        .map_err(|_| {
            format!(
                "Docker command timed out after {} seconds",
                timeout.as_secs()
            )
        })?
        .map_err(|error| error.to_string())
}

/// Default install directory used by scripts/install.sh (`~/.sotto`).
fn sotto_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("SOTTO_DIR").filter(|dir| !dir.is_empty()) {
        return PathBuf::from(dir);
    }
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();
    PathBuf::from(home).join(".sotto")
}

/// The compose command — prefer the `docker compose` plugin, used everywhere here.
async fn compose(args: &[&str]) -> Result<std::process::Output, String> {
    command_output(
        tokio::process::Command::new("docker")
            .arg("compose")
            .args(args)
            .current_dir(sotto_dir()),
        Duration::from_secs(120),
    )
    .await
}

#[tauri::command]
async fn docker_available() -> bool {
    for args in [
        ["info", "--format", "{{.ServerVersion}}"].as_slice(),
        ["compose", "version"].as_slice(),
    ] {
        if !command_output(
            tokio::process::Command::new("docker").args(args),
            Duration::from_secs(5),
        )
        .await
        .map(|o| o.status.success())
        .unwrap_or(false)
        {
            return false;
        }
    }
    true
}

fn configured_port(contents: &str) -> Result<u16, String> {
    let value = contents
        .lines()
        .filter_map(|line| {
            let (key, value) = line.trim().split_once('=')?;
            (key.trim() == "WEB_PORT").then_some(value.trim())
        })
        .last();
    match value {
        None | Some("") => Ok(3000),
        Some(value) => value
            .trim_matches(['\'', '"'])
            .parse::<u16>()
            .ok()
            .filter(|port| *port > 0)
            .ok_or_else(|| "WEB_PORT in the Sotto .env must be between 1 and 65535".into()),
    }
}

#[tauri::command]
fn web_port() -> Result<u16, String> {
    match std::fs::read_to_string(sotto_dir().join(".env")) {
        Ok(contents) => configured_port(&contents),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(3000),
        Err(error) => Err(format!("Cannot read Sotto configuration: {error}")),
    }
}

#[tauri::command]
fn installed() -> bool {
    sotto_dir().join("docker-compose.yml").exists() || sotto_dir().join("compose.yml").exists()
}

#[tauri::command]
async fn start_stack() -> Result<String, String> {
    let out = compose(&["up", "-d"]).await?;
    if out.status.success() {
        Ok("started".into())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).into_owned())
    }
}

#[tauri::command]
async fn stop_stack() -> Result<String, String> {
    let out = compose(&["down"]).await?;
    if out.status.success() {
        Ok("stopped".into())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).into_owned())
    }
}

/// Health-check the web container by hitting its /api/v1/health endpoint.
#[tauri::command]
async fn is_healthy(port: u16) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || probe_health(port))
        .await
        .map_err(|error| error.to_string())
}

fn probe_health(port: u16) -> bool {
    let response = ureq::get(&format!("http://127.0.0.1:{port}/api/v1/health"))
        .timeout(std::time::Duration::from_secs(3))
        .call();
    response
        .ok()
        .and_then(|response| response.into_json::<serde_json::Value>().ok())
        .is_some_and(|value| value["status"] == "healthy" && value["version"].is_string())
}

/// Open the running app in the user's default browser.
#[tauri::command]
fn open_app(port: u16) -> Result<(), String> {
    let url = format!("http://localhost:{port}");
    let result = if cfg!(target_os = "macos") {
        Command::new("open").arg(&url).spawn()
    } else if cfg!(target_os = "windows") {
        Command::new("cmd").args(["/C", "start", "", &url]).spawn()
    } else {
        Command::new("xdg-open").arg(&url).spawn()
    };
    result.map(|_| ()).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            docker_available,
            installed,
            web_port,
            start_stack,
            stop_stack,
            is_healthy,
            open_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sotto Host");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    #[test]
    fn installer_port_configuration_is_respected_and_validated() {
        assert_eq!(
            configured_port("OTHER=secret\nWEB_PORT=3001\n").unwrap(),
            3001
        );
        assert_eq!(configured_port("WEB_PORT='4200'\n").unwrap(), 4200);
        assert_eq!(configured_port("OTHER=value").unwrap(), 3000);
        assert!(configured_port("WEB_PORT=0").is_err());
        assert!(configured_port("WEB_PORT=70000").is_err());
        assert!(configured_port("WEB_PORT=invalid").is_err());
    }

    fn probe(response: &'static str) -> bool {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            let len = socket.read(&mut request).unwrap();
            assert!(String::from_utf8_lossy(&request[..len]).starts_with("GET /api/v1/health "));
            socket.write_all(response.as_bytes()).unwrap();
        });
        let healthy = tauri::async_runtime::block_on(is_healthy(port)).unwrap();
        server.join().unwrap();
        healthy
    }

    #[test]
    fn health_requires_successful_sotto_response() {
        assert!(probe("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"status\":\"healthy\",\"version\":\"test\"}"));
        assert!(!probe(
            "HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n<html>Other application</html>"
        ));
        assert!(!probe("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n{\"status\":\"degraded\",\"version\":\"test\"}"));
    }

    #[test]
    fn stalled_process_is_terminated_with_a_timeout_error() {
        let mut command = if cfg!(windows) {
            let mut command = tokio::process::Command::new("powershell.exe");
            command.args(["-NoProfile", "-Command", "Start-Sleep -Seconds 30"]);
            command
        } else {
            let mut command = tokio::process::Command::new("sleep");
            command.arg("30");
            command
        };
        let start = std::time::Instant::now();
        let error = tauri::async_runtime::block_on(command_output(
            &mut command,
            Duration::from_millis(100),
        ))
        .unwrap_err();
        assert!(error.contains("timed out"));
        assert!(start.elapsed() < Duration::from_secs(5));
    }
}
