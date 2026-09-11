# Sotto Host desktop launcher

A [Tauri](https://tauri.app) app that controls an installed Sotto stack.
Run `scripts/install.sh` first. Then open the launcher and click **Start** to
start Docker Compose, wait for health, and open Sotto in your browser.

Sotto Host launches your self-hosted instance. Builds are distributed from
**sotto.fm** (see below).

## What it does

The Rust side (`src-tauri/src/lib.rs`) is intentionally minimal and shells out to
Docker Compose:

| Command                      | Action                                                        |
| ---------------------------- | ------------------------------------------------------------- |
| `docker_available`           | Is the Docker daemon reachable and Compose installed?         |
| `installed`                  | Is there a stack in `~/.sotto`?                               |
| `start_stack` / `stop_stack` | `docker compose up -d` / `down` in `~/.sotto`                 |
| `web_port`                   | Read `WEB_PORT` from the installation's `.env` (default 3000) |
| `is_healthy`                 | Check the configured port's `/api/v1/health` response         |
| `open_app`                   | Open the configured local port in the default browser         |

The UI is plain HTML/JS in `src/` (no bundler) talking to those commands via the
global Tauri bridge.

Install the stack with the command shown in the launcher before clicking Start.
The launcher uses `~/.sotto`, or `SOTTO_DIR` when provided in its environment.
Docker Desktop must be running. On Windows, run the installer in WSL and ensure
the launcher can access that installation; a WSL home and Windows home are
different directories.

Linux AppImages bundle GStreamer plugins, including `appsink`, because WebKit
initializes its media backend during startup. See the [Tauri packaging guide](https://v2.tauri.app/distribute/appimage/).
CI builds on Ubuntu 22.04, checks the bundled plugin, and launches the extracted
AppImage under Xvfb before publishing it. Run `npm test` and
`cargo test --locked --manifest-path src-tauri/Cargo.toml` for launcher tests.

## Build it (needs the Rust + Tauri toolchain)

> This repo ships the source; the binaries are built by the release workflow and
> distributed from **sotto.fm/download**. To build locally:

```bash
# Prerequisites: Rust (https://rustup.rs) + Tauri v2 system deps
#   https://tauri.app/start/prerequisites/
cd apps/desktop
npm install
npm run icon        # generate src-tauri/icons/* from the orb SVG (one-time)
npm run dev         # run the launcher in dev
npm run build       # produce an unsigned installer for the current OS
```

## Distribution

- **Source** lives here; **downloads come from sotto.fm** (`/download/{mac,windows,linux}`).
- `.github/workflows/desktop-release.yml` builds macOS / Windows / Linux installers
  on tag push and uploads them to R2 (the bucket sotto.fm serves). Credentials
  come from repo secrets (mirrored from Infisical):
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET`.
- Release artifacts are currently unsigned. **Code signing / notarization**
  (Apple Developer ID, Windows Authenticode) is required for a smooth install
  and needs your certificates — add them as the
  Tauri signing secrets documented at
  https://tauri.app/distribute/ before enabling signed release builds.
