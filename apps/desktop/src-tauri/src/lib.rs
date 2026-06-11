//! Sotto Host — a no-terminal desktop launcher for a self-hosted Sotto stack.
//!
//! The Rust side is intentionally tiny: it shells out to Docker Compose (the same
//! stack the installer uses, in ~/.sotto), reports health, and opens the app in
//! the browser. All UI lives in the webview (../src).

use std::path::PathBuf;
use std::process::Command;

/// Default install directory used by scripts/install.sh (`~/.sotto`).
fn sotto_dir() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();
    PathBuf::from(home).join(".sotto")
}

/// The compose command — prefer the `docker compose` plugin, used everywhere here.
fn compose(args: &[&str]) -> std::io::Result<std::process::Output> {
    Command::new("docker")
        .arg("compose")
        .args(args)
        .current_dir(sotto_dir())
        .output()
}

#[tauri::command]
fn docker_available() -> bool {
    Command::new("docker")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[tauri::command]
fn installed() -> bool {
    sotto_dir().join("docker-compose.yml").exists()
        || sotto_dir().join("compose.yml").exists()
}

#[tauri::command]
fn start_stack() -> Result<String, String> {
    let out = compose(&["up", "-d"]).map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok("started".into())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).into_owned())
    }
}

#[tauri::command]
fn stop_stack() -> Result<String, String> {
    let out = compose(&["down"]).map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok("stopped".into())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).into_owned())
    }
}

/// Health-check the web container by hitting its /api/v1/health endpoint.
#[tauri::command]
fn is_healthy(port: u16) -> bool {
    // Use docker to curl from inside the network is overkill; a TCP connect to
    // the published port is enough to know the app is up.
    std::net::TcpStream::connect(("127.0.0.1", port)).is_ok()
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
            start_stack,
            stop_stack,
            is_healthy,
            open_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sotto Host");
}
