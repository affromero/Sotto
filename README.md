# Sotto

**Learn a language with a tutor you own.**

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE) [![Self-hostable](https://img.shields.io/badge/self--hostable-yes-brightgreen)]() [![BYOK](https://img.shields.io/badge/BYOK-bring%20your%20own%20keys-orange)]()

---

## What is Sotto

Sotto is open-source, self-hostable language-learning infrastructure. Instead of locking you into a subscription app and its servers, Sotto runs on your own stack, uses your own AI agents, and keeps all data on infrastructure you control.

The curriculum is organized around CEFR levels and covers four skills:

- **Grammar** — structured exercises with automated feedback from your connected LLM.
- **Reading** — graded passages with comprehension checks, vocabulary extraction, and review.
- **Listening** — an adaptive audio course generated and narrated by your own TTS provider.
- **Speaking** — pronunciation feedback scored through your connected STT/pronunciation provider.

Progression is mastery-gated: you do not advance to the next unit until you demonstrate command of the current one. As you learn, a personal vocabulary memory graph tracks what you know and surfaces spaced-repetition reviews.

You bring your own Claude Code, Codex, or any API-compatible agent. You bring your own keys for LLM, TTS, and STT. Nothing is billed through Sotto for the self-hosted build — you pay your providers directly.

---

## Why Sotto

| Capability | Sotto | Duolingo | Speak | Praktika | TalkPal | Pimsleur |
|---|---|---|---|---|---|---|
| Open source | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Self-hostable | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| BYOK / own API keys | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Bring your own agent (Claude Code / Codex) | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Data stays private (your infra) | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| 4-skill (grammar / reading / listening / speaking) | ✓ | ~ | ~ | ~ | ~ | ~ |
| Mastery-gated progression | ✓ | ~ | ✗ | ✗ | ✗ | ~ |
| Spaced-repetition memory graph | ✓ | ~ | ✗ | ✗ | ✗ | ~ |
| Adaptive listening podcasts | ✓ | ✗ | ✗ | ✗ | ✗ | ~ |
| Offline / PDF worksheets | ✓ | ✗ | ✗ | ✗ | ✗ | ~ |
| Pronunciation scoring | ✓ | ~ | ✓ | ✓ | ✓ | ✗ |
| Price model | Free / self-host (pay providers directly) | Freemium + sub | Subscription | Subscription | Subscription | Subscription |

Values reflect the self-hosted open-source build; pronunciation-scoring quality depends on the speech provider you connect. Verified June 2026.

Every ✓ in the Sotto column ships in this repo today (see [Status](#status)).

---

## Architecture

```
apps/web          Next.js 16 App Router — web UI, API routes, Prisma schema, Vitest tests
apps/mobile       Expo React Native — iPad-first UI with react-native-track-player
packages/shared   Shared types, Zod schemas, brand copy
packages/mcp      MCP server — exposes Sotto tools to Claude Code / Codex locally
packages/maps     Language curriculum maps (private submodule)
services/remotion Remotion render sidecar (video worksheets)
```

**Runtime stack:**

- PostgreSQL 16 + Prisma ORM for user data, vocabulary graph, and progress records.
- Redis 7 + BullMQ worker pool for all heavy async work (generation, scoring, audio stitching).
- Provider-resolved AI, TTS, and STT: the resolvers (`resolveAutoModel`, `resolveTtsProvider`, `resolveSttProvider`) pick the configured provider — never by key availability.
- Local Claude Code or Codex CLI routed through `AI_PROVIDER=claude-code`; no outbound API key required for that path.
- MCP server (`packages/mcp`) lets your local agent call `ingest_agent_output` and other Sotto tools directly.

---

## Self-host quickstart

Prerequisites: Node.js 18+, Docker, FFmpeg.

```bash
# 1. Clone and set up
git clone https://github.com/SottoFM/sotto.git
cd sotto
npm run setup
```

`npm run setup` installs all workspace dependencies, copies `.env.oss.example` to `.env.local`, generates `AUTH_SECRET` and `BYOK_ENCRYPTION_KEY`, starts PostgreSQL and Redis via Docker Compose, pushes the Prisma schema, generates the Prisma client, and seeds the CEFR language curriculum.

```bash
# 2. Start the app
npm run dev
```

That's the minimum path. Open `http://localhost:3000`.

**To route generation through your local Claude CLI with no API key:**

```dotenv
# .env.local
AI_PROVIDER=claude-code
```

**One-key hosted path** (OpenAI for everything):

```dotenv
OPENAI_API_KEY=sk-...
AI_PROVIDER=openai
TTS_PROVIDER=openai
STT_PROVIDER=openai
```

**Manual setup** (if you prefer not to use `npm run setup`):

```bash
npm install
cp .env.oss.example .env.local
docker compose up -d postgres redis
npx prisma db push --schema=apps/web/prisma/schema.prisma
npx prisma generate --schema=apps/web/prisma/schema.prisma
npm run dev
```

`.env.oss.example` defaults to local PostgreSQL, local Redis, local file storage under `.sotto/storage`, and payments disabled.

---

## Bring your own Claude / Codex and keys

Sotto is designed around BYOK from the start. There are three places this surfaces:

**1. Source connector readiness flag**
`apps/web/src/lib/source-connectors.ts` exports a `CONNECTOR_READINESS` map. The `agent` connector is marked ready; set `AI_PROVIDER=claude-code` or `AI_PROVIDER=codex` to route all LLM calls through your local CLI.

**2. MCP server**
`packages/mcp` exposes an MCP-compatible server. Add it to your Claude Code or Codex config and call the `ingest_agent_output` tool to push content from any agent workflow directly into Sotto.

**3. BYOK in Settings**
The Settings page lets you store encrypted API keys (LLM, TTS, STT) per-account. Keys are encrypted at rest with `BYOK_ENCRYPTION_KEY`. You pay your providers; Sotto is the infrastructure layer.

---

## Status

The full learning loop is shipped and self-hostable today:

- **Clean OSS core** — briefings/news/meetings/social/quiz/bot pipelines removed; AGPL-3.0; `.env.oss.example`, `npm run setup`, local-storage default, payments disabled.
- **BYOK / own agent** — `AI_PROVIDER=claude-code` (or `codex`) routes every LLM call through your local CLI; encrypted per-account keys; MCP `ingest_agent_output`; source-connector readiness.
- **Placement → courses** — a CEFR/Goethe-aligned placement test assigns a level and creates a directed course (German-from-English, English-from-Spanish, Spanish-from-English).
- **Mastery-gated classes** — each class is four skill sections; you cannot advance until you pass, and failed sections regenerate in a similar-but-not-identical form (retrieval practice / anti-copy).
- **Four skills** — grammar and reading (multiple choice), adaptive listening (an AI podcast seeded by your due vocabulary, with comprehension questions), and speaking (record → STT → pronunciation scoring with a rubric).
- **Vocabulary memory graph** — a per-course, Obsidian-style graph with SM-2 spaced repetition that drives review selection, seeds the listening podcast, and renders as an interactive Cytoscape visualization.
- **Worksheets** — a print-optimized worksheet page plus a server-side PDF, with iPad PencilKit annotation (ink stored, never graded; needs a custom Expo dev build).
- **Web + iPad** — the whole flow runs on the Next.js web app and the Expo iOS/iPad app against the same APIs.

**Planned (optional managed offering):**

- Hosted infrastructure for non-technical learners — workers, storage, scheduled generation, and provider routing as a convenience layer. The learning stack itself stays open and self-hostable.

---

## Development commands

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

---

## License

[AGPL-3.0](LICENSE) — free to self-host, modify, and redistribute under the same terms. If you run a modified version as a network service, you must publish the source.
