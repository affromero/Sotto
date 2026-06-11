# Sotto Host — desktop launcher

A tiny [Tauri](https://tauri.app) app that runs a **self-hosted** Sotto on a
laptop or desktop with no terminal: open it, click **Start**, and it brings up
the Docker Compose stack (the same one `scripts/install.sh` installs in
`~/.sotto`), waits for health, and opens the app in your browser.

The product is **self-hosted only** — Sotto Host launches *your* instance; it is
not a hosted account. Builds are distributed from **sotto.fm** (see below).

## What it does

The Rust side (`src-tauri/src/lib.rs`) is intentionally minimal and shells out to
Docker Compose:

| Command | Action |
|---|---|
| `docker_available` | Is Docker installed/running? |
| `installed` | Is there a stack in `~/.sotto`? |
| `start_stack` / `stop_stack` | `docker compose up -d` / `down` in `~/.sotto` |
| `is_healthy` | TCP probe of the web port (3000) |
| `open_app` | Open `http://localhost:3000` in the default browser |

The UI is plain HTML/JS in `src/` (no bundler) talking to those commands via the
global Tauri bridge.

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
npm run build       # produce a signed installer for the current OS
```

## Distribution

- **Source** lives here; **downloads come from sotto.fm** (`/download/{mac,windows,linux}`).
- `.github/workflows/desktop-release.yml` builds macOS / Windows / Linux installers
  on tag push and uploads them to R2 (the bucket sotto.fm serves) — credentials
  come from repo secrets (mirrored from Doppler):
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET`.
- **Code signing / notarization** (Apple Developer ID, Windows Authenticode) is
  required for a smooth install and needs your certificates — add them as the
  Tauri signing secrets documented at
  https://tauri.app/distribute/ before enabling signed release builds.

## Status

The launcher and release pipeline are complete in source. They have **not been
compiled or signed in this environment** (no Rust/Tauri toolchain here) — build
once on a machine with the toolchain (or via the workflow) to produce installers.
