# sotto

A headless **terminal client** for the [Sotto](https://github.com/affromero/Sotto)
language-learning platform. Learn a language from your terminal: mastery-gated
CEFR courses across grammar, reading, adaptive listening, and speaking, with a
personal vocabulary memory graph and spaced-repetition review — all driven by
your keyboard, with native audio playback and recording.

`sotto` talks to a Sotto server you control (self-hosted or managed). It is a
thin client: your learning data, AI keys, and audio providers live on the
server. The TUI just renders the screens and plays/records audio locally.

## What you get

- **Vocabulary SRS** — spaced-repetition review of words and grammar points.
- **Grammar & reading** — multiple-choice review with scrollable passages.
- **Adaptive listening** — play AI-generated audio lessons, read the transcript,
  answer comprehension questions, and **ask a contextual question** about the
  audio (`a`) for a spoken/text clarification.
- **Speaking** — record yourself against a target phrase and get graded feedback.
- **Classes & exams** — work through gated CEFR classes and take mock exams that
  walk you across listening / speaking / grammar / writing sections.
- **Placement** — get placed at the right CEFR level when you start a new course.
- **Memory graph** — a read-only view of everything you've tracked, with due items.
- **Settings** — see your server's provider/config (edit BYOK keys in the web app).
- **Themeable** — light/dark modes, the aula + paper palettes, and five accents,
  mirroring the web app. Switch live with `t`; persists to your config.
- **tmux-friendly** — a single keyboard-driven pane, no mouse required.

## Install

### With Cargo

```bash
cargo install sotto-tui   # the crate is `sotto-tui`; the installed command is `sotto`
```

Runs on **Linux and macOS**. (Audio playback/recording needs a working audio
device — see [Audio](#audio).)

### Prebuilt binaries

Grab the asset for your platform from the latest **`sotto-v*`** release on the
[Releases page](https://github.com/affromero/Sotto/releases?q=sotto-v), then move
it onto your `PATH`. The TUI ships on its own `sotto-v*` tag, so download from the
explicit tagged URL — do **not** use the repo-wide `/releases/latest/` alias,
which can point at an unrelated stream (e.g. `desktop-v*`).

Replace `sotto-v0.1.0` below with the latest `sotto-v*` tag:

```bash
SOTTO_TAG=sotto-v0.1.0
BASE="https://github.com/affromero/Sotto/releases/download/$SOTTO_TAG"

# macOS (Apple Silicon)
curl -LO "$BASE/sotto-aarch64-apple-darwin.tar.gz"
tar xzf sotto-aarch64-apple-darwin.tar.gz && sudo mv sotto /usr/local/bin/

# macOS (Intel)
curl -LO "$BASE/sotto-x86_64-apple-darwin.tar.gz"
tar xzf sotto-x86_64-apple-darwin.tar.gz && sudo mv sotto /usr/local/bin/

# Linux (x86_64)
curl -LO "$BASE/sotto-x86_64-unknown-linux-gnu.tar.gz"
tar xzf sotto-x86_64-unknown-linux-gnu.tar.gz && sudo mv sotto /usr/local/bin/

# Linux (ARM64)
curl -LO "$BASE/sotto-aarch64-unknown-linux-gnu.tar.gz"
tar xzf sotto-aarch64-unknown-linux-gnu.tar.gz && sudo mv sotto /usr/local/bin/
```

Each archive ships with a matching `.sha256` checksum on the release page. The
Linux builds are **dynamically** linked against the system audio stack (ALSA),
not fully static — see [Audio](#audio).

## Log in

`sotto` pairs with a server using a one-time token you generate in the web app:

1. In the Sotto web app, open **Settings → Devices** (`/settings/devices`) and
   create a pairing token.
2. Pair this device:

   ```bash
   sotto login
   # Server base URL (defaults to http://localhost:3000): https://your-sotto.example
   # paste the pairing token when prompted
   ```

   Or pass them as flags:

   ```bash
   sotto login --server https://your-sotto.example --token sk_pair_xxx
   ```

The redeemed API key and your server URL are saved to
`~/.config/sotto/config.toml` (owner-only, `0600` on Unix). Your theme choice is
stored there too and preserved across re-login.

Then just run:

```bash
sotto
```

## A quick tour

`sotto` opens on your **Courses**. Pick one to land on its **Course home**, where
you choose a skill to practice or continue your class/exam track:

```
Courses ─▶ Course home ─▶ practice a skill (vocab / grammar / reading /
                          listening / speaking)
                       ─▶ next class (gated CEFR track)
                       ─▶ mock exam
                       ─▶ memory graph / settings
```

No courses yet? Start **placement** from the Courses screen to pick your
languages, answer a short assessment, and get a course at the right CEFR level.

## Keybindings

Press **`?`** on any screen for a help overlay listing that screen's keys.

| Key | Action |
| --- | --- |
| `↑`/`↓` or `k`/`j` | move the selection |
| `1`–`9` | pick an option directly |
| `Enter` | confirm / answer / continue |
| `PgUp`/`PgDn` | scroll a long prompt or list |
| `Space` | play / pause (listening) |
| `r` | record / stop (speaking) |
| `a` | ask a question about the current audio (listening) |
| `Ctrl-D` | submit (writing) |
| `c` / `e` | next class / mock exam (course home) |
| `m` / `s` | memory graph / settings (course home) |
| `?` | toggle the key-help overlay |
| `t` | toggle the theme picker (mode / palette / accent) |
| `q` / `Esc` | back out a screen (or quit at the top) |
| `Ctrl-C` | quit |

## Audio

Listening playback and speaking recording use your operating system's audio
stack:

- **Linux** — ALSA (`libasound`). The prebuilt Linux binaries link against it
  dynamically, so a working ALSA setup is required for audio; most desktop
  distros ship it. (A fully static musl + audio build is **not** provided
  because the audio backend links to system libraries.)
- **macOS** — CoreAudio, built in.

If no audio device is available (for example over plain SSH without audio
forwarding), `sotto` **degrades gracefully**: every other screen works, and the
listening/speaking screens surface a clear "no audio device" note instead of
crashing.

## tmux

`sotto` is a single keyboard-driven pane and fits naturally in a tmux split —
keep it open next to your editor and review vocab between tasks:

```bash
tmux split-window -h sotto
```

It honors `prefers-reduced-motion`-style restraint (only `transform`/`opacity`-
equivalent redraws), respects narrow widths, and shows a "terminal too small"
notice below a hard floor (≈40×10) rather than clipping content.

## Configuration

`~/.config/sotto/config.toml`:

```toml
server_url = "https://your-sotto.example"
api_key    = "sk_sotto_..."        # minted by `sotto login`; keep this secret

[theme]
mode          = "light"             # light | dark
light_palette = "aula"              # aula | paper
accent        = "#3F4FB0"           # one of the five accent swatches
```

A missing or unreadable `[theme]` table falls back to defaults; a corrupt config
never crashes startup — `sotto` simply asks you to log in.

## Building from source

This crate lives in the [Sotto monorepo](https://github.com/affromero/Sotto)
under `tui/`. The typed API client is generated at build time from a vendored
copy of the OpenAPI contract (`tui/openapi.codegen.json`), so the crate builds
standalone:

```bash
cd tui
cargo build --release
```

The vendored spec is kept byte-for-byte in sync with the canonical
`packages/shared/openapi.codegen.json` by `npm run gen:openapi`; a test in
`@sotto/shared` guards against drift.

## License

[AGPL-3.0-only](https://github.com/affromero/Sotto/blob/main/LICENSE), matching
the Sotto platform.
