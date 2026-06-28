# Local Development Guide - Sotto

> **Date**: 2026-06-13
>
> **Summary**: Run Sotto locally without Doppler, production database sync, cloud storage, or hosted infrastructure. The default local path uses PostgreSQL, Redis, local file storage, and explicit provider configuration.

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

The quickstart must not require Doppler.

---

## 3. Manual Setup

```bash
npm install
cp .env.oss.example .env.local
docker compose up -d postgres redis
npx prisma db push --schema=apps/web/prisma/schema.prisma
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
STORAGE_PROVIDER="local"
LOCAL_STORAGE_DIR="./.sotto/storage"
```

Add provider settings only for the workflow you are testing.

---

## 5. Provider Paths

### 5.1 One-Key Hosted Provider

OpenAI can cover the smallest hosted-provider path when configured for LLM, TTS, and STT:

```env
OPENAI_API_KEY="sk-..."
AI_PROVIDER="openai"
TTS_PROVIDER="openai"
STT_PROVIDER="openai"
```

### 5.2 Separate Providers

Use explicit provider choices when testing specialized providers:

```env
AI_PROVIDER="anthropic"
ANTHROPIC_API_KEY="sk-ant-..."
TTS_PROVIDER="elevenlabs"
ELEVENLABS_API_KEY="..."
STT_PROVIDER="openai"
OPENAI_API_KEY="sk-..."
```

The dashboard usage widget can show audio provider credits from the keys users
add in the wizard or provider settings. ElevenLabs usage works with the normal
ElevenLabs key. Cartesia usage needs the optional Cartesia admin key from
the wizard, provider settings, or `CARTESIA_ADMIN_API_KEY`; a plan preset or
custom monthly limit plus reset day lets Sotto show credits remaining instead
of only credits used.

### 5.3 Local Agent

Use a local agent for script generation and a selected TTS provider for audio:

```env
AI_PROVIDER="claude-code"
TTS_PROVIDER="openai"
OPENAI_API_KEY="sk-..."
```

Local agent CLIs must be installed and authenticated outside Sotto. Sotto should detect missing CLIs and report a setup error instead of choosing another provider.

### 5.4 Totally Local Models

Use the no-code local contracts when running your own models:

```env
AI_PROVIDER="local"
AI_BASE_URL="http://localhost:11434/v1"
AI_MODEL="qwen3"

STT_PROVIDER="local"
STT_BASE_URL="http://localhost:8001/v1"
STT_MODEL="deepdml/faster-whisper-large-v3-turbo-ct2"

TTS_PROVIDER="local"
TTS_BASE_URL="http://localhost:8000"
TTS_MODEL="my-local-tts-model"
TTS_VOICES="default,alternate"
```

See `docs/05-provider-extension-guide.md` for the exact LLM/STT/TTS contracts and native-provider checklists.

---

## 6. Live Audio Provider Smoke Check

The unit test suite never requires live provider keys. When you do want to verify real provider wiring, run the optional smoke script against whichever keys are present:

```bash
scripts/run-with-env.sh npm run smoke:audio-providers
```

If your keys come from a private secret manager, enter that environment first and run the same command there.

The script skips missing providers and fails only providers it actually calls. With the relevant keys, it checks:

| Check                                     | Environment variable |
| ----------------------------------------- | -------------------- |
| Pexels visual cue search                  | `PEXELS_API_KEY`     |
| Cartesia Spanish TTS sample               | `CARTESIA_API_KEY`   |
| OpenAI STT on the sample audio            | `OPENAI_API_KEY`     |
| ElevenLabs Scribe STT on the sample audio | `ELEVENLABS_API_KEY` |

To reuse your own audio instead of generating a Cartesia sample:

```bash
SOTTO_AUDIO_SMOKE_FILE=/path/to/sample.mp3 npm run smoke:audio-providers
```

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

## 8. Private RSS Smoke Test

With the app running:

```http
POST /api/v1/rss/private
GET /api/v1/rss/private
DELETE /api/v1/rss/private/tokens/:tokenId
GET /api/v1/rss/private/:token
```

Expected behavior:

- raw token appears only on creation
- database stores only the token hash
- revoked tokens stop working
- feed contains only the owner's ready, non-deleted private or unlisted episodes

---

## 9. Development Commands

| Command                         | What it does                                       |
| ------------------------------- | -------------------------------------------------- |
| `npm run setup`                 | bootstrap local OSS development                    |
| `npm run dev`                   | start web app and workers                          |
| `npm run dev:web`               | start web app only                                 |
| `npm run dev:workers`           | start workers only                                 |
| `npm run lint`                  | run ESLint                                         |
| `npm run type-check`            | run TypeScript checks                              |
| `npm run test`                  | run Vitest                                         |
| `npm run smoke:audio-providers` | optional live Pexels, TTS, and STT provider checks |
| `npm run build`                 | build web app                                      |
| `npm run ci`                    | lint, type-check, test, and build                  |
| `npm run prisma:push`           | push Prisma schema                                 |
| `npm run prisma:generate`       | generate Prisma client                             |
| `npm run prisma:studio`         | open Prisma Studio                                 |

Run `npm run ci` before each commit on this refactor branch.

---

## 10. Troubleshooting

### PostgreSQL or Redis port is already in use

Change the Docker Compose port mapping or stop the local service using the port, then update `.env.local`.

### Prisma client is stale

```bash
npx prisma db push --schema=apps/web/prisma/schema.prisma
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

Confirm:

```env
STORAGE_PROVIDER="local"
LOCAL_STORAGE_DIR="./.sotto/storage"
```

Then ensure the process can create the storage directory.

### Workers cannot reach services

Local development outside Docker should use `localhost`. Full Docker deployments should use service names such as `postgres`, `redis`, and `local-tts`.
