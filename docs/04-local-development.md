# Local Development Guide - Sotto

> **Date**: 2026-06-13
>
> **Summary**: Run Sotto locally without a hosted secret manager, production database sync, cloud storage, or hosted infrastructure. The default local path uses PostgreSQL, Redis, local file storage, and explicit provider configuration.

---

## 1. Prerequisites

| Tool                            | Version        | Why                               |
| ------------------------------- | -------------- | --------------------------------- |
| Node.js                         | 20+            | Next.js, workers, scripts         |
| Docker Desktop or Docker Engine | Current stable | PostgreSQL and Redis              |
| FFmpeg                          | 6+             | Audio stitching and normalization |
| Git                             | 2.40+          | Source control                    |

Optional:

- `uv` and `pandoc` for release packet generation.
- A local agent CLI such as Claude Code or Codex.
- A hosted provider key for LLM/TTS/STT.

---

## 2. Quick Start

```bash
npm run setup
npm run dev
```

Open `http://localhost:3000`.

`npm run setup`:

1. install dependencies
2. start PostgreSQL and Redis
3. create `.env.local` from `.env.oss.example`
4. generate local secrets when missing
5. push the Prisma schema
6. generate the Prisma client
7. keep storage local by default

The quickstart must not require a hosted secret manager.

---

## 3. Manual Setup

```bash
npm install
cp .env.oss.example .env.local
docker compose up -d postgres redis
npx prisma migrate deploy --config=prisma.config.ts
npx prisma generate --schema=apps/web/prisma/schema.prisma
npm run dev
```

Use `.env.oss.example` for local onboarding. `.env.example` may include hosted deployment references; the OSS template is the local source of truth.

---

## 4. Minimal `.env.local`

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/sotto?schema=public"
DIRECT_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/sotto?schema=public"
REDIS_URL="redis://localhost:6379"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
BYOK_ENCRYPTION_KEY="<generated>"
SIDEDOOR_EXECUTION_DIR="./.sotto/executions"
```

Add provider and storage settings in `/welcome` or Admin for the workflow you are testing.

---

## 5. Provider Paths

### 5.1 One-Credential Hosted Provider

OpenAI can cover AI, TTS, and STT. Select OpenAI for all three capabilities and save one credential in `/welcome` or Admin.

### 5.2 Separate Providers

Select each specialized provider in the UI and save its credential. Sidedoor captures the selected credential before work is queued, so workers execute with the same authorized provider revision.

The dashboard usage widget shows provider usage from saved credentials and configured limits.

### 5.3 Local Agent

Choose Claude Code or Codex for generation and select a speech provider for audio. Local agent CLIs must be installed and authenticated outside Sotto. Sotto reports a setup error when the selected CLI is unavailable.

The model picker is populated from saved selections and local CLI discovery. Optional runtime variables can expose additional CLI model aliases:

```env
CLAUDE_CODE_MODEL="opus"
CLAUDE_CODE_MODELS="opus,sonnet,haiku,claude-fable-5"
CLAUDE_CODE_EFFORT="xhigh"
CLAUDE_CODE_EFFORTS="low,medium,high,xhigh,max"

CODEX_MODEL="gpt-5.5"
CODEX_MODELS="gpt-5.5,gpt-5.6"
CODEX_MODEL_REASONING_EFFORT="xhigh"
CODEX_MODEL_REASONING_EFFORTS="low,medium,high,xhigh,max"
```

### 5.4 Totally Local Models

Use the no-code local contracts when running your own models. Save the local AI URL and model, local STT URL and model, and local TTS URL, model, and voice IDs in `/welcome` or Admin.

See `docs/05-provider-extension-guide.md` for the exact LLM/STT/TTS contracts and native-provider checklists.

---

## 6. Live Provider Checks

Use the test action on each saved provider card in Admin. The request uses the same captured Sidedoor credential and endpoint policy as production work and reports the provider error directly.

---

## 7. What Works By Configuration Level

| Configuration                    | Available                                              |
| -------------------------------- | ------------------------------------------------------ |
| local DB + Redis + storage       | app shell, dashboard, settings, local library metadata |
| plus selected LLM or local agent | discovery, scripting, Q&A text paths                   |
| plus selected TTS                | end-to-end audio generation                            |
| plus selected STT                | meeting/audio transcription                            |

No missing capability should be hidden by an implicit provider fallback.

---

## 8. Development Commands

| Command                   | What it does                      |
| ------------------------- | --------------------------------- |
| `npm run setup`           | bootstrap local OSS development   |
| `npm run dev`             | start web app and workers         |
| `npm run dev:web`         | start web app only                |
| `npm run dev:workers`     | start workers only                |
| `npm run lint`            | run ESLint                        |
| `npm run type-check`      | run TypeScript checks             |
| `npm run test`            | run Vitest                        |
| `npm run build`           | build web app                     |
| `npm run ci`              | lint, type-check, test, and build |
| `npm run prisma:push`     | push Prisma schema                |
| `npm run prisma:generate` | generate Prisma client            |
| `npm run prisma:studio`   | open Prisma Studio                |

Run `npm run ci` before each commit on this refactor branch.

---

## 10. Troubleshooting

### PostgreSQL or Redis port is already in use

Change the Docker Compose port mapping or stop the local service using the port, then update `.env.local`.

### Prisma client is stale

```bash
npx prisma generate --schema=apps/web/prisma/schema.prisma
```

### FFmpeg is missing

Install it with your package manager:

```bash
brew install ffmpeg
```

or:

```bash
sudo apt install ffmpeg
```

### Provider validation fails

Check that the selected provider exactly matches the configured key. Sotto should report the missing provider capability and should not reroute to another provider automatically.

### Local storage fails

Confirm that **Local** storage is saved in `/welcome` or Admin and that the process can create the configured storage root. Keep `SIDEDOOR_EXECUTION_DIR` writable as well.

### Workers cannot reach services

Local development outside Docker should use `localhost`. Full Docker deployments should use service names such as `postgres`, `redis`, and `local-tts`.
