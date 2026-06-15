mod action;
mod api;
mod app;
mod audio;
mod auth;
mod components;
mod config;
mod event;
mod theme;
mod tui;

use clap::{Parser, Subcommand};
use color_eyre::{Result, eyre::eyre};

use crate::config::{Config, DEFAULT_PROFILE, Profile};

#[derive(Parser, Debug)]
#[command(name = "sotto", about = "Sotto — your course in the terminal", version)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Pair this device with a Sotto server using a token from /settings/devices.
    Login {
        /// Server base URL (defaults to http://localhost:3000).
        #[arg(long)]
        server: Option<String>,
        /// Pairing token. If omitted, you will be prompted on stdin.
        #[arg(long)]
        token: Option<String>,
        /// Profile name to store this account under. Defaults to the server host
        /// (e.g. "localhost"), or "default".
        #[arg(long = "as")]
        as_name: Option<String>,
    },
    /// Switch the active account to a named profile.
    Switch {
        /// The profile to make active.
        name: String,
    },
    /// List configured accounts (profiles).
    #[command(alias = "profiles")]
    Accounts,
    /// Remove an account. Defaults to the active one.
    Logout {
        /// The profile to remove. Defaults to the active profile.
        name: Option<String>,
    },
    /// Show the active account's server and learner (live, falling back to cached).
    Whoami,
}

#[tokio::main]
async fn main() -> Result<()> {
    color_eyre::install()?;

    let cli = Cli::parse();

    match cli.command {
        Some(Command::Login {
            server,
            token,
            as_name,
        }) => run_login(server, token, as_name).await,
        Some(Command::Switch { name }) => run_switch(&name),
        Some(Command::Accounts) => run_accounts(),
        Some(Command::Logout { name }) => run_logout(name),
        Some(Command::Whoami) => run_whoami().await,
        None => run_tui().await,
    }
}

/// Load the config, or an empty default when none exists yet.
fn load_config() -> Result<Config> {
    Ok(Config::load()?.unwrap_or_default())
}

/// Derive a profile name from a server URL's host (e.g. "localhost"), falling
/// back to the default name.
fn profile_name_from_server(server: &str) -> String {
    let host = server
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("");
    if host.is_empty() {
        DEFAULT_PROFILE.to_string()
    } else {
        host.to_string()
    }
}

async fn run_login(
    server: Option<String>,
    token: Option<String>,
    as_name: Option<String>,
) -> Result<()> {
    let server = server.unwrap_or_else(|| auth::DEFAULT_SERVER.to_string());
    let token = match token {
        Some(token) => token,
        None => auth::prompt_token()?,
    };

    let creds = auth::login(&server, &token).await?;
    let name = as_name.unwrap_or_else(|| profile_name_from_server(&creds.server_url));

    // Store under the named profile (preserving the global theme + other
    // profiles), set it active, and persist.
    let mut config = load_config()?;
    config.upsert_profile(
        &name,
        Profile {
            server_url: creds.server_url.clone(),
            api_key: creds.api_key,
            name: creds.name.clone(),
        },
    );
    config.active = name.clone();
    config.save()?;

    let who = creds.name.unwrap_or_else(|| "(owner)".to_string());
    println!(
        "Logged in to {} as {who} (profile '{name}')",
        creds.server_url
    );
    Ok(())
}

fn run_switch(name: &str) -> Result<()> {
    let mut config = load_config()?;
    config.set_active(name)?;
    config.save()?;
    let server = config
        .active_profile()
        .map(|p| p.server_url.as_str())
        .unwrap_or("(unknown)");
    println!("Switched to profile '{name}' ({server}).");
    Ok(())
}

fn run_accounts() -> Result<()> {
    let config = load_config()?;
    if config.profiles.is_empty() {
        println!("No accounts yet. Run `sotto login` to add one.");
        return Ok(());
    }
    for (name, profile) in &config.profiles {
        let marker = if *name == config.active { "*" } else { " " };
        let who = profile.name.as_deref().unwrap_or("(unknown)");
        println!("{marker} {name}\t{}\t{who}", profile.server_url);
    }
    Ok(())
}

fn run_logout(name: Option<String>) -> Result<()> {
    let mut config = load_config()?;
    let target = match name.or_else(|| {
        if config.active.is_empty() {
            None
        } else {
            Some(config.active.clone())
        }
    }) {
        Some(t) => t,
        None => {
            println!("No active account to log out of.");
            return Ok(());
        }
    };

    if !config.remove_profile(&target) {
        return Err(eyre!("no profile named '{target}'"));
    }
    config.save()?;

    if config.active.is_empty() {
        println!("Logged out of '{target}'. No accounts remain.");
    } else {
        println!(
            "Logged out of '{target}'. Active account is now '{}'.",
            config.active
        );
    }
    Ok(())
}

async fn run_whoami() -> Result<()> {
    let config = load_config()?;
    let Some(profile) = config.active_profile() else {
        println!("No active account. Run `sotto login` first.");
        return Ok(());
    };

    // Prefer a live identity from the server; fall back to the cached name.
    match crate::api::SottoClient::new(&profile.server_url, &profile.api_key) {
        Ok(client) => match client.me().await {
            Ok(me) => {
                let who = me
                    .name
                    .clone()
                    .or_else(|| me.email.clone())
                    .unwrap_or_else(|| me.id.clone());
                println!(
                    "{who} @ {} (profile '{}', live)",
                    profile.server_url, config.active
                );
                return Ok(());
            }
            Err(_) => fallback_whoami(&config, profile),
        },
        Err(_) => fallback_whoami(&config, profile),
    }
    Ok(())
}

/// Print the cached identity when a live `me` call is unavailable.
fn fallback_whoami(config: &Config, profile: &Profile) {
    let who = profile.name.as_deref().unwrap_or("(unknown)");
    println!(
        "{who} @ {} (profile '{}', cached)",
        profile.server_url, config.active
    );
}

async fn run_tui() -> Result<()> {
    let config = match Config::load()? {
        Some(config) if !config.is_empty() => config,
        _ => {
            println!("No session. Run `sotto login` first.");
            return Ok(());
        }
    };

    let mut app = app::App::new(config)?;
    app.run().await
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    fn parse(args: &[&str]) -> Cli {
        Cli::try_parse_from(args).expect("args parse")
    }

    #[test]
    fn login_parses_server_token_and_as_name() {
        let cli = parse(&[
            "sotto",
            "login",
            "--server",
            "https://x.example",
            "--token",
            "tok",
            "--as",
            "work",
        ]);
        match cli.command {
            Some(Command::Login {
                server,
                token,
                as_name,
            }) => {
                assert_eq!(server.as_deref(), Some("https://x.example"));
                assert_eq!(token.as_deref(), Some("tok"));
                assert_eq!(as_name.as_deref(), Some("work"));
            }
            other => panic!("expected Login, got {other:?}"),
        }
    }

    #[test]
    fn login_without_flags_leaves_them_none() {
        let cli = parse(&["sotto", "login"]);
        assert!(matches!(
            cli.command,
            Some(Command::Login {
                server: None,
                token: None,
                as_name: None,
            })
        ));
    }

    #[test]
    fn switch_requires_a_name() {
        let cli = parse(&["sotto", "switch", "home"]);
        assert!(matches!(cli.command, Some(Command::Switch { name }) if name == "home"));
        // Missing name is a parse error.
        assert!(Cli::try_parse_from(["sotto", "switch"]).is_err());
    }

    #[test]
    fn accounts_has_a_profiles_alias() {
        assert!(matches!(
            parse(&["sotto", "accounts"]).command,
            Some(Command::Accounts)
        ));
        assert!(matches!(
            parse(&["sotto", "profiles"]).command,
            Some(Command::Accounts)
        ));
    }

    #[test]
    fn logout_name_is_optional_and_whoami_takes_none() {
        assert!(matches!(
            parse(&["sotto", "logout"]).command,
            Some(Command::Logout { name: None })
        ));
        assert!(
            matches!(parse(&["sotto", "logout", "work"]).command, Some(Command::Logout { name: Some(n) }) if n == "work")
        );
        assert!(matches!(
            parse(&["sotto", "whoami"]).command,
            Some(Command::Whoami)
        ));
    }

    #[test]
    fn no_subcommand_runs_the_tui() {
        assert!(parse(&["sotto"]).command.is_none());
    }

    #[test]
    fn profile_name_derives_from_server_host() {
        assert_eq!(
            profile_name_from_server("http://localhost:3000"),
            "localhost"
        );
        assert_eq!(
            profile_name_from_server("https://sotto.example.com/path"),
            "sotto.example.com"
        );
        assert_eq!(profile_name_from_server(""), DEFAULT_PROFILE);
    }
}
