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
| Auth      | NextAuth.js v5 (email, Google, GitHub, Twitter, Apple Sign In)                                           |
| Queue     | Redis 7 + BullMQ (13 worker types)                                                                       |
| AI        | Anthropic Claude (discovery chat, script generation, Q&A) — swappable via `AI_PROVIDER`                  |
| Audio     | ElevenLabs, OpenAI, PlayHT, Cartesia, Hume (multi-provider TTS) — resolved via resolveTtsProvider()      |
| Stitching | FFmpeg (segment concatenation + normalization)                                                           |
| Storage   | Cloudflare R2 (S3-compatible) — swappable via `STORAGE_PROVIDER`                                         |
| BYOK      | Users bring own LLM keys (Anthropic/OpenAI) + TTS keys (5 providers) — all features free                |
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
│   │   │   ├── components/     # UI components (CSS Modules)
│   │   │   ├── lib/            # Core libraries + external service clients
│   │   │   ├── workers/        # BullMQ workers (13 types)
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
│   └── shared/                 # Shared package (@sotto/shared)
│       └── src/
│           ├── types/          # String union enums, interfaces (Prisma-free)
│           ├── validations.ts  # Shared Zod schemas
│           ├── theme.ts        # Design tokens (colors, spacing, typography)
│           └── index.ts        # Barrel export
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

```
src/
├── app/                        # Next.js App Router
│   ├── layout.tsx              # Root layout (DM Serif Display + Inter fonts)
│   ├── page.tsx                # Landing page
│   ├── auth/                   # Login, signup pages
│   ├── (dashboard)/            # Dashboard, billing, settings, analytics, team (auth required)
│   ├── (admin)/                # Admin dashboard (ADMIN only)
│   ├── create/                 # Chat-based discovery → generation
│   ├── podcast/[podcastId]/    # Playback + interrupt + fork
│   ├── feed/                   # Public social feed
│   ├── profile/[userId]/       # Public profile + follow
│   ├── collections/            # Collection detail pages
│   └── api/                    # API routes
│       ├── auth/[...nextauth]/ # NextAuth handlers
│       ├── podcasts/           # CRUD, generate, interact, fork, like, save
│       ├── discovery/          # Streaming Claude chat + chip suggestions
│       ├── feed/               # Public feed, trending, search
│       ├── users/              # Profile, follow/unfollow, Twitter settings
│       ├── billing/            # Usage stats, BYOK key status
│       ├── activity/           # Social activity feed
│       ├── collections/        # Collection CRUD, items, follow
│       ├── notifications/      # List, mark read, push registration
│       └── admin/              # Admin API — ADMIN only
├── components/
│   ├── ui/                     # Button, Input, Card, Modal, Toast, Badge, Chip, Spinner
│   ├── player/                 # AudioPlayer, MiniPlayer, TranscriptPanel, InterruptChatPanel, CommunityQuestions, CommentSection
│   ├── chat/                   # ChatContainer, ChatMessage, ChatChips
│   ├── discovery/              # DiscoveryChat, SuggestionChips, RecommendationCard
│   ├── feed/                   # PodcastCard, FeedGrid, TagFilter, SearchBar, ActivityFeed, ActivityItem
│   ├── profile/                # ProfileHeader, PodcastList, FollowButton, UserCard, FollowListModal
│   ├── collections/            # CollectionCard, AddToCollectionModal, CollectionDetail
│   ├── layout/                 # Sidebar, TopBar, Footer, MobileNav
│   └── providers/              # SessionProvider, AudioPlayerProvider, NotificationProvider
├── lib/
│   ├── prisma.ts               # Database client
│   ├── redis.ts                # Redis connection + cache helpers
│   ├── queue.ts                # BullMQ job queues
│   ├── auth.ts                 # NextAuth configuration
│   ├── claude.ts               # Anthropic Claude client
│   ├── byok.ts                 # BYOK key management (AI + TTS, AES-256-GCM encrypted)
│   ├── validations.ts          # Zod schemas (web-only; shared schemas in @sotto/shared)
│   ├── providers/              # Modular provider architecture (ai, tts, stt, storage)
│   └── hooks/                  # React hooks (useAuth, useAudioPlayer, usePodcast, etc.)
├── workers/
│   ├── index.ts                # Worker orchestrator (13 workers)
│   ├── script-generation.worker.ts
│   ├── audio-generation.worker.ts
│   ├── audio-stitching.worker.ts
│   └── ...                     # See apps/web/src/workers/CLAUDE.md for full list
├── styles/
│   └── globals.css             # Design system tokens + global styles
└── types/                      # Re-exports from @sotto/shared (+ Prisma-dependent types)
    ├── podcast.ts              # Uses Prisma enums (PodcastStatus, Speaker, etc.)
    ├── reference.ts            # Uses Prisma enums (ReferenceType, VerificationStatus)
    ├── twitter.ts              # Uses Prisma enums (TweetMentionStatus)
    ├── next-auth.d.ts          # NextAuth module augmentation (UserRole)
    └── *.ts                    # All others re-export from @sotto/shared
```

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
[audio-generation] × N → TTS per segment (multi-provider: ElevenLabs, OpenAI, PlayHT, Cartesia, Hume) (parallel, 5 concurrent)
    ↓
[audio-stitching] → FFmpeg concat + normalize + duration hard check → final.mp3
    ↓
[notification] → Push notification: "Your podcast is ready!"
    ↓ (if source=TWITTER)
[twitter-reply] → Reply to original tweet with podcast link
```

### Twitter @sottofm Integration

```
User tweets: "@sottofm make a podcast about quantum computing"
    ↓
[twitter-mentions] polls every 60s → lookup user → parse intent via Claude
    ↓
Creates Podcast (source: TWITTER) → kicks off pipeline above
    ↓
[twitter-reply] posts reply: "Your podcast is ready! Listen: sotto.fm/podcast/xyz"
```

### Interactive Playback

```
User listening → taps "Ask a Question" → podcast pauses
    ↓
[interaction] → Claude answers using segment-based timestamp lookup
    ↓
"Was that clear?" → Yes → "Update podcast with this?" → Yes
    ↓
POST /api/podcasts/[id]/interact/[interactionId]/incorporate
    ↓
Claude generates natural HOST segment addressing Q&A
    ↓
[segment-regeneration] → TTS (matching podcast voice config) → transactional insert → queue re-stitch
    ↓
[audio-stitching] (skipSfx) → re-concat + update startTimes → READY
```

## Database Schema (Key Models)

| Model                   | Purpose                                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `User`                  | Auth, profile, bio, avatar, role (USER/CREATOR/ADMIN), Twitter handle + prefs                                                                                                                            |
| `Follow`                | Social: follower → following                                                                                                                                                                                             |
| `Podcast`               | Title, topic, status, audioUrl, pdfUrl, visibility, source (WEB/TWITTER/API), fork tracking, import fields (importedAudioKey, isHumanContent), versioning (currentVersion), fork fields (remixNote), commentCount |
| `Discovery`             | Chat metadata (audience, depth, tone, focus, duration)                                                                                                                                                                   |
| `DiscoveryMessage`      | Individual chat messages (role, content, chips)                                                                                                                                                                          |
| `Script`                | Structured JSON turns + raw markdown, versioned                                                                                                                                                                          |
| `Segment`               | Per-speaker audio chunk: text, audioUrl, timing, order                                                                                                                                                                   |
| `Reference`             | Per-podcast citation: number, title, authors, year, URL, type, verificationStatus                                                                                                                                        |
| `Interaction`           | Question at timestamp, answer, resolution status, helpful feedback, segment mapping, visibility (PUBLIC/PRIVATE), upvoteCount                                                                                            |
| `InteractionVote`       | Upvote tracking for public Q&A                                                                                                                                                                                           |
| `Comment`               | Threaded comments on podcasts (parentId self-ref, optional timestamp pin, denormalized replyCount)                                                                                                                       |
| `Like` / `Save`         | Social engagement                                                                                                                                                                                                        |
| `Tag` / `PodcastTag`    | Discovery taxonomy                                                                                                                                                                                                       |
| `Collection`            | Curated podcast playlists (name, description, isPublic, denormalized counts)                                                                                                                                             |
| `CollectionItem`        | Podcast membership in a collection (with ordering)                                                                                                                                                                       |
| `CollectionFollow`      | Users following collections                                                                                                                                                                                              |
| `Activity`              | Social activity feed events (PODCAST_CREATED, FORKED, LIKED, USER_FOLLOWED, COMMENT_POSTED, COLLECTION_CREATED)                                                                                                         |
| `VoiceClone`            | User voice clones (name, ElevenLabs ID, source type)                                                                                                                                                                     |
| `VoiceAllowlist`        | Pre-approved voice access: voice clone → allowed user                                                                                                                                                                    |
| `UserTtsKey`            | BYOK encrypted API keys per TTS provider (AES-256-GCM), `@@unique([userId, provider])`                                                                                                                                   |
| `UserAiKey`             | BYOK encrypted API keys per AI provider (Anthropic/OpenAI), `@@unique([userId, provider])`                                                                                                                               |
| `PodcastVersion`        | Version snapshots (immutable segments, stitched audio per version)                                                                                                                                                       |
| `PodcastVersionSegment` | Segment ordering per version                                                                                                                                                                                             |
| `ApiKey`                | Developer API keys (hashed, prefix, usage tracking)                                                                                                                                                                      |
| `Team`                  | Team ownership + member management                                                                                                                                                                                       |
| `TeamInvite`            | Team invite tokens (PENDING/ACCEPTED/EXPIRED/REVOKED)                                                                                                                                                                    |
| `Job`                   | BullMQ job tracking                                                                                                                                                                                                      |
| `Notification`          | In-app + push notifications                                                                                                                                                                                              |
| `PushSubscription`      | Web Push API endpoints                                                                                                                                                                                                   |
| `TweetMention`          | Twitter mention tracking (dedup, status, reply thread, linked podcast)                                                                                                                                                   |
| `ApiUsageLog`           | Cost tracking (Claude/ElevenLabs/FFmpeg)                                                                                                                                                                                 |

**Status Flow**: PENDING → DISCOVERING → EXTRACTING → SCRIPTING → VERIFYING_SCRIPT → VALIDATING_REFERENCES → GENERATING_AUDIO → STITCHING → READY → UPDATING | IMPORTING → TRANSCRIBING → READY

## Pricing Model: Free + BYOK

**100% free. No tiers, no credits, no Stripe.** Users bring their own API keys (BYOK) for both LLM and TTS providers.

| Requirement | Details |
|-------------|---------|
| AI key      | Anthropic or OpenAI — required for generation, Q&A, discovery chat |
| TTS key     | ElevenLabs, OpenAI, PlayHT, Cartesia, or Hume — required for audio generation |
| All features | Unlimited — voice clones, downloads, private podcasts, collections, everything |

**Rate limits** (abuse prevention): 20 generations/hour, 100/day per user. 60 interactions/hour.

**Dev mode**: When `AI_PROVIDER=claude-code`, the Claude CLI is used instead of an API key. Platform-level TTS keys also satisfy the TTS requirement. This means developers can run the full pipeline locally without any BYOK keys.

## Engineering Standards

### Component Pattern (CSS Modules, NO Tailwind)

```tsx
// ComponentName.tsx
import styles from './ComponentName.module.css';

interface ComponentNameProps {
  variant?: 'primary' | 'secondary';
  children: React.ReactNode;
}

export function ComponentName({ variant = 'primary', children }: ComponentNameProps) {
  return <div className={`${styles.root} ${styles[variant]}`}>{children}</div>;
}
```

### API Route Pattern

```tsx
// apps/web/src/app/api/resource/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // ...
}
```

### Worker Pattern

```tsx
// apps/web/src/workers/example.worker.ts
import { Job } from 'bullmq';

export async function processJob(job: Job) {
  const { podcastId } = job.data;
  await job.updateProgress(10);
  // Process...
  await job.updateProgress(100);
  return { success: true };
}
```

### Lib Pattern

```tsx
// apps/web/src/lib/service.ts
// External service client with retry logic and error handling
import { env } from './env';

class ServiceClient {
  private client: ExternalSDK;

  constructor() {
    this.client = new ExternalSDK({ apiKey: env.SERVICE_API_KEY });
  }

  async operation(params: OperationParams): Promise<OperationResult> {
    // Retry logic, error handling, logging
  }
}

export const serviceClient = new ServiceClient();
```

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

## Testing & CI

- **Always run `npm run ci` before committing** — this runs lint, type-check, tests, and build (mirrors the GitHub Actions CI pipeline). Fix all failures before staging and committing.
- When tsc or lint reports multiple errors, collect the FULL error list before fixing anything — then fix all in a single pass
- If pre-commit hooks fail on files unrelated to your change, use `git commit --no-verify` on the second attempt
- After any Prisma schema change, run `npx prisma generate --schema=apps/web/prisma/schema.prisma` before type-checking
- When CI fails, read the full log — don't guess which test broke

## Environment Variables

See `.env.example` for all required/optional variables. Critical ones:

- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string
- `NEXTAUTH_SECRET` — Auth encryption key
- `ANTHROPIC_API_KEY` — Claude API key
- `ELEVENLABS_API_KEY` — ElevenLabs TTS API key (platform default)
- `R2_*` — Cloudflare R2 storage credentials
- `BYOK_ENCRYPTION_KEY` — AES-256-GCM key for encrypting user API keys (AI + TTS)

Apple Sign In (optional):

- `APPLE_CLIENT_ID` / `APPLE_CLIENT_SECRET` — Apple OAuth credentials

Twitter integration (optional):

- `TWITTER_BEARER_TOKEN` — Twitter API v2 read access
- `TWITTER_API_KEY` / `TWITTER_API_SECRET` — OAuth 1.0a for @sottofm bot
- `TWITTER_ACCESS_TOKEN` / `TWITTER_ACCESS_SECRET` — @sottofm bot access
- `TWITTER_SOTTO_USER_ID` — Numeric user ID for @sottofm
- `TWITTER_CLIENT_ID` / `TWITTER_CLIENT_SECRET` — Twitter OAuth for user login

Provider selection (swap services via env):

- `AI_PROVIDER` — `anthropic` (default) | `openai` | `claude-code` (dev only)
- `TTS_PROVIDER` — `elevenlabs` (default) | `openai`
- `STT_PROVIDER` — `openai` (default) | `elevenlabs`
- `STORAGE_PROVIDER` — `r2` (default) | `s3` | `local`

## Reference

Full product plan, market analysis, competitive landscape, and implementation phases: `docs/00-plan.md`
