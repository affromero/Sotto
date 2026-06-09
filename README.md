<div align="center">

# Sotto

**Learn a language with the agent that already knows you.**

Open-source, self-hostable language-learning infrastructure — taught in the context of your work and interests, through the agent and keys you already own.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-A42E2B.svg?logo=gnu)](LICENSE)
[![Self-hostable](https://img.shields.io/badge/self--hostable-yes-1F8A5B)](#self-host)
[![BYOK](https://img.shields.io/badge/BYOK-bring%20your%20own%20keys-D97706)](#bring-your-own-claude--codex)
[![Bring your own agent](https://img.shields.io/badge/agent-Claude%20Code%20%2F%20Codex-3F4FB0)](#bring-your-own-claude--codex)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)](https://react.dev)
[![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma&logoColor=white)](https://prisma.io)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-1F8A5B.svg)](CONTRIBUTING.md)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/afromero)

<sub>From the Italian *sotto voce* — speaking in a soft, intimate voice.</sub>

</div>

---

## Quick Start

Just Docker — no clone, no build:

```bash
curl -fsSL https://raw.githubusercontent.com/SottoFM/sotto/main/scripts/install.sh | bash
```

The installer pulls the pre-built images, asks how to connect your AI (an API key, your local **Claude Code / Codex** CLI with no key, or your agent on a VPS over SSH), writes config to `~/.sotto`, and starts everything.

1. Open [localhost:3000](http://localhost:3000)
2. Take a 2-minute placement test → it puts you at the right CEFR level
3. Start your first mastery-gated class, or sharpen one skill in ungated practice

Manage it from `~/.sotto`: `docker compose logs -f`, `docker compose down`.

## Why Sotto?

Every serious language app is closed, hosted, and subscription-funded. Your progress, your vocabulary, and the model that teaches you all live on someone else's servers. **Sotto inverts that.** You run the whole stack, you connect your own Claude or Codex — the agent that already knows your work and your interests — and it builds a course around the things you actually care about. Your data never leaves infrastructure you control.

<details>
<summary>The longer version</summary>

<br>

1. **The agent already knows you.** Connect your own Claude Code or Codex and grant the context you choose — your notes, goals, the things you're working on. Sotto draws lessons, readings, and listening from your real life instead of generic content.
2. **You own the learning stack.** Self-host it on your machine or a VPS, with your keys, your database, and your files. There's no Sotto account holding your progress hostage.
3. **Pedagogy over gamification.** Mastery-gating is [retrieval practice](https://en.wikipedia.org/wiki/Testing_effect) (the testing effect). The adaptive listening podcast is [comprehensible input](https://en.wikipedia.org/wiki/Input_hypothesis) (Krashen's *i+1*). The memory graph is [spaced repetition](https://en.wikipedia.org/wiki/Spaced_repetition) on the [SM-2](https://super-memory.com/english/ol/sm2.htm) algorithm. No streaks-as-[dark-pattern](https://en.wikipedia.org/wiki/Dark_pattern), no leaderboards — **there is no social layer at all.**
4. **Bring your own everything.** LLM, TTS, STT — explicit provider selection, BYOK, or a keyless local agent. You pay your providers directly; nothing is billed through the self-hosted build.

</details>

## What You Get

A complete [CEFR](https://www.coe.int/en/web/common-european-framework-reference-languages/level-descriptions) course across **five skills**, on a stack you control:

| | |
|---|---|
| 🧩 **Grammar** | Multiple-choice drills with elaborative feedback from your connected LLM |
| 📖 **Reading** | Graded passages with comprehension checks + vocabulary extraction |
| 🎧 **Listening** | An adaptive audio episode generated + narrated by your TTS, seeded with your due vocabulary |
| 🎤 **Speaking** | Record → STT → pronunciation scoring with a rubric |
| ✍️ **Writing** | Free-text tasks graded synchronously with inline AI corrections (old → new + why) |

Plus the rest of the loop:

- **Mastery-gated classes** — you can't advance until you pass; failed sections regenerate in a *similar-but-not-identical* form (retrieval practice / anti-copy).
- **Ungated practice** — drill any single skill on your own time, spaced-repetition-driven, separate from the graded classes.
- **Personal memory graph** — a per-course, [Obsidian](https://obsidian.md/)-style vocabulary/grammar graph with [SM-2](https://super-memory.com/english/ol/sm2.htm) spaced repetition that drives review, seeds the listening podcast, and renders as an interactive [Cytoscape](https://js.cytoscape.org/) visualization.
- **Notes that personalize everything** — tell Sotto your goals and background once; it threads through placement, classes, and practice.
- **Any language pair** — German/English/Spanish ship as hand-authored reference curricula; any other native→target pair is composed by your connected agent on demand.
- **Worksheets** — a print-optimized worksheet + server-side PDF, with iPad PencilKit annotation.
- **Web + iPad** — the whole flow runs on the Next.js web app and the Expo iOS/iPad app against the same APIs.

## How Sotto Compares

The newest wave of apps connects an LLM to language learning. [OpenLingo](https://openlingo.dev) is the closest in spirit — "personalised units, read/listen to translated articles, practice with AI." But it's a hosted service. **Sotto is the version you own:** your agent, your keys, your data, and a full [mastery-gated](https://en.wikipedia.org/wiki/Mastery_learning) [CEFR](https://www.coe.int/en/web/common-european-framework-reference-languages/level-descriptions) course across five skills — not just generated units.

| Capability | Sotto | [OpenLingo](https://openlingo.dev) | [Duolingo](https://www.duolingo.com) | [Speak](https://www.speak.com) | [Praktika](https://praktika.ai) | [TalkPal](https://talkpal.ai) | [Pimsleur](https://www.pimsleur.com) |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Open source | ✅ | 〰️ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Self-hostable | ✅ | ❓ | ❌ | ❌ | ❌ | ❌ | ❌ |
| BYOK / own API keys | ✅ | ❓ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Bring your own agent ([Claude Code](https://docs.anthropic.com/en/docs/claude-code) / [Codex](https://github.com/openai/codex)) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Data stays private (your infra) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 5-skill (grammar / reading / listening / speaking / writing) | ✅ | 〰️ | 〰️ | 〰️ | 〰️ | 〰️ | 〰️ |
| Mastery-gated progression | ✅ | ❓ | 〰️ | ❌ | ❌ | ❌ | 〰️ |
| [Spaced-repetition](https://en.wikipedia.org/wiki/Spaced_repetition) memory graph | ✅ | ❌ | 〰️ | ❌ | ❌ | ❌ | 〰️ |
| Adaptive listening podcasts | ✅ | 〰️ | ❌ | ❌ | ❌ | ❌ | 〰️ |
| Pronunciation scoring | ✅ | ❓ | 〰️ | ✅ | ✅ | ✅ | ❌ |
| No social layer / dark patterns | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Price | Self-host (pay providers directly) | Free (beta) | Freemium + sub | Sub | Sub | Sub | Sub |

<sub>✅ yes · 〰️ partial · ❌ no · ❓ unspecified. Values reflect the self-hosted open-source build; pronunciation quality depends on the speech provider you connect. OpenLingo's row reflects its public landing page ([openlingo.dev](https://openlingo.dev), June 2026), where much is unspecified. Verified June 2026.</sub>

## The Learning Loop

```
placement  →  mastery-gated class  →  pass to advance  →  next class adapts
   │              (5 skills)            (or regenerate          ▲
   │                  │                  a fresh form)          │
   └──────────────────┴──────────────────────────────────────┐ │
                      ▼                                        │ │
              memory graph (SM-2)  ──── seeds due vocab ───────┘ │
                      ▲                                          │
                      └──────────── ungated practice ───────────┘
```

Everything a learner does — classes and practice alike — feeds one course-scoped memory graph. Due and weak items resurface in the next class's adaptive content and in practice.

## Architecture

```
apps/web          Next.js 16 App Router — web UI, API routes, Prisma schema, Vitest tests
apps/mobile       Expo React Native — iPad-first UI with react-native-track-player
packages/shared   Shared types, Zod schemas, brand copy
packages/mcp      MCP server — exposes Sotto tools to Claude Code / Codex locally
packages/maps     Language curriculum maps (private submodule, optional)
services/remotion Remotion render sidecar (video worksheets)
```

<details>
<summary>Runtime stack</summary>

<br>

- **[PostgreSQL](https://www.postgresql.org/) 16 + [Prisma](https://www.prisma.io/)** — user data, vocabulary graph, progress.
- **[Redis](https://redis.io/) 7 + [BullMQ](https://docs.bullmq.io/)** — all heavy async work (generation, scoring, audio stitching).
- **Provider-resolved AI / TTS / STT** — explicit resolvers (`resolveLearningAi`, `resolveTtsProvider`, `resolveSttProvider`) pick the configured provider, never by key availability.
- **Keyless local agent** — `AI_PROVIDER=claude-code` (or `codex`) routes every LLM call through your local CLI; no outbound API key required.
- **[MCP](https://modelcontextprotocol.io/) server** (`packages/mcp`) — your local agent calls `ingest_agent_output` and other Sotto tools directly.
- **Web + iPad** — [Next.js](https://nextjs.org/) + [React](https://react.dev/) on the web; [Expo](https://expo.dev/) React Native with [react-native-track-player](https://rntp.dev/) and [PencilKit](https://developer.apple.com/documentation/pencilkit) on iPad; [Remotion](https://www.remotion.dev/) + [FFmpeg](https://ffmpeg.org/) for video worksheets.

</details>

## Self-host

### One command (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/SottoFM/sotto/main/scripts/install.sh | bash
```

During install you choose how Sotto reaches your AI:

- **An API key** (OpenAI or Anthropic) — simplest.
- **Your local Claude Code / Codex CLI** — bring your own agent; it passes your credentials into the container, no API key.
- **Your agent on a VPS, over SSH** — Sotto runs `ssh you@vps claude ...` for every LLM call (`CLAUDE_CODE_SSH_HOST`), so your data can stay on your machine.

### From source (contributors)

Prerequisites: [Node.js](https://nodejs.org/) 18+, [Docker](https://www.docker.com/), [FFmpeg](https://ffmpeg.org/).

```bash
git clone https://github.com/SottoFM/sotto.git
cd sotto
npm run setup     # deps, .env.local (AUTH_SECRET + BYOK_ENCRYPTION_KEY), Postgres + Redis, schema, seed
npm run dev
```

Then open [localhost:3000](http://localhost:3000). The private `maps` submodule is optional — a no-op stub is dropped in when it's absent.

<details>
<summary>Bring your own agent / keys (.env.local)</summary>

<br>

Route everything through your local Claude, no key:

```dotenv
AI_PROVIDER=claude-code            # or codex
# CLAUDE_CODE_SSH_HOST=you@vps     # ...or your agent on a VPS, over SSH
```

Or one OpenAI key for everything:

```dotenv
AI_PROVIDER=openai
TTS_PROVIDER=openai
STT_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

`.env.oss.example` defaults to local PostgreSQL, local Redis, local file storage under `.sotto/storage`, and payments disabled.

</details>

## Bring your own Claude / Codex

Sotto is built around BYOK from the start, surfaced three ways:

1. **Keyless local agent** — set `AI_PROVIDER=claude-code` (or `codex`) and every LLM call runs through your local [Claude Code](https://docs.anthropic.com/en/docs/claude-code) or [Codex](https://github.com/openai/codex) CLI, no API key. Source-connector readiness is exposed in `apps/web/src/lib/source-connectors.ts`.
2. **[MCP](https://modelcontextprotocol.io/) server** — add `packages/mcp` to your Claude Code or Codex config and call `ingest_agent_output` to push content from any agent workflow straight into Sotto.
3. **BYOK in Settings** — store encrypted per-account API keys (LLM, TTS, STT), encrypted at rest with `BYOK_ENCRYPTION_KEY`. You pay your providers; Sotto is the infrastructure layer.

## Status

The full learning loop is shipped and self-hostable today:

- ✅ **Clean OSS core** — AGPL-3.0; `.env.oss.example`, `npm run setup`, local-storage default, payments disabled; no social/news/briefing surfaces.
- ✅ **BYOK / own agent** — keyless `claude-code`/`codex`, encrypted per-account keys, MCP ingestion.
- ✅ **Placement → any-language courses** — CEFR placement assigns a level and creates a directed course for any native→target pair.
- ✅ **Mastery-gated classes** across all five skills, with similar-but-not-identical regeneration on failure.
- ✅ **Ungated practice + learner notes** — per-skill spaced-repetition practice; notes personalize placement, classes, and practice.
- ✅ **Vocabulary memory graph** — per-course SM-2 graph, Cytoscape visualization, drives review + adaptive listening.
- ✅ **Worksheets + web/iPad** — print/PDF worksheets with PencilKit ink; the whole flow runs on web and iPad.

**Planned (optional managed offering):** hosted infrastructure for non-technical learners — workers, storage, scheduled generation, and provider routing as a convenience layer. The learning stack itself stays open and self-hostable.

## Development

```bash
npm run dev           # web + workers
npm run dev:web       # web only
npm run dev:workers   # workers only
npm run build
npm run lint
npm run type-check
npm run test
npm run ci            # lint + type-check + test + build (run before every commit)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

## Related Projects

| Project | Description |
|---------|-------------|
| [**Flight Finder**](https://github.com/affromero/flight-finder) | Track flight prices over time — self-hosted, BYO-LLM |
| [**PriceToken**](https://github.com/affromero/pricetoken) | Real-time LLM pricing API, packages, and live dashboard |
| [**gitpane**](https://github.com/affromero/gitpane) | Multi-repo Git workspace dashboard for the terminal |
| [**kin3o**](https://github.com/affromero/kin3o) | AI-powered Lottie animation generator CLI |
| [**Splattie**](https://github.com/affromero/splattie) | Interactive rigged 3D Gaussian assets from a single image |

## License

[AGPL-3.0](LICENSE) ([full text](https://www.gnu.org/licenses/agpl-3.0.en.html)) — free to self-host, modify, and redistribute under the same terms. If you run a modified version as a network service, you must publish the source.
