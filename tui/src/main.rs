mod action;
mod api;
mod app;
mod audio;
mod auth;
mod components;
mod config;
mod event;
mod tui;

use clap::{Parser, Subcommand};
use color_eyre::Result;

use crate::config::Config;

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
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    color_eyre::install()?;

    let cli = Cli::parse();

    match cli.command {
        Some(Command::Login { server, token }) => run_login(server, token).await,
        None => run_tui().await,
    }
}

async fn run_login(server: Option<String>, token: Option<String>) -> Result<()> {
    let server = server.unwrap_or_else(|| auth::DEFAULT_SERVER.to_string());
    let token = match token {
        Some(token) => token,
        None => auth::prompt_token()?,
    };

    let config = auth::login(&server, &token).await?;
    config.save()?;
    Ok(())
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
