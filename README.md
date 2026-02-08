<div align="center">

# Sotto

### Podcasts that listen back.

Generate AI podcasts from any topic. Interrupt to ask questions. Share knowledge with the world.

[Getting Started](#getting-started) · [How It Works](#how-it-works) · [Architecture](#architecture) · [Documentation](#documentation)

---

</div>

## What is Sotto?

**Sotto** (from Italian *"sotto voce"* — speaking in a soft, intimate voice) is an interactive AI podcast platform that transforms curiosity into understanding.

Describe what you want to learn through a natural conversation. Sotto generates a personalized two-voice podcast — a warm Host and a grounding Expert — that you can listen to anywhere. The twist: you can **interrupt mid-playback** to ask questions, get contextual answers, and update the episode with those clarifications for all future listeners.

### What makes Sotto different

| | Sotto | Google NotebookLM | Traditional Podcasts |
|---|---|---|---|
| **Real-time Q&A** | Pause and ask questions mid-episode | No | No |
| **Self-updating episodes** | Q&A gets baked into the podcast | No | No |
| **Chat-based creation** | Conversational discovery with AI | Form-based | Manual recording |
| **Voice diversity** | Unique voice pairs per podcast | Same 2 voices every time | Fixed hosts |
| **Social feed** | Discover, fork, follow creators | No | Platform-dependent |
| **Verified references** | 4-layer verified `[N]` citations with PDF export | Partial | Manual |

## How It Works

### 1. Chat with AI to design your podcast

No forms, no wizards. Describe what you want to learn and Sotto's discovery agent asks smart follow-up questions — topic depth, audience background, preferred tone, duration — with tappable suggestion chips. Before generating, Sotto searches existing public podcasts and recommends relevant ones.

### 2. AI generates a two-voice conversation

Sotto creates a structured script with a Host (warm, inviting) and an Expert (grounded, authoritative), complete with citations and emotional delivery cues. Each segment is synthesized with distinct voices via ElevenLabs, then stitched together with FFmpeg.

### 3. Listen and interrupt

Play your podcast anywhere. When something sparks a question, tap **"Ask a Question"** — the episode pauses, and the AI answers in full context (it knows exactly where you are in the conversation). If you're satisfied, the episode can be updated with the clarification baked in.

### 4. Share and discover

Publish to the social feed. Other users can discover your podcast, follow you, fork episodes to create their own variations, and contribute questions that improve the content over time.

## Verified References

Every claim in a Sotto podcast is backed by real, verifiable sources. When the AI generates a script, it includes inline `[N]` citation markers — click any marker to see the full reference: title, authors, year, and URL.

Before a podcast goes live, every reference passes through a **4-layer verification pipeline**:

1. **URL Resolution** — HTTP HEAD request confirms the source URL is reachable
2. **DOI via CrossRef** — Cross-references DOI against the CrossRef registry (250M+ works) to confirm title and author accuracy
3. **Title Search via OpenAlex** — Fuzzy-matches titles against the OpenAlex academic database for independent confirmation
4. **AI Verification Agent** — Claude critically evaluates plausibility and suggests real replacements for suspicious sources

References that fail verification are either replaced with verified alternatives or removed entirely. Citation markers are automatically renumbered so the transcript stays clean.

Export any podcast as an academic-style PDF with a full bibliography — every reference in it has been independently verified.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 14+ (App Router), TypeScript, CSS Modules |
| **Database** | PostgreSQL 16 + Prisma ORM |
| **Auth** | NextAuth.js v5 (Email, Google, GitHub, Apple) |
| **Queue** | Redis 7 + BullMQ (9 worker types) |
| **AI** | Anthropic Claude (chat, scripts, Q&A) |
| **Audio** | ElevenLabs (multi-voice TTS per segment) |
| **Stitching** | FFmpeg (concatenation + normalization) |
| **Storage** | Cloudflare R2 (S3-compatible) |
| **Payments** | Stripe (Free / Pro / Team) |
| **PDF** | pdfmake (academic-style transcript export) |
| **Hosting** | Vercel (web) + Railway (workers) |

All external services are **swappable** via environment variables (`AI_PROVIDER`, `TTS_PROVIDER`, `STORAGE_PROVIDER`, `PAYMENT_PROVIDER`).

## Architecture

### Generation Pipeline

```
User describes topic via chat
        │
        ▼
┌─────────────────┐
│   Discovery AI   │  Claude streaming + chip suggestions
└────────┬────────┘
         │  extracts: {topic, depth, audience, tone, focus, duration}
         ▼
┌─────────────────┐
│    Content       │  Parse URL/PDF if user provided sources
│   Extraction     │
└────────┬────────┘
         ▼
┌─────────────────┐
│     Script       │  Claude generates 2-voice script with [N] citations
│   Generation     │
└────────┬────────┘
         ▼
┌─────────────────┐
│   Reference      │  4-layer verification: URL, CrossRef, OpenAlex, AI
│   Validation     │
└────────┬────────┘
         ▼
┌─────────────────┐
│     Audio        │  ElevenLabs TTS per segment (5 concurrent)
│   Generation     │
└────────┬────────┘
         ▼
┌─────────────────┐
│     Audio        │  FFmpeg concat + loudness normalization
│    Stitching     │
└────────┬────────┘
         ▼
┌─────────────────┐
│   Notification   │  Push: "Your podcast is ready!"
└─────────────────┘
```

### Interactive Playback

```
Listener taps "Ask a Question"  →  Podcast pauses
        │
        ▼
┌─────────────────┐
│   Interaction    │  Claude answers using script context + timestamp
│     Worker       │
└────────┬────────┘
         │  "Was that clear?" → Yes → "Update podcast?" → Yes
         ▼
┌─────────────────┐
│    Segment       │  Insert new segments, re-synthesize, re-stitch
│  Regeneration    │
└─────────────────┘
```

### Database Schema

Key models: **User**, **Podcast**, **Discovery** + **DiscoveryMessage**, **Script**, **Segment**, **Reference**, **Interaction**, **Like/Save**, **Follow**, **Tag**, **Subscription**, **Notification**, **Job**, **ApiUsageLog**

Status flow: `PENDING → DISCOVERING → EXTRACTING → SCRIPTING → VALIDATING_REFERENCES → GENERATING_AUDIO → STITCHING → READY → UPDATING`

## Project Structure

```
src/
├── app/                      Next.js App Router
│   ├── page.tsx              Landing page
│   ├── auth/                 Login, signup
│   ├── (dashboard)/          Dashboard, billing, settings
│   ├── create/               Chat discovery → generation
│   ├── podcast/[podcastId]/  Player + interrupt + fork
│   ├── feed/                 Public social feed
│   ├── profile/[userId]/     Creator profiles
│   ├── pricing/              Pricing tiers
│   └── api/                  20+ API routes
├── components/               50+ components
│   ├── ui/                   Button, Card, Modal, Toast, Badge, Spinner...
│   ├── player/               AudioPlayer, Waveform, Transcript, Teleprompter
│   ├── chat/                 ChatContainer, ChatMessage, ChatChips
│   ├── discovery/            DiscoveryChat, Recommendations
│   ├── feed/                 PodcastCard, FeedGrid, TagFilter, SearchBar
│   ├── profile/              ProfileHeader, FollowButton
│   └── layout/               Sidebar, TopBar, Footer, MobileNav
├── lib/                      Core libraries
│   ├── claude.ts             Anthropic client (streaming + non-streaming)
│   ├── elevenlabs.ts         Multi-voice TTS with voice pool
│   ├── discovery-agent.ts    Chat agent + chip generation
│   ├── script-generator.ts   Script generation with citations
│   ├── audio-stitcher.ts     FFmpeg segment stitching
│   ├── stripe.ts             Payments + subscription management
│   ├── providers/            Swappable service providers
│   └── hooks/                useAuth, useAudioPlayer, usePodcast...
├── workers/                  9 BullMQ background workers
├── styles/
│   └── globals.css           Design system tokens
└── types/                    TypeScript definitions
```

## Getting Started

### Prerequisites

- **Node.js** 18+
- **Docker** (for PostgreSQL + Redis)
- **FFmpeg** (for audio stitching)

### Setup

```bash
# Clone the repository
git clone https://github.com/affromero/Sotto.git
cd Sotto

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# → Fill in your API keys (see Environment Variables below)

# Start PostgreSQL + Redis
docker-compose up -d

# Set up the database
npx prisma generate
npx prisma db push

# Seed with sample data (optional)
npx prisma db seed

# Start development (web + workers)
npm run dev
```

### Environment Variables

Copy `.env.example` and configure:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `NEXTAUTH_SECRET` | Yes | Auth encryption key |
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `ELEVENLABS_API_KEY` | Yes | ElevenLabs TTS API key |
| `STRIPE_SECRET_KEY` | For billing | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | For billing | Stripe webhook signing secret |
| `R2_ACCESS_KEY_ID` | For storage | Cloudflare R2 credentials |
| `AI_PROVIDER` | No | `anthropic` (default) or `openai` |
| `TTS_PROVIDER` | No | `elevenlabs` (default) or `openai` |
| `STORAGE_PROVIDER` | No | `r2` (default), `s3`, or `local` |
| `PAYMENT_PROVIDER` | No | `stripe` (default) or `none` |
| `OPENALEX_EMAIL` | No | Email for OpenAlex polite pool (higher rate limits) |

### Commands

```bash
npm run dev          # Web + workers concurrently
npm run dev:web      # Web only
npm run dev:workers  # Workers only
npm run build        # Production build
npm run lint         # ESLint
npm run test         # Vitest
npm run test:watch   # Vitest in watch mode
npx tsc --noEmit     # Type checking
```

## Design System

Sotto's visual language — **"Warm Intimacy"** — evokes sitting in a cozy room listening to two knowledgeable friends have a conversation.

| Token | Value | Usage |
|-------|-------|-------|
| Primary | `#D97706` Golden Amber | CTAs, Host speaker, highlights |
| Accent | `#1E3A5F` Deep Navy | Expert speaker, secondary actions |
| Background | `#FEFCF8` Soft Cream | Page background |
| Surface | `#FFFFFF` White | Cards, panels |
| Heading | DM Serif Display | Editorial warmth |
| Body | Inter | Clean readability |

CSS Modules only — no Tailwind, no inline styles, no styled-components. Mobile-first responsive design.

## Pricing

| | Free | Pro | Team |
|---|---|---|---|
| **Price** | $0 | $19/mo | $49/mo |
| **Podcasts** | 3/month | 20/month | Unlimited |
| **Duration** | 10 min | 30 min | 30 min |
| **Interactions** | 3 per podcast | Unlimited | Unlimited |
| **Visibility** | Public only | Public + Private | Team feed |

## Documentation

The `docs/` directory contains comprehensive documentation:

| Document | Description |
|----------|-------------|
| [Product Vision](docs/01-product-vision.md) | Problem, solution, target personas |
| [Market Analysis](docs/02-market-analysis.md) | TAM/SAM/SOM, competitive landscape |
| [Technical Architecture](docs/03-technical-architecture.md) | System design, data flow |
| [Design System](docs/04-design-system.md) | Colors, typography, spacing, components |
| [UI Mockups](docs/05-ui-mockups.md) | Page-by-page specifications |
| [Auth Setup](docs/06-authentication-setup.md) | NextAuth configuration |
| [Stripe Billing](docs/07-stripe-billing.md) | Subscription lifecycle |
| [AI Prompts](docs/08-ai-prompts.md) | System prompts for all AI features |
| [Discovery Flow](docs/09-discovery-chat-flow.md) | Chat agent behavior |
| [Mobile Strategy](docs/10-mobile-strategy.md) | PWA + React Native roadmap |
| [Unit Economics](docs/11-unit-economics.md) | Cost analysis, revenue projections |
| [Provider Pricing](docs/12-provider-pricing.md) | AI/TTS provider comparison |
| [MVP Launch Guide](docs/13-mvp-launch-guide.md) | Deployment checklist |
| [iOS Strategy](docs/14-ios-app-strategy.md) | Three-phase iOS roadmap |

## License

All rights reserved. This is proprietary software.
