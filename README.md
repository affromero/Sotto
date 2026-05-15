# Sotto

Private audio briefings from your agents, meetings, workflows, and trusted sources.

Sotto is open source infrastructure for people who want private, self-owned audio feeds. The goal is simple: point your agents and sources at Sotto, generate audio briefings, and listen in any podcast app through private RSS.

## What It Is

Sotto turns structured work into private audio:

- Agent outputs from Claude Code, Codex, OpenClaw, Hermes, or another local/hosted assistant.
- Meeting recordings and transcripts that should feed a personal daily briefing.
- News and source digests for a separate "what happened in the world" podcast.
- Twitter, Telegram, or other bot-triggered workflows when self-hosted.
- Manual topics and imported audio for people who still want direct podcast creation.

The default is private. New podcasts are private unless a user explicitly changes visibility, and private/unlisted visibility is not a paid feature.

## What It Is Not

Sotto should not be another NotebookLM wrapper.

NotebookLM-style generation starts from documents and produces a one-off synthetic conversation. Sotto's useful surface is the private delivery layer around recurring workflows: agents, meetings, news, bots, imported audio, verified references, scheduled briefings, and private RSS feeds owned by the user.

If hosted billing exists, it should charge for managed infrastructure and convenience: workers, storage, scheduled ingestion, TTS routing, bot hosting, monitoring, and updates. It should not pretend the core value is generic AI-generated podcast content.

## Status

This repository is mid-pivot.

- The private RSS token model and API exist.
- New podcasts and imports default to private.
- Local storage is the default storage provider.
- The default `npm run dev` path no longer requires Doppler or a production database sync.
- Public social routes, social schema tables, follow/like/comment/fork flows, social counters, and legacy demo harnesses have been removed from the active code path.
- A public open source license still needs to be chosen before release.

## Quick Start

Prerequisites:

- Node.js 18+
- Docker
- FFmpeg

Recommended setup:

```bash
npm run setup
```

`npm run setup` installs dependencies, starts PostgreSQL and Redis, creates `.env.local` with local defaults, pushes the Prisma schema, and generates the Prisma client.

Then add provider credentials to `.env.local`. The smallest hosted-provider path is one OpenAI key:

```bash
OPENAI_API_KEY="sk-..."
AI_PROVIDER="openai"
TTS_PROVIDER="openai"
STT_PROVIDER="openai"
```

For local-agent use, install and authenticate the agent CLI you want to use, then choose its model in the app when available. Claude Code models are exposed when the `claude` CLI is available locally.

Start the app:

```bash
npm run dev
```

Compatibility scripts are still available for the old hosted setup:

```bash
npm run dev:doppler
npm run dev:web:doppler
npm run dev:workers:doppler
```

## Manual Setup

```bash
npm install
cp .env.oss.example .env.local
docker compose up -d postgres redis
npx prisma db push --schema=apps/web/prisma/schema.prisma
npx prisma generate --schema=apps/web/prisma/schema.prisma
npm run dev
```

Use `.env.oss.example` as the local onboarding template. It defaults to:

- PostgreSQL on `localhost:5432`
- Redis on `localhost:6379`
- Local file storage under `.sotto/storage`
- Payments disabled with `PAYMENT_PROVIDER=none`
- Private podcast visibility

## Private RSS

Authenticated users can create private RSS tokens:

```http
POST /api/rss/private
```

The response includes the raw token and feed URL once. Tokens are stored only as SHA-256 hashes.

Manage tokens:

```http
GET /api/rss/private
DELETE /api/rss/private/tokens/:tokenId
```

Podcast apps consume:

```http
GET /api/rss/private/:token
```

That feed includes the user's ready, non-deleted podcasts, including private and unlisted episodes.

## Architecture

The current monorepo contains:

- `apps/web` - Next.js app, API routes, workers, Prisma schema, Vitest tests.
- `apps/mobile` - Expo React Native app.
- `packages/shared` - shared validation and types.
- `packages/mcp` - MCP integration surface.
- `services/remotion` - video rendering service.
- `docs` - architecture, deployment, and product planning documents.

Generation pipeline:

```text
topic, source, meeting, agent output, or bot event
  -> content extraction
  -> script generation
  -> reference validation
  -> TTS
  -> audio stitching
  -> private RSS
```

## Provider Strategy

Sotto should support three onboarding paths:

- Local agent path: use a local CLI or self-hosted agent for script generation, plus a TTS provider.
- One-key path: use a single provider such as OpenAI for script generation, TTS, and transcription.
- Managed path: Sotto-hosted infrastructure with a short trial, then paid hosting for non-technical users.

Provider families already in the codebase include Anthropic, OpenAI, Google, Claude Code, ElevenLabs, Cartesia, Hume, Fal, Replicate, Mistral, S3, R2, and local storage.

## Development Commands

```bash
npm run dev           # web + workers, local defaults
npm run dev:web       # web only
npm run dev:workers   # workers only
npm run build
npm run lint
npm run type-check
npm run test
```

Before merging larger changes, run:

```bash
npm run ci
```

## Release Work Remaining

- Choose and add an open source license.
- Add a first-run onboarding screen for provider selection and private RSS setup.
- Add meeting ingestion and agent webhook endpoints.
- Add a scheduled news briefing source.
- Add a managed-hosting trial path for users who do not want to run infra.
- Finish replacing old pitch-era docs with private-first OSS release docs.
