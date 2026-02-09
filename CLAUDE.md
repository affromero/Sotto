# CLAUDE.md — Sotto

> **Sotto** — Podcasts that listen back. Generate AI podcasts from any topic, interrupt to ask questions, and share knowledge with the world.

## What is Sotto?

Sotto (from "sotto voce" — soft voice in Italian) is an interactive podcast platform where:

1. Users chat with AI to describe what they want to learn → AI generates a 2-voice conversational podcast
2. Users can **interrupt mid-playback** to ask questions → AI answers in context
3. Podcasts can be **updated** with Q&A explanations baked in
4. Public podcasts on a **social feed** — discover, listen, fork, follow creators

## Tech Stack

| Layer     | Technology                                                                              |
| --------- | --------------------------------------------------------------------------------------- |
| Frontend  | Next.js 14+ (App Router), TypeScript, CSS Modules (NO Tailwind)                         |
| Database  | PostgreSQL 16 + Prisma ORM                                                              |
| Auth      | NextAuth.js v5 (email, Google, GitHub, Twitter, Apple Sign In)                          |
| Queue     | Redis 7 + BullMQ (11 worker types)                                                      |
| AI        | Anthropic Claude (discovery chat, script generation, Q&A) — swappable via `AI_PROVIDER` |
| Audio     | ElevenLabs (multi-voice TTS per segment) — swappable via `TTS_PROVIDER`                 |
| Stitching | FFmpeg (segment concatenation + normalization)                                          |
| Storage   | Cloudflare R2 (S3-compatible) — swappable via `STORAGE_PROVIDER`                        |
| Payments  | Stripe (Free $0 / Pro $14 / Creator $29) — swappable via `PAYMENT_PROVIDER`             |
| PDF       | pdfmake (server-side transcript PDF generation)                                         |
| Hosting   | Vercel (web) + Railway (workers)                                                        |

## Build & Development Commands

```bash
# Install dependencies
npm install

# Start PostgreSQL + Redis
docker-compose up -d

# Push database schema
npx prisma db push

# Generate Prisma client
npx prisma generate

# Seed database (optional)
npx prisma db seed

# Development (web + workers concurrently)
npm run dev

# Web only
npm run dev:web

# Workers only
npm run dev:workers

# Linting
npm run lint

# Type checking
npx tsc --noEmit

# Tests
npm run test
npm run test:watch

# Build for production
npm run build
```

## Project Structure

```
src/
├── app/                        # Next.js App Router
│   ├── layout.tsx              # Root layout (DM Serif Display + Inter fonts)
│   ├── page.tsx                # Landing page
│   ├── auth/                   # Login, signup pages
│   ├── (dashboard)/            # Dashboard, billing, settings, analytics, team (auth required)
│   ├── (admin)/                # Admin dashboard: overview, users, podcasts, waitlist, analytics, moderation (ADMIN only)
│   ├── create/                 # Chat-based discovery → generation
│   ├── podcast/[podcastId]/    # Playback + interrupt + fork
│   ├── feed/                   # Public social feed
│   ├── profile/[userId]/       # Public profile + follow
│   ├── pricing/                # Pricing page with SOON badges
│   └── api/                    # API routes
│       ├── auth/[...nextauth]/ # NextAuth handlers
│       ├── podcasts/           # CRUD, generate, interact, fork, like, save
│       ├── discovery/          # Streaming Claude chat + chip suggestions
│       ├── recommendations/    # Search similar podcasts
│       ├── feed/               # Public feed, trending, search
│       ├── users/              # Profile, follow/unfollow, Twitter settings
│       ├── billing/            # Stripe checkout, subscription, portal, usage
│       ├── notifications/      # List, mark read, push registration
│       ├── tags/               # Tag taxonomy
│       ├── keys/               # API key management (CRUD, rotate)
│       ├── teams/              # Team management + invites
│       ├── voices/             # Voice clone + preview
│       ├── analytics/          # Usage analytics
│       ├── admin/              # Admin API (user role, podcast delete, waitlist export) — ADMIN only
│       ├── waitlist/           # Waitlist signup
│       ├── health/             # Health check
│       └── webhooks/stripe/    # Stripe webhook handler
├── components/
│   ├── ui/                     # Button, Input, Card, Modal, Toast, Badge, Chip, Spinner, CitationMarker
│   ├── player/                 # AudioPlayer, Waveform, PlaybackControls, MiniPlayer, TranscriptPanel, ReferenceList, Teleprompter
│   ├── chat/                   # ChatContainer, ChatMessage, ChatChips
│   ├── discovery/              # DiscoveryChat, SuggestionChips, RecommendationCard
│   ├── create/                 # GenerationProgress, ScriptPreview
│   ├── feed/                   # PodcastCard, FeedGrid, TagFilter, SearchBar
│   ├── pricing/                # PricingCard, FeatureList, SoonBadge
│   ├── profile/                # ProfileHeader, PodcastList, FollowButton
│   ├── notifications/          # NotificationBell, NotificationList, PushPrompt
│   ├── settings/               # VoicePreferenceSelector
│   ├── layout/                 # Sidebar, TopBar, Footer, MobileNav
│   └── providers/              # SessionProvider, AudioPlayerProvider, NotificationProvider, EventProvider, PageViewTracker
├── lib/
│   ├── prisma.ts               # Prisma client (PostgreSQL required)
│   ├── redis.ts                # Redis connection + cache helpers
│   ├── queue.ts                # BullMQ queues for all job types
│   ├── auth.ts                 # NextAuth configuration
│   ├── claude.ts               # Anthropic Claude client (streaming + non-streaming)
│   ├── elevenlabs.ts           # ElevenLabs TTS client
│   ├── stripe.ts               # Stripe client + subscription management
│   ├── r2.ts                   # Cloudflare R2 storage client
│   ├── discovery-agent.ts      # Chat-based discovery: Claude streaming + chip generation
│   ├── script-generator.ts     # Claude script generation with [N] citations + revision with feedback
│   ├── script-verifier.ts     # "Teacher" agent: claim extraction, sourcing evaluation, duration check
│   ├── reference-validator.ts  # Source quality filter + 4-layer reference verification
│   ├── script-updater.ts       # Citation cleanup + renumbering after reference removal
│   ├── citation-parser.tsx     # Parse [N] citation markers → React CitationMarker components
│   ├── pdf-generator.ts        # pdfmake academic-style PDF generation
│   ├── providers/              # Modular provider architecture (ai, tts, storage, payment)
│   ├── audio-stitcher.ts       # FFmpeg segment concatenation + normalization
│   ├── content-parser.ts       # URL/PDF content extraction
│   ├── recommendations.ts      # Search similar podcasts, rank by relevance
│   ├── push-notifications.ts   # Web Push API registration + send
│   ├── subscription.ts         # Subscription tier management + limits
│   ├── notifications.ts        # In-app notification helpers
│   ├── validations.ts          # Zod schemas for API validation
│   ├── twitter.ts              # Twitter API v2 client (mentions, replies, OAuth 1.0a)
│   ├── tweet-parser.ts         # Claude-based tweet intent extraction
│   ├── api-keys.ts             # API key generation, hashing, validation
│   └── hooks/                  # React hooks
│       ├── useAuth.ts
│       ├── useAudioPlayer.ts
│       ├── usePodcast.ts
│       ├── useDiscovery.ts
│       └── useNotifications.ts
├── workers/
│   ├── index.ts                         # Worker orchestrator (12 workers)
│   ├── content-extraction.worker.ts
│   ├── script-generation.worker.ts      # Persists References, routes to script verification
│   ├── script-verification.worker.ts    # "Teacher" agent: claim extraction, sourcing check, ≤3 revision loops
│   ├── reference-validation.worker.ts   # Source quality filter + 4-layer verification pipeline
│   ├── audio-generation.worker.ts
│   ├── audio-stitching.worker.ts
│   ├── interaction.worker.ts
│   ├── segment-regeneration.worker.ts
│   ├── notification.worker.ts
│   ├── pdf-generation.worker.ts         # Async PDF generation → R2 upload
│   ├── twitter-mentions.worker.ts       # Poll @sottofm mentions → parse → generate
│   └── twitter-reply.worker.ts          # Reply to tweet when podcast is ready
├── styles/
│   └── globals.css             # Design system tokens + global styles
└── types/
    ├── podcast.ts              # Includes references: ReferenceData[], pdfUrl: string | null
    ├── player.ts
    ├── interaction.ts
    ├── feed.ts
    ├── discovery.ts
    ├── notification.ts
    ├── reference.ts            # ReferenceData type (id, number, title, authors, year, url, type, verificationStatus)
    ├── analytics.ts            # Usage analytics types
    ├── api-key.ts              # API key types
    ├── team.ts                 # Team + invite types
    └── twitter.ts              # TweetParseResult, TwitterTweet, TwitterSettingsData
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
[audio-generation] × N → ElevenLabs TTS per segment (parallel, 5 concurrent)
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
[interaction] → Claude answers using script context + timestamp position
    ↓
"Was that clear?" → Yes → "Update podcast with this?" → Yes
    ↓
[segment-regeneration] → Insert new segments + re-TTS + re-stitch
```

## Database Schema (Key Models)

| Model                | Purpose                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------- |
| `User`               | Auth, profile, bio, avatar, role (USER/CREATOR/ADMIN), usage tracking, Twitter handle + prefs |
| `Follow`             | Social: follower → following                                                                  |
| `Podcast`            | Title, topic, status, audioUrl, pdfUrl, visibility, source (WEB/TWITTER/API), fork tracking   |
| `Discovery`          | Chat metadata (audience, depth, tone, focus, duration)                                        |
| `DiscoveryMessage`   | Individual chat messages (role, content, chips)                                               |
| `Script`             | Structured JSON turns + raw markdown, versioned                                               |
| `Segment`            | Per-speaker audio chunk: text, audioUrl, timing, order                                        |
| `Reference`          | Per-podcast citation: number, title, authors, year, URL, type, verificationStatus             |
| `Interaction`        | Question at timestamp, answer, resolution status                                              |
| `Like` / `Save`      | Social engagement                                                                             |
| `Tag` / `PodcastTag` | Discovery taxonomy                                                                            |
| `Subscription`       | Stripe (FREE/PRO/CREATOR)                                                                     |
| `VoiceClone`         | User voice clones (name, ElevenLabs ID, source type)                                          |
| `ApiKey`             | Developer API keys (hashed, prefix, usage tracking)                                           |
| `Team`               | Team ownership + member management                                                            |
| `TeamInvite`         | Team invite tokens (PENDING/ACCEPTED/EXPIRED/REVOKED)                                         |
| `Job`                | BullMQ job tracking                                                                           |
| `Notification`       | In-app + push notifications                                                                   |
| `PushSubscription`   | Web Push API endpoints                                                                        |
| `TweetMention`       | Twitter mention tracking (dedup, status, reply thread, linked podcast)                        |
| `ApiUsageLog`        | Cost tracking (Claude/ElevenLabs/FFmpeg)                                                      |

**Status Flow**: PENDING → DISCOVERING → EXTRACTING → SCRIPTING → VERIFYING_SCRIPT → VALIDATING_REFERENCES → GENERATING_AUDIO → STITCHING → READY → UPDATING

## Pricing Tiers

| Tier    | Price  | Podcasts | Duration | Interactions   | Premium Credits | Voice Clones | Sound Effects            |
| ------- | ------ | -------- | -------- | -------------- | --------------- | ------------ | ------------------------ |
| Free    | $0     | 2/month  | 10 min   | 2 per podcast  | 0               | 0            | Standard                 |
| Pro     | $14/mo | 8/month  | 10 min   | 10 per podcast | 3               | 2            | Standard                 |
| Creator | $29/mo | 30/month | 10 min   | Unlimited      | 10              | 5            | Premium (ElevenLabs SFX) |

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
// src/app/api/resource/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // ...
}
```

### Worker Pattern

```tsx
// src/workers/example.worker.ts
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
// src/lib/service.ts
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

## Environment Variables

See `.env.example` for all required/optional variables. Critical ones:

- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string
- `NEXTAUTH_SECRET` — Auth encryption key
- `ANTHROPIC_API_KEY` — Claude API key
- `ELEVENLABS_API_KEY` — ElevenLabs TTS API key
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` — Payments
- `R2_*` — Cloudflare R2 storage credentials

Twitter integration (optional):

- `TWITTER_BEARER_TOKEN` — Twitter API v2 read access
- `TWITTER_API_KEY` / `TWITTER_API_SECRET` — OAuth 1.0a for @sottofm bot
- `TWITTER_ACCESS_TOKEN` / `TWITTER_ACCESS_SECRET` — @sottofm bot access
- `TWITTER_SOTTO_USER_ID` — Numeric user ID for @sottofm
- `TWITTER_CLIENT_ID` / `TWITTER_CLIENT_SECRET` — Twitter OAuth for user login

Provider selection (swap services via env):

- `AI_PROVIDER` — `anthropic` (default) | `openai`
- `TTS_PROVIDER` — `elevenlabs` (default) | `openai`
- `STORAGE_PROVIDER` — `r2` (default) | `s3` | `local`
- `PAYMENT_PROVIDER` — `stripe` (default) | `none`

## Reference

Full product plan, market analysis, competitive landscape, and implementation phases: `docs/00-plan.md`
