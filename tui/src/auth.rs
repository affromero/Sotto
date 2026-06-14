//! `sotto login` flow: redeem a single-use pairing token for a long-lived API
//! key.
//!
//! The CLI cannot call `POST /api/v1/auth/pair` (that needs a web session), so
//! the learner generates a pairing token in the web app's `/settings/devices`
//! and pastes it here. We exchange it via `/api/v1/auth/pair/redeem`, which is
//! unauthenticated, so this uses a plain `reqwest` POST rather than the
//! API-key-bearing generated client.

use color_eyre::{Result, eyre::eyre};
use serde::{Deserialize, Serialize};

use crate::config::Config;

/// Default server when `--server` is not provided.
pub(crate) const DEFAULT_SERVER: &str = "http://localhost:3000";

#[derive(Serialize)]
struct RedeemRequest<'a> {
    token: &'a str,
}

#[derive(Deserialize)]
struct PairedUser {
    name: Option<String>,
    email: Option<String>,
}

#[derive(Deserialize)]
struct RedeemResponse {
    token: String,
    user: Option<PairedUser>,
}

/// Exchange `token` at `server` for an API key and return the resulting
/// [`Config`]. Prints a confirmation line on success.
pub(crate) async fn login(server: &str, token: &str) -> Result<Config> {
    let server = server.trim_end_matches('/');
    let url = format!("{server}/api/v1/auth/pair/redeem");

    let http = reqwest::Client::builder()
        .build()
        .map_err(|e| eyre!("failed to build HTTP client: {e}"))?;

    let response = http
        .post(&url)
        .json(&RedeemRequest { token })
        .send()
        .await
        .map_err(|e| eyre!("request to {url} failed: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let detail = if body.is_empty() {
            String::new()
        } else {
            format!(": {body}")
        };
        return Err(eyre!("pairing token redemption failed ({status}){detail}"));
    }

    let redeemed: RedeemResponse = response
        .json()
        .await
        .map_err(|e| eyre!("could not parse redeem response: {e}"))?;

    let who = redeemed
        .user
        .as_ref()
        .and_then(|u| u.name.clone().or_else(|| u.email.clone()))
        .unwrap_or_else(|| "(owner)".to_string());

    println!("Logged in to {server} as {who}");

    // Re-login overwrites only the credential fields and PRESERVES the existing
    // theme block. `Config::load` is resilient (a corrupt/unreadable file yields
    // defaults, never an error), so a valid prior theme is kept and only a truly
    // missing/corrupt config falls back to the default appearance.
    let theme = Config::load()
        .ok()
        .flatten()
        .map(|c| c.theme)
        .unwrap_or_default();

    Ok(Config {
        server_url: server.to_string(),
        api_key: redeemed.token,
        theme,
    })
}

/// Read a pairing token from stdin (used when `--token` is omitted).
pub(crate) fn prompt_token() -> Result<String> {
    use std::io::Write;
    print!("Paste your Sotto pairing token (from /settings/devices): ");
    std::io::stdout().flush()?;
    let mut line = String::new();
    std::io::stdin().read_line(&mut line)?;
    let token = line.trim().to_string();
    if token.is_empty() {
        return Err(eyre!("no token provided"));
    }
    Ok(token)
}
