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
| Payments  | Stripe (Free $0 / Starter $14 / Pro $34 / Studio $69 / Power $9 BYOK) — swappable via `PAYMENT_PROVIDER` |
| PDF       | pdfmake (server-side transcript PDF generation)                                                          |
| Hosting   | Vercel (web) + Railway (workers)                                                                         |

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
│   ├── ui/                     # Button, Input, Card, Modal, Toast, Badge, Chip, Spinner, CitationMarker, TtsProviderLogo
│   ├── player/                 # AudioPlayer, Waveform, PlaybackControls, MiniPlayer, TranscriptPanel, ReferenceList, Teleprompter, VersionHistory, ForkAttribution, ForkLineage, ForkRemixModal, ForkGraph, ListeningQueue, InterruptChatPanel, SegmentQuestionBadge, ShareMenu, EmbedCodeModal, EmbedPlayer
│   ├── chat/                   # ChatContainer, ChatMessage, ChatChips
│   ├── discovery/              # DiscoveryChat, SuggestionChips, RecommendationCard
│   ├── create/                 # GenerationProgress, ScriptPreview, TtsProviderSelector
│   ├── import/                 # ImportUploader, ImportProgress
│   ├── feed/                   # PodcastCard, FeedGrid, TagFilter, SearchBar
│   ├── pricing/                # PricingCard, FeatureList, TierComparison
│   ├── billing/                # CreditPackCard
│   ├── profile/                # ProfileHeader, PodcastList, FollowButton
│   ├── notifications/          # NotificationBell, NotificationList, PushPrompt
│   ├── settings/               # VoicePreferenceSelector, TtsProviderCards — Voice preferences + TTS provider BYOK key management
│   ├── layout/                 # Sidebar, TopBar, Footer, MobileNav
│   └── providers/              # SessionProvider, AudioPlayerProvider, NotificationProvider, EventProvider, PageViewTracker
├── lib/
│   ├── prisma.ts               # Prisma client (PostgreSQL required)
│   ├── redis.ts                # Redis connection + cache helpers
│   ├── queue.ts                # BullMQ queues for all job types
│   ├── auth.ts                 # NextAuth configuration
│   ├── claude.ts               # Anthropic Claude client (streaming + non-streaming)
│   ├── elevenlabs.ts           # ElevenLabs TTS client
│   ├── stripe.ts               # Stripe client + tier limits + canGenerate/canInteract
│   ├── credits.ts              # Credit operations (consume, refund, grant, purchase)
│   ├── r2.ts                   # Cloudflare R2 storage client
│   ├── discovery-agent.ts      # Chat-based discovery: Claude streaming + chip generation
│   ├── script-generator.ts     # Claude script generation with [N] citations + revision with feedback
│   ├── script-verifier.ts     # "Teacher" agent: claim extraction, sourcing evaluation, duration check
│   ├── reference-validator.ts  # Source quality filter + 4-layer reference verification
│   ├── script-updater.ts       # Citation cleanup + renumbering after reference removal
│   ├── citation-parser.tsx     # Parse [N] citation markers → React CitationMarker components
│   ├── pdf-generator.ts        # pdfmake academic-style PDF generation
│   ├── voice-pool.ts           # Unified voice pool with per-provider IDs
│   ├── cost-monitor.ts         # Provider cost tracking + budget warnings
│   ├── transcript-parser.ts    # Parse SRT/VTT/JSON transcripts → Segment[] for imports
│   ├── providers/              # Modular provider architecture (ai, tts, stt, storage, payment)
│   │   ├── stt.ts              # Speech-to-text provider interface
│   │   ├── tts-registry.ts     # Provider capability metadata (quality, cost, auth)
│   │   └── tts/                # Per-provider TTS implementations
│   │       ├── elevenlabs.provider.ts
│   │       ├── openai.provider.ts
│   │       ├── playht.provider.ts
│   │       ├── cartesia.provider.ts
│   │       └── hume.provider.ts
│   ├── audio-stitcher.ts       # FFmpeg segment concatenation + normalization
│   ├── content-parser.ts       # URL/PDF content extraction
│   ├── recommendations.ts      # Search similar podcasts, rank by relevance
│   ├── push-notifications.ts   # Web Push API registration + send
│   ├── subscription.ts         # Subscription tier management + credit balance queries
│   ├── notifications.ts        # In-app notification helpers
│   ├── validations.ts          # Zod schemas for API validation
│   ├── twitter.ts              # Twitter API v2 client (mentions, replies, OAuth 1.0a)
│   ├── tweet-parser.ts         # Claude-based tweet intent extraction
│   ├── api-keys.ts             # API key generation, hashing, validation
│   ├── rss.ts                  # RSS 2.0 feed generation with iTunes namespace
│   └── hooks/                  # React hooks
│       ├── useAuth.ts
│       ├── useAudioPlayer.ts
│       ├── usePodcast.ts
│       ├── useDiscovery.ts
│       └── useNotifications.ts
├── workers/
│   ├── index.ts                         # Worker orchestrator (13 workers)
│   ├── content-extraction.worker.ts
│   ├── script-generation.worker.ts      # Persists References, routes to script verification
│   ├── script-verification.worker.ts    # "Teacher" agent: claim extraction, sourcing check, ≤3 revision loops
│   ├── reference-validation.worker.ts   # Source quality filter + 4-layer verification pipeline
│   ├── audio-generation.worker.ts
│   ├── audio-stitching.worker.ts
│   ├── audio-import.worker.ts           # STT + transcript parsing for imported podcasts
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
    ├── version.ts              # PodcastVersion + version history types
    ├── import.ts               # Import job types (audio upload, STT, transcript parsing)
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
| `User`                  | Auth, profile, bio, avatar, role (USER/CREATOR/ADMIN), usage tracking, Twitter handle + prefs                                                                                                                            |
| `Follow`                | Social: follower → following                                                                                                                                                                                             |
| `Podcast`               | Title, topic, status, audioUrl, pdfUrl, visibility, source (WEB/TWITTER/API), fork tracking, import fields (importedAudioKey, isHumanContent), versioning (currentVersion), fork fields (remixNote), creditCost (Float?) |
| `Discovery`             | Chat metadata (audience, depth, tone, focus, duration)                                                                                                                                                                   |
| `DiscoveryMessage`      | Individual chat messages (role, content, chips)                                                                                                                                                                          |
| `Script`                | Structured JSON turns + raw markdown, versioned                                                                                                                                                                          |
| `Segment`               | Per-speaker audio chunk: text, audioUrl, timing, order                                                                                                                                                                   |
| `Reference`             | Per-podcast citation: number, title, authors, year, URL, type, verificationStatus                                                                                                                                        |
| `Interaction`           | Question at timestamp, answer, resolution status, helpful feedback (`Boolean?`), segment mapping (`segmentOrder Int?`)                                                                                                   |
| `Like` / `Save`         | Social engagement                                                                                                                                                                                                        |
| `Tag` / `PodcastTag`    | Discovery taxonomy                                                                                                                                                                                                       |
| `Subscription`          | Stripe (FREE/STARTER/PRO/STUDIO/POWER) with credit balance (Float) + rollover (includes voiceCreatorAddonActive, voiceCreatorAddonStripeSubscriptionId)                                                                  |
| `CreditTransaction`     | Audit trail (Float amounts): grants, consumption (1 per podcast, 0.25 per interaction), refunds, purchases                                                                                                               |
| `VoiceClone`            | User voice clones (name, ElevenLabs ID, source type)                                                                                                                                                                     |
| `VoiceAllowlist`        | Pre-approved voice access: voice clone → allowed user (Studio + Voice Creator addon)                                                                                                                                     |
| `UserTtsKey`            | BYOK encrypted API keys per TTS provider (AES-256-GCM), `@@unique([userId, provider])`                                                                                                                                   |
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

## Pricing Tiers (Credit-Based)

Multi-provider TTS (ElevenLabs, OpenAI, PlayHT, Cartesia, Hume). BYOK users bring their own keys.
Podcast generation costs 1 credit. Interactions cost 0.25 credits each (no per-podcast limits). Imports cost 0.5 credits each (no TTS cost, just storage + optional STT). Free caps at 5 min, all paid tiers at 10 min.

| Tier         | Price  | Credits/mo | Rollover | Duration | Voice Clones | Sound Effects            |
| ------------ | ------ | ---------- | -------- | -------- | ------------ | ------------------------ |
| Free         | $0     | 3/mo       | 0        | 5 min    | 0            | Standard                 |
| Starter      | $14/mo | 5/mo       | 1        | 10 min   | 1            | Standard                 |
| Pro          | $34/mo | 10/mo      | 3        | 10 min   | 3            | Standard                 |
| Studio       | $69/mo | 20/mo      | 8        | 10 min   | 10           | Premium (ElevenLabs SFX) |
| Power (BYOK) | $9/mo  | 50/mo      | 10       | 10 min   | 10           | Premium                  |

Credit packs available for paid tiers: 3 credits ($7), 10 credits ($20), 25 credits ($45) (one-time purchase).

**Voice Creator Add-On** ($15/mo, Studio only): Pre-approve users for instant access to your voice clones via allowlist.

**Shared Voice Surcharge**: Using another user's shared voice clone costs +1 credit per shared voice slot. Using your own cloned voices incurs no surcharge — included in your tier.

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
13. **Fix all errors in one pass** — when running tsc or lint, collect ALL errors first, then fix them in a single pass — don't fix one, re-run, fix another, repeat
14. **No `console.log` in committed code** — unless it's intentional logging (use proper logger)

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
- After any Prisma schema change, run `npx prisma generate` before `npx tsc --noEmit`
- When CI fails, read the full log — don't guess which test broke

## Environment Variables

See `.env.example` for all required/optional variables. Critical ones:

- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string
- `NEXTAUTH_SECRET` — Auth encryption key
- `ANTHROPIC_API_KEY` — Claude API key
- `ELEVENLABS_API_KEY` — ElevenLabs TTS API key
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` — Payments
- `STRIPE_PRICE_ID_VOICE_CREATOR_ADDON` — Voice Creator addon price ID
- `R2_*` — Cloudflare R2 storage credentials

Apple Sign In (optional):

- `APPLE_CLIENT_ID` / `APPLE_CLIENT_SECRET` — Apple OAuth credentials

Twitter integration (optional):

- `TWITTER_BEARER_TOKEN` — Twitter API v2 read access
- `TWITTER_API_KEY` / `TWITTER_API_SECRET` — OAuth 1.0a for @sottofm bot
- `TWITTER_ACCESS_TOKEN` / `TWITTER_ACCESS_SECRET` — @sottofm bot access
- `TWITTER_SOTTO_USER_ID` — Numeric user ID for @sottofm
- `TWITTER_CLIENT_ID` / `TWITTER_CLIENT_SECRET` — Twitter OAuth for user login

Provider selection (swap services via env):

- `AI_PROVIDER` — `anthropic` (default) | `openai`
- `TTS_PROVIDER` — `elevenlabs` (default) | `openai`
- `STT_PROVIDER` — `openai` (default) | `elevenlabs`
- `STORAGE_PROVIDER` — `r2` (default) | `s3` | `local`
- `PAYMENT_PROVIDER` — `stripe` (default) | `none`
- `BYOK_ENCRYPTION_KEY` — AES-256-GCM key for encrypting user TTS API keys

## Reference

Full product plan, market analysis, competitive landscape, and implementation phases: `docs/00-plan.md`
