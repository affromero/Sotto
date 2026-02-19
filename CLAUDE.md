# CLAUDE.md — Sotto

> **Sotto** — The Open Podcast Network. Generate AI podcasts from any topic, interrupt to ask questions, fork & remix, import existing content, and share knowledge with the world.

## What is Sotto?

Sotto (from "sotto voce" — soft voice in Italian) is the open podcast network where:

1. Users chat with AI to describe what they want to learn → AI generates a 2-voice conversational podcast
2. Users can **interrupt mid-playback** to ask questions → AI answers in context
3. Podcasts can be **updated** with Q&A explanations baked in
4. **Fork any podcast** — remix with your own angle, build on others' work
5. **Import any podcast** — human or AI-made — and add social features on top
6. Public podcasts on a **social feed** — discover, listen, fork, follow creators

## Tech Stack

| Layer     | Technology                                                                                               |
| --------- | -------------------------------------------------------------------------------------------------------- |
| Frontend  | Next.js 14+ (App Router), TypeScript, CSS Modules (NO Tailwind)                                          |
| Database  | PostgreSQL 16 + Prisma ORM                                                                               |
| Auth      | NextAuth.js v5 (Google, GitHub, Apple Sign In; Twitter for account linking only)                         |
| Queue     | Redis 7 + BullMQ (25 worker types)                                                                       |
| AI        | Anthropic Claude (discovery chat, script generation, Q&A) — swappable via `AI_PROVIDER`                  |
| Audio     | ElevenLabs, OpenAI, PlayHT, Cartesia, Hume, Fal, Replicate (multi-provider TTS) — resolved via resolveTtsProvider() |
| Stitching | FFmpeg (segment concatenation + normalization)                                                           |
| Storage   | Cloudflare R2 (S3-compatible) — swappable via `STORAGE_PROVIDER`                                         |
| BYOK      | Users bring own LLM keys (Anthropic/OpenAI) + TTS keys (7 providers) — all features free                |
| Email     | Resend (transactional email: waitlist welcome, weekly digest)                                             |
| PDF       | pdfmake (server-side transcript PDF generation)                                                          |
| Hosting   | Hetzner VPS (Docker Compose + Caddy), deployed via GitHub Actions SSH                                    |

## Monorepo Structure

npm workspaces monorepo with two apps and one shared package:

| Workspace | Path | Description |
|-----------|------|-------------|
| `@sotto/web` | `apps/web/` | Next.js web app (App Router, Prisma, BullMQ workers) |
| `@sotto/mobile` | `apps/mobile/` | React Native + Expo iOS app |
| `@sotto/shared` | `packages/shared/` | Shared types, Zod validations, design tokens |

Root `package.json` is a workspace orchestrator — all scripts proxy to `@sotto/web`.
`tsconfig.base.json` at root holds shared compiler options; each app extends it.

## Build & Development Commands

```bash
# Install dependencies (all workspaces)
npm install

# Start PostgreSQL + Redis
docker-compose up -d

# Push database schema
npx prisma db push --schema=apps/web/prisma/schema.prisma

# Generate Prisma client
npx prisma generate --schema=apps/web/prisma/schema.prisma

# Development (web + workers concurrently)
npm run dev

# Web only
npm run dev:web

# Workers only
npm run dev:workers

# Linting
npm run lint

# Type checking
npm run type-check

# Tests
npm run test
npm run test:watch

# Build for production
npm run build

# Full CI pipeline (lint + type-check + test + build)
npm run ci
```

## Project Structure

```
Sotto/
├── apps/
│   ├── web/                    # Next.js web app (@sotto/web)
│   │   ├── src/
│   │   │   ├── app/            # Next.js App Router (pages + API routes)
│   │   │   ├── assets/          # Static assets (SFX audio files)
│   │   │   ├── components/     # UI components (CSS Modules)
│   │   │   ├── lib/            # Core libraries + external service clients
│   │   │   ├── workers/        # BullMQ workers (24 types)
│   │   │   ├── styles/         # globals.css (design system tokens)
│   │   │   └── types/          # TypeScript types (re-exports from @sotto/shared)
│   │   ├── prisma/             # Prisma schema + seeds
│   │   ├── public/             # Static assets
│   │   ├── tests/              # Vitest test suites
│   │   ├── package.json
│   │   ├── tsconfig.json       # extends ../../tsconfig.base.json, keeps @/* → ./src/*
│   │   ├── next.config.js
│   │   ├── vitest.config.ts
│   │   ├── eslint.config.mjs
│   │   ├── Dockerfile
│   │   └── Dockerfile.workers
│   └── mobile/                 # React Native + Expo iOS app (@sotto/mobile)
│       ├── app/                # expo-router screens
│       ├── components/         # RN components
│       ├── lib/                # API client, auth, audio player
│       ├── assets/             # Icons, splash screen
│       ├── package.json
│       ├── tsconfig.json
│       ├── app.json
│       └── eas.json
├── packages/
│   └── shared/                 # Shared package (@sotto/shared) — see packages/shared/CLAUDE.md
│       └── src/                # Types (15 files), Zod schemas, design tokens, content badges
├── scripts/                    # Setup, deploy, pitch rebuild scripts
├── docs/                       # Product docs, architecture, guides
├── .github/                    # CI/CD workflows
├── package.json                # Root workspace orchestrator
├── tsconfig.base.json          # Shared TypeScript compiler options
├── docker-compose.yml          # Dev: PostgreSQL + Redis
├── docker-compose.prod.yml     # Prod: web + workers + postgres + redis
├── Caddyfile                   # Reverse proxy config
└── .prettierrc                 # Shared formatter config
```

### Web App Detail (`apps/web/src/`)

Each subdirectory has its own `CLAUDE.md` with full file listings:

| Directory | CLAUDE.md | What's documented |
|-----------|-----------|-------------------|
| `app/` | `src/app/CLAUDE.md` | All pages + 38 API route groups |
| `components/` | `src/components/CLAUDE.md` | 15 component directories |
| `lib/` | `src/lib/CLAUDE.md` | 40+ lib files, 7 hooks, providers |
| `workers/` | `src/workers/CLAUDE.md` | 25 workers, pipeline flow |
| `types/` | `src/types/CLAUDE.md` | Type re-exports from @sotto/shared |
| `styles/` | `src/styles/CLAUDE.md` | Design system tokens |
| `prisma/` | `prisma/CLAUDE.md` | 58 Prisma models |

## Design System: "Warm Intimacy"

| Token          | Value                    | Usage                             |
| -------------- | ------------------------ | --------------------------------- |
| Primary        | `#D97706` (Golden Amber) | CTAs, Host speaker, highlights    |
| Accent         | `#1E3A5F` (Deep Navy)    | Expert speaker, secondary actions |
| Background     | `#FEFCF8` (Soft Cream)   | Page background                   |
| Surface        | `#FFFFFF`                | Cards, panels                     |
| Text Primary   | `#1A1A1A`                | Headings, body                    |
| Text Secondary | `#6B7280`                | Captions, metadata                |
| Heading Font   | DM Serif Display         | Editorial warmth                  |
| Body Font      | Inter                    | Clean readability                 |

**Speaker Colors**: Host = amber (`#D97706`), Expert = navy (`#1E3A5F`)

## Core User Flow

### Chat-Based Discovery (NOT forms)

User opens "Create Podcast" → chats with AI agent → AI asks conversational questions with tappable chip suggestions:

- Topic, depth, audience background, focus area, tone, duration
- AI extracts structured metadata: `{topic, depth, audience, tone, focus, duration}`
- Before generating, searches existing public podcasts → shows recommendations
- User can follow creators, explore, or say "Create mine"

### Generation Pipeline (Workers)

```
[content-extraction] → Parse URL/PDF if provided
    ↓
[script-generation] → Claude generates 2-voice script
    ↓
[script-verification] → "Teacher" agent: claim extraction + sourcing check (≤3 revision loops)
    ↓
[reference-validation] → Source quality filter + 4-layer verification (URL, CrossRef, OpenAlex, AI)
    ↓
[SCRIPT_READY pause] → User reviews/edits script (WEB/IMPORT only; auto-approve for TWITTER/TELEGRAM/API)
    ↓
[audio-generation] × N → TTS per segment (multi-provider: ElevenLabs, OpenAI, PlayHT, Cartesia, Hume, Fal, Replicate) (parallel, 5 concurrent)
    ↓
[audio-stitching] → FFmpeg concat + normalize + duration hard check → final.mp3
    ↓
[notification] → Push notification: "Your podcast is ready!"
    ↓ (if source=TWITTER)
[twitter-reply] → Reply to original tweet with podcast link
    ↓ (if source=TELEGRAM)
[telegram-reply] → Reply in Telegram chat with podcast link
```

### Bot Integrations (Twitter + Telegram)

Both bots poll for mentions → parse intent via Claude → create Podcast (source: TWITTER/TELEGRAM) → pipeline → reply with link. See `docs/25-twitter-integration.md` and `docs/26-telegram-integration.md`.

### Interactive Playback

User taps "Ask a Question" → podcast pauses → Claude answers using segment-based timestamp → user can incorporate answer into podcast → `segment-regeneration` worker creates new HOST segment → `audio-stitching` re-concats.

## Database Schema (58 models)

Core models — see `apps/web/prisma/CLAUDE.md` for the full breakdown:

| Model | Purpose |
|-------|---------|
| `User` | Auth, profile, role (USER/CREATOR/ADMIN), Stripe Connect |
| `Podcast` | Core content: status, source (WEB/TWITTER/TELEGRAM/API/IMPORT), forking, versioning |
| `Discovery` / `DiscoveryMessage` | Chat-based podcast creation flow |
| `Script` / `Segment` / `Reference` | Script (JSON turns), audio chunks, citations |
| `Interaction` / `InteractionVote` | Mid-playback Q&A + voting |
| `VoiceClone` / `VoicePurchase` | Voice marketplace (Stripe Connect, 10% fee) |
| `UserTtsKey` / `UserAiKey` | BYOK encrypted keys (AES-256-GCM) |
| `FreeTierConfig` | Admin-configurable platform defaults |
| `Collection` / `CollectionItem` | Curated playlists |
| `Activity` / `Follow` / `Like` / `Save` / `Comment` | Social graph + engagement |
| `TweetMention` / `TelegramMessage` | Bot integration tracking |
| `BehavioralEvent` / `UserFeature` / `PodcastFeature` | ML recommendation pipeline |

**Status Flow**: PENDING → DISCOVERING → EXTRACTING → SCRIPTING → VERIFYING_SCRIPT → VALIDATING_REFERENCES → SCRIPT_READY → GENERATING_AUDIO → STITCHING → READY | IMPORTING → TRANSCRIBING → READY

## Pricing Model: Free + BYOK + Voice Marketplace

**Generation is free.** Users bring their own API keys (BYOK) for both LLM and TTS providers. **Voice marketplace** adds optional per-podcast pricing via Stripe Connect.

| Requirement | Details |
|-------------|---------|
| AI key      | Anthropic or OpenAI — required for generation, Q&A, discovery chat |
| TTS key     | ElevenLabs, OpenAI, PlayHT, Cartesia, or Hume — required for audio generation |
| All features | Unlimited — voice clones, downloads, private podcasts, collections, everything |

**Voice Marketplace Pricing**: Voice owners connect Stripe and set a per-podcast price (or keep voices free). Buyers pay once per podcast. Payment is authorized upfront, captured on READY, cancelled on FAILED. Platform takes 10% via `application_fee_amount`. Free access paths: owner, allowlisted, approved VoiceRequest, or existing purchase.

**Rate limits** (abuse prevention): 20 generations/hour, 100/day per user. 60 interactions/hour.

**Dev mode**: When `AI_PROVIDER=claude-code`, the Claude CLI is used instead of an API key. Platform-level TTS keys also satisfy the TTS requirement. This means developers can run the full pipeline locally without any BYOK keys.

## Engineering Patterns

- **Component**: `ComponentName.tsx` + `ComponentName.module.css`. Typed props interface, named export, `styles.root` + `styles[variant]`.
- **API Route**: `auth()` guard → Zod validate → Prisma query → `NextResponse.json()`. Always return proper HTTP status codes.
- **Worker**: `export async function processJob(job: Job)` → `job.updateProgress()` → return result. See `src/workers/CLAUDE.md`.
- **Lib**: Class-based client with singleton export, retry logic, error handling.

## Key Rules

1. **CSS Modules only** — NO Tailwind, NO inline styles, NO styled-components
2. **TypeScript strict mode** — no `any`, proper typing everywhere
3. **Server Components by default** — only `'use client'` when needed (hooks, events, browser APIs)
4. **Validate at boundaries** — Zod schemas for all API inputs
5. **Error handling** — never swallow errors, always return proper HTTP status codes
6. **Auth middleware** — protect all dashboard/API routes via middleware.ts
7. **BullMQ for async work** — never do heavy processing in API routes
8. **Separate Redis connections** — each BullMQ worker needs its own connection
9. **Mobile-first CSS** — design for phone first, then scale up
10. **Accessibility** — proper ARIA labels, keyboard navigation, semantic HTML
11. **NO placeholders or TODOs in code** — every file must be fully implemented. No `// TODO`, no `// placeholder`, no stub functions, no commented-out future work. If a feature isn't ready, don't add the file at all. Ship complete code or ship nothing.
12. **Voice diversity is mandatory** — every podcast must sound unique. Use the voice pool system in `elevenlabs.ts` to assign distinct voice pairs per podcast. Never reuse the same 2 voices for every podcast.
13. **Fix all errors in one pass** — when running tsc or lint, collect ALL errors first, then fix them in a single pass — don't fix one, re-run, fix another, repeat
14. **No `console.log` in committed code** — unless it's intentional logging (use proper logger)
15. **Prefer small, modular files** — avoid monolithic files. Split large components, utilities, and routes into focused modules. A 200-line file is better than a 1000-line file with 5 responsibilities.
16. **Update `.env.example` when adding env vars** — every new environment variable added to `.env` must also be added (commented out with placeholder) to `.env.example` so other developers and deployments stay in sync.

## Frontend Quality Checklist

Before declaring any UI work done, verify:

**Interaction**

- Touch targets are at least 44x44px on mobile
- No swipe/scroll conflicts between overlapping gesture areas (e.g., carousels inside scrollable pages)
- Keyboard navigation works: Tab order is logical, Enter/Space activate controls, Escape closes modals
- Focus states are visible on all interactive elements

**Animation**

- All animations respect `prefers-reduced-motion: reduce` (disable or simplify)
- Only animate `transform` and `opacity` — never animate `width`, `height`, `top`, `left`, or `margin`
- Check for timing conflicts when multiple animations run simultaneously (e.g., page transition + component mount)

**Layout**

- Test at 375px width minimum (iPhone SE) — no horizontal overflow
- Verify no content is hidden behind the MiniPlayer when it's visible (add bottom padding/margin)
- Scrollable containers have `-webkit-overflow-scrolling: touch` on iOS

**Browser & CSP**

- No inline styles (use CSS Modules) — inline styles break Content Security Policy
- No `eval()` or `new Function()` — breaks CSP
- Images use `next/image` for optimization and lazy loading

## Commit Checklist

Every commit **must** pass this checklist. Do not commit until every item is verified.

- [ ] `npm run lint` — no errors (warnings OK)
- [ ] `npm run type-check` — clean pass
- [ ] `npm run test` — all tests pass (no new failures; pre-existing failures in unrelated files are acceptable but must not increase)
- [ ] `npm run build` — successful production build
- [ ] No `console.log` or debug statements in staged files
- [ ] No secrets or `.env` values in staged files
- [ ] `git diff --cached` reviewed — only intended changes are staged

Run `npm run ci` to execute lint, type-check, test, and build in sequence.

### Additional rules

- When tsc or lint reports multiple errors, collect the FULL error list before fixing anything — then fix all in a single pass
- If pre-commit hooks fail on files unrelated to your change, use `git commit --no-verify` on the second attempt
- After any Prisma schema change, run `npx prisma generate --schema=apps/web/prisma/schema.prisma` before type-checking
- When CI fails, read the full log — don't guess which test broke

## Environment Variables

See `.env.example` for the full list. Critical:

- `DATABASE_URL`, `REDIS_URL` — PostgreSQL + Redis
- `NEXTAUTH_SECRET` — Auth encryption
- `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY` — Platform default AI + TTS keys
- `R2_*` — Cloudflare R2 storage
- `BYOK_ENCRYPTION_KEY` — AES-256-GCM for user API key encryption

Provider selection (swap via env): `AI_PROVIDER` (`anthropic`/`openai`/`claude-code`), `TTS_PROVIDER`, `STT_PROVIDER`, `STORAGE_PROVIDER`, `PAYMENT_PROVIDER` — see `.env.example` for all options.

## Reference

Full product plan, market analysis, competitive landscape, and implementation phases: `docs/00-plan.md`
