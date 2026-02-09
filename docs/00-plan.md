# Plan: Scaffold Sotto — Interactive Podcast Platform

## Context

After building the drifting-models narrated video (ElevenLabs TTS + Manim + FFmpeg), the user wants to turn the **video/voice creation pipeline** into an independent SaaS product. Modeled after the Quvo company creator at `~/Code/Quvo` (Next.js 14, Prisma, BullMQ, Stripe, CSS Modules).

**Sotto** (from "sotto voce" — soft voice in Italian) is an interactive podcast platform where:
1. User provides a topic/URL/PDF → AI generates a 2-voice conversational podcast
2. User can **interrupt mid-playback** to ask questions → AI answers in context
3. If resolved, the podcast can be **updated** with the new explanation baked in
4. Podcasts are **public on a social feed** — others can discover, listen, fork

---

## Market Analysis & Competitive Landscape

### Market Size
- Global podcasting market: **$30.7B** (2024) → **$131B** by 2030 (27% CAGR)
- 584M podcast listeners in 2025, projected 619M by 2026
- AI-generated audio is the fastest-growing segment

### Competitive Landscape

| Company | What They Do | Strengths | Weaknesses | Sotto's Edge |
|---------|-------------|-----------|------------|-------------|
| **Google NotebookLM** | Upload docs → AI podcast | Free, Google backing, 76+ languages, 2M token context | No interactivity, no social, no customization, fixed voices | Interactive Q&A, social feed, podcast updates, voice diversity |
| **Chatterbox (Hume AI)** | Real-time AI voice conversation | True mid-sentence interruption, emotion detection, web search | Ephemeral (no MP3/URL), no social, no production value, single voice | Persistent content, shareability, production value, social feed, creator economy |
| **Wondercraft** | AI podcast studio | Full production suite, music, editing ($25-60/mo) | No interactivity, creator-focused, no social feed | Listener-first: interrupt, ask, learn, share |
| **Descript** | Text-based podcast editing | Edit audio like text, $100M+ raised | Editing tool, not generation. No interactivity | Generate from zero: topic → full podcast |
| **Podcastle** | AI podcast creation | Revoice cloning, $22.2M funded, $12-40/mo | Traditional workflow, no topic generation, no interactivity | AI-native generation, interactive, social |
| **Riverside.fm** | Remote podcast recording | Best recording quality, $47M raised | Recording tool, not AI generation | AI generation from scratch, no guests needed |
| **ElevenLabs** | Voice/audio AI platform | Best TTS quality ($6.6B valuation), API leader | Infrastructure, not a podcast product | We use ElevenLabs as infrastructure |
| **Podbean AI** | AI podcast hosting | Established since 2006, large user base | Bolt-on AI, not AI-native. No interactivity | Ground-up AI-native, listener-first |
| **Snipd** | AI podcast player | Great summarization, note-taking integrations | Only works with existing podcasts | Generates new content on-demand |
| **podcast.ai** | AI celebrity interviews | Viral novelty | Entertainment only, no user-generated content | Educational utility, interactive, social |

### Sotto's Competitive Moat

**Sotto's moat is the podcast format itself — persistent, shareable, discoverable, and improvable content.** Chatterbox by Hume AI has real-time voice interruption, proving the market for interactive AI audio. But Sotto and Chatterbox solve it from opposite ends: Chatterbox optimizes for spontaneity (ephemeral conversations), Sotto optimizes for persistence and reach (produced shows you can share). No existing player combines all of:

1. **Persistent Podcast Updates** — Questions and answers get permanently baked back into the episode. Chatterbox conversations disappear.
2. **Social Discovery Feed** — Public podcasts, fork & remix, follow creators. One great podcast serves thousands. Chatterbox is solo.
3. **Structured Personalized Generation** — Chat-based discovery tailors content to your background. NotebookLM only processes uploaded docs.
4. **Voice Diversity Pool** — 16 curated voices, unique pair per podcast. NotebookLM uses the same two voices for everything.
5. **Citation Verification** — 4-layer reference validation pipeline. No competitor has formal citation systems.
6. **Creator Economy** — Voice marketplace, fork & remix distribution, creator analytics — a path to "YouTube of AI podcasts."

### Positioning Statement

> **Sotto** — Podcasts that listen back. Generate AI podcasts from any topic, interrupt to ask questions, and share knowledge with the world.

---

## Core User Flow (Mobile-First, Car/Commute Context)

The primary scenario: user gets in the car, opens the app, creates or listens to a podcast during their commute. Everything must work with minimal visual attention.

### Step 1: Create — Chat-Based Discovery

**No forms. No wizards.** The user opens the app, taps "Create Podcast", and starts **chatting** with Sotto's AI. The conversation is natural and guided — the AI asks smart questions with suggested options (tappable chips) but accepts free text too.

```
Sotto: "Hey! What are you curious about today?"
User: "I want to understand how transformers work in AI"
Sotto: "Great topic! How deep should we go?" [chips: Quick overview · Standard · Deep dive]
User: taps "Standard"
Sotto: "What's your background with this?" [chips: Total beginner · Some ML knowledge · I'm an engineer]
User: taps "Some ML knowledge"
Sotto: "Any specific angle? Like the math, the intuition, or real-world applications?"
User: "Focus on the intuition, I don't want heavy math"
Sotto: "Perfect. And for voices — want it casual or more lecture-style?" [chips: Casual · Professional · Socratic]
User: taps "Casual"
```

The AI extracts structured metadata from the conversation: `{topic, depth, audience, focus, tone, duration}`. This feeds directly into the script generation prompt.

### Step 2: Smart Recommendations — Before Generating

**Before spending compute**, Sotto searches existing public podcasts for similar content. If matches exist:

```
Sotto: "Actually, I found 2 podcasts on similar topics that other people created:"
  📎 "Transformers Explained Simply" by @maria — 12 min, beginner-friendly, 847 plays
  📎 "Attention Is All You Need Breakdown" by @deeplearner — 18 min, deep dive, 2.3k plays
Sotto: "Want to listen to one of these first? Or should I create a fresh one tailored to you?"
[chips: Listen to Maria's · Listen to @deeplearner's · Create mine · Explore more from these creators]
```

If user explores, they can **follow** creators and browse related podcasts. This drives the social feed and reduces redundant generation.

### Step 3: Generate — Background Processing

If the user chooses "Create mine":
```
Sotto: "On it! I'll have your podcast ready in about 2-3 minutes. I'll ping you when it's done."
[Shows progress: Writing script... → Generating voices... → Finalizing...]
```

User can leave the app — they'll get a **push notification** when the podcast is ready:
> "Your podcast 'Transformers Intuition' is ready to play"

### Step 4: Listen — Spotify-Style Player

Full audio player with:
- Play / Pause / Skip 15s / Speed control (0.5x-2x)
- Progress bar with waveform visualization
- Speaker labels in transcript (Host = amber, Expert = navy)
- Mini player that persists while browsing the app

### Step 5: Interrupt & Question

An extra button alongside play controls: **"Ask a Question"** (microphone icon or text input).

When tapped:
1. Podcast pauses automatically
2. Chat interface slides up
3. User types or voice-inputs their question
4. Sotto answers in context (knows exactly where in the podcast they are)
5. "Was that clear?" → Yes / No
6. If yes: "Want me to update the podcast with this explanation for next time?"
7. If update requested: re-generates affected segments, re-stitches, updates the stored podcast

### Step 6: Social Feed & Follow

- Browse public podcasts by topic/tag
- Follow creators whose content you like
- Fork: create your own version with different depth/focus/audience
- Likes, saves, play counts
- Profile pages with all a user's podcasts

### Platforms

| Platform | Technology | Priority |
|----------|-----------|----------|
| **Web** | Next.js (PWA-capable) | Phase 1 (MVP) |
| **iOS** | React Native + Expo | Phase 2 |
| **Android** | React Native + Expo | Phase 3 |

Web-first for MVP, but designed mobile-first from day one. The chat-based discovery and Spotify-style player work equally well on web and native.

---

## Discovery Chat (Technical)

Unlike Quvo's form-based discovery, Sotto uses a **chat-based discovery agent** powered by Claude. The agent:

1. Asks conversational questions with suggested chip options
2. Adapts follow-up questions based on answers (e.g., if user says "I'm an expert", skip basic depth questions)
3. Extracts structured metadata: `{topic, depth, audience_level, focus_areas, tone, duration_preference, prior_knowledge, specific_questions}`
4. Searches existing podcasts via vector similarity on topic + metadata
5. Presents recommendations before committing to generation
6. Passes the full structured context to the script generation worker

This discovery feeds into the Claude system prompt as structured context, producing dramatically better podcast scripts than a raw topic string.

---

## Pricing & Tiers

### Free
- **$0/month**
- 2 podcasts/month
- Listen unlimited (anyone's public podcasts)
- Standard voices (OpenAI TTS)
- Up to 10 min per podcast
- 2 interactions per podcast
- Public podcasts only
- Community feed access

### Pro — $14/month
- **Everything in Free, plus:**
- 8 podcasts/month
- 10 interactions per podcast
- 3 premium voice credits/month (ElevenLabs)
- 2 voice clones
- Private & unlisted podcasts
- Download MP3s + PDF transcripts
- Browse voice library

### Creator — $29/month
- **Everything in Pro, plus:**
- 30 podcasts/month
- Unlimited interactions
- 10 premium voice credits/month
- 5 voice clones
- Premium sound effects (ElevenLabs SFX)
- Voice marketplace listing
- Creator analytics dashboard

### Premium Add-ons (SOON badges on pricing page)

| Feature | Tier | Status | Description |
|---------|------|--------|-------------|
| **Video Explainers** | Pro+ | SOON | AI-generated visual companion (Manim/motion graphics) synced to podcast audio |
| **Course Mode** | Pro+ | SOON | Series of podcasts with knowledge checks, progress tracking, completion certificates |
| **Multi-Language** | Pro+ | SOON | Generate the same podcast in 29 languages via ElevenLabs multilingual v2 |
| **Custom Intro/Outro** | Creator | SOON | Branded podcast intro music and outro with your name/company |
| **Podcast Playlists** | Free | SOON | Curate and share ordered collections of public podcasts |
| **Embed Widget** | Pro+ | SOON | Embeddable player widget for blogs, docs, and learning platforms |

---

## What We're Building Now

Full SaaS scaffolding at `~/Code/Sotto/` — project structure, database schema, auth, queue system, design system, all pages/components stubbed out, comprehensive documentation (like Quvo). Web-first MVP, mobile-first design. Same tech patterns as Quvo.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Web Frontend | Next.js 14+ (App Router), TypeScript, CSS Modules (NO Tailwind), PWA-capable |
| Mobile (SOON) | React Native + Expo (iOS first, then Android) |
| Database | PostgreSQL + Prisma ORM |
| Auth | NextAuth.js v5 (email, Google, GitHub OAuth, Apple Sign In for iOS) |
| Queue | Redis + BullMQ (6 worker types) |
| AI | Anthropic Claude (discovery chat, script generation, Q&A interactions) |
| Audio | ElevenLabs (multi-voice TTS per segment) |
| Stitching | FFmpeg (segment concatenation + normalization) |
| Storage | Cloudflare R2 (S3-compatible, podcast audio + assets) |
| Search | PostgreSQL full-text search (MVP) → vector similarity (later) |
| Notifications | Web Push API (web) + Expo Push (mobile SOON) |
| Payments | Stripe (Free $0/Pro $14/Creator $29) |
| Hosting | Vercel (web) + Railway (workers) |

## Design System: "Warm Intimacy"

- **Primary**: Golden Amber `#D97706` (warm, inviting)
- **Accent**: Deep Navy `#1E3A5F` (grounding, trust)
- **Background**: Soft Cream `#FEFCF8` (parchment feel)
- **Headings**: DM Serif Display (editorial warmth)
- **Body**: Inter (clean readability)
- **Speaker colors**: Host = amber, Expert = navy

## Directory Structure

```
~/Code/Sotto/
├── .env.example
├── CLAUDE.md
├── README.md
├── docker-compose.yml          # PostgreSQL + Redis
├── package.json
├── tsconfig.json / next.config.js / eslint / prettier / vitest
│
├── docs/                       # Comprehensive docs (Quvo pattern)
│   ├── 00-mvp-execution-plan.md      # Phase 1 roadmap, milestones, what to build first
│   ├── 01-product-vision.md          # Problem, solution, target users, personas, positioning
│   ├── 02-market-analysis.md         # TAM/SAM/SOM, competitors, moat, pricing rationale
│   ├── 03-technical-architecture.md  # System design, worker pipeline, data flow, infra
│   ├── 04-design-system.md           # Colors, typography, spacing, component specs
│   ├── 05-ui-mockups.md              # Page-by-page layout specs, component hierarchy
│   ├── 06-authentication-setup.md    # NextAuth config, OAuth providers, middleware
│   ├── 07-stripe-billing.md          # Stripe products, webhooks, subscription lifecycle
│   ├── 08-ai-prompts.md             # System prompts for discovery chat, script gen, Q&A
│   ├── 09-discovery-chat-flow.md     # Chat agent behavior, recommendation logic, metadata extraction
│   └── 10-mobile-strategy.md         # PWA now, React Native roadmap, push notifications
│
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── scripts/setup.sh
├── public/ (favicon, logo, fonts, manifest.json for PWA)
│
└── src/
    ├── middleware.ts
    ├── app/
    │   ├── layout.tsx / page.tsx (landing)
    │   ├── auth/ (login, signup)
    │   ├── (dashboard)/ (dashboard, billing, settings)
    │   ├── create/ (chat-based discovery → generation)
    │   ├── podcast/[podcastId]/ (playback + interrupt + fork)
    │   ├── feed/ (public social feed, search, tag browse)
    │   ├── profile/[userId]/ (public profile, follow, their podcasts)
    │   ├── pricing/ (pricing page with SOON badges)
    │   └── api/
    │       ├── auth/[...nextauth]/
    │       ├── podcasts/ (CRUD, generate, interact, fork, like, save)
    │       ├── discovery/ (chat endpoint: streaming Claude responses + chip suggestions)
    │       ├── recommendations/ (search similar podcasts by topic/metadata)
    │       ├── feed/ (public feed, trending, search)
    │       ├── users/ (profile, follow/unfollow, followers/following)
    │       ├── billing/ (checkout, subscription, portal, usage)
    │       ├── notifications/ (list, mark read, push registration)
    │       ├── tags/
    │       └── webhooks/stripe/
    ├── components/
    │   ├── ui/ (Button, Input, Card, Modal, Toast, Badge, SoonBadge, Chip, etc.)
    │   ├── player/ (AudioPlayer, Waveform, PlaybackControls, InterruptButton, MiniPlayer, TranscriptPanel)
    │   ├── chat/ (ChatContainer, ChatMessage, ChatChips, ResolutionPrompt)
    │   ├── discovery/ (DiscoveryChat, SuggestionChips, RecommendationCard, CreatorSuggestion)
    │   ├── create/ (GenerationProgress, ScriptPreview)
    │   ├── feed/ (PodcastCard, FeedGrid, TagFilter, SearchBar, TrendingSection)
    │   ├── pricing/ (PricingCard, FeatureList, SoonBadge, TierComparison)
    │   ├── profile/ (ProfileHeader, PodcastList, FollowButton, FollowerCount)
    │   ├── notifications/ (NotificationBell, NotificationList, PushPrompt)
    │   ├── layout/ (Sidebar, TopBar, Footer, MobileNav)
    │   └── providers/ (SessionProvider, AudioPlayerProvider, NotificationProvider)
    ├── lib/
    │   ├── auth.ts / prisma.ts / redis.ts / queue.ts
    │   ├── claude.ts / elevenlabs.ts / stripe.ts
    │   ├── r2.ts / audio-stitcher.ts / content-parser.ts / script-generator.ts
    │   ├── discovery-agent.ts        # Chat-based discovery: Claude streaming + chip generation
    │   ├── recommendations.ts        # Search similar podcasts, rank by relevance
    │   ├── push-notifications.ts     # Web Push API registration + send
    │   ├── subscription.ts / notifications.ts / validations.ts
    │   └── hooks/ (useAuth, useAudioPlayer, usePodcast, useDiscovery, useNotifications)
    ├── workers/
    │   ├── index.ts
    │   ├── content-extraction.worker.ts
    │   ├── script-generation.worker.ts
    │   ├── audio-generation.worker.ts
    │   ├── audio-stitching.worker.ts
    │   ├── interaction.worker.ts
    │   ├── segment-regeneration.worker.ts
    │   └── notification.worker.ts     # Send push notifications when podcast is ready
    ├── styles/globals.css
    └── types/ (podcast.ts, player.ts, interaction.ts, feed.ts, discovery.ts, notification.ts)
```

## Database Schema (Key Models)

| Model | Purpose |
|-------|---------|
| `User` | Auth, profile, bio, avatar, usage tracking, team membership |
| `Follow` | Social: follower → following relationship (unique per pair) |
| `Podcast` | Title, topic, source, status, audioUrl, visibility, fork tracking, play/like/fork counts |
| `Discovery` | Chat-based discovery: stores extracted metadata (audience, depth, tone, focus, duration) + full chat transcript |
| `DiscoveryMessage` | Individual messages in the discovery chat (role, content, chips, timestamp) |
| `Script` | Structured JSON turns + raw markdown + source context, versioned |
| `Segment` | Per-speaker audio chunk: text, audioUrl, startTime, duration, order |
| `Interaction` | Question at timestamp, answer, resolved, incorporated flags |
| `Like` / `Save` | Social engagement (unique per user+podcast) |
| `Follow` | Social follow (unique per follower+following pair) |
| `Tag` / `PodcastTag` | Discovery taxonomy |
| `Subscription` | Stripe integration (FREE/PRO/CREATOR tiers) |
| `Job` | BullMQ job tracking |
| `Notification` | In-app + push notifications (type, read status, push delivery status) |
| `PushSubscription` | Web Push API subscription endpoints per user/device |
| `ApiUsageLog` | Cost tracking per service (claude/elevenlabs/ffmpeg) |

**Key enums**: `PodcastStatus` (PENDING → DISCOVERING → EXTRACTING → SCRIPTING → GENERATING_AUDIO → STITCHING → READY → UPDATING), `Speaker` (HOST/EXPERT), `InteractionStatus` (PENDING → ANSWERING → ANSWERED → RESOLVED → INCORPORATING → INCORPORATED), `NotificationType` (PODCAST_READY / PODCAST_LIKED / NEW_FOLLOWER / PODCAST_FORKED / SIMILAR_PODCAST_CREATED)

## Worker Pipeline

### Generation Flow
```
User chats with Discovery Agent (streaming Claude)
    │
    ├── Agent extracts: {topic, depth, audience, tone, focus, duration}
    ├── Agent searches existing podcasts → shows recommendations
    │   └── User explores / follows / or says "Create mine"
    │
    ▼ (user confirms "Create mine")
[content-extraction] → Parse URL/PDF if provided → sourceContext
    │
    ▼
[script-generation] → Claude generates 2-voice script (using discovery metadata as context) → Script model
    │
    ▼
[audio-generation] × N → ElevenLabs TTS per segment → Segment audioUrls (parallel, 5 concurrent)
    │
    ▼
[audio-stitching] → FFmpeg concat + normalize → final.mp3 → READY
    │
    ▼
[notification] → Push notification: "Your podcast is ready!" → user taps → playback page
```

### Interactive Playback Flow
```
User listening → taps "Ask a Question" → podcast pauses
    │
    ▼
[interaction] → Claude answers using script context + discovery context + timestamp position
    │
    ▼
"Was that clear?" → Yes → "Update the podcast with this?" → Yes
    │
    ▼
[segment-regeneration] → Insert new segments + re-TTS + re-stitch → updated podcast
```

### Social Discovery Flow
```
User browsing feed → finds interesting podcast → taps play
    │
    ├── Likes → increments count, appears in user's liked list
    ├── Saves → bookmarked for later
    ├── Follows creator → gets notified of their new podcasts
    └── Forks → creates a copy, user re-runs discovery chat to customize
```

## Implementation Order

### Phase 1: Foundation
1. Project scaffold (package.json, configs, docker-compose, git init)
2. Comprehensive docs/ (all 11 docs, like Quvo — full product bible)
3. Design system (globals.css with Sotto warm palette tokens)
4. Prisma schema (all models including Follow, Discovery, PushSubscription) + `db push`
5. Core libs (prisma.ts, redis.ts, logger.ts, errors.ts, utils.ts, validations.ts)
6. Auth (NextAuth, login/signup pages, middleware, Apple Sign In prep)
7. Root layout with DM Serif Display + Inter fonts

### Phase 2: UI Component Library
8. UI primitives (Button, Input, Card, Modal, Toast, Badge, SoonBadge, Chip, Spinner)
9. Layout components (Sidebar, TopBar, Footer, MobileNav, MiniPlayer shell)
10. Dashboard shell with mobile-first responsive design

### Phase 3: Chat-Based Discovery & Generation Pipeline
11. Discovery chat agent (lib/discovery-agent.ts — Claude streaming + chip generation)
12. Discovery chat UI (DiscoveryChat, SuggestionChips, ChatMessage, ChatChips)
13. Recommendation engine (lib/recommendations.ts — search existing podcasts by topic similarity)
14. Recommendation UI (RecommendationCard, CreatorSuggestion)
15. Content parser + content-extraction worker
16. Claude script generator (lib/script-generator.ts — uses discovery metadata)
17. ElevenLabs integration (lib/elevenlabs.ts)
18. Audio generation + stitching workers
19. R2 storage, queue system, worker entry
20. Notification worker (push notification when podcast ready)
21. Create page (/create) end-to-end: chat → recommend → generate → notify
22. API routes: /api/discovery, /api/recommendations, /api/podcasts, /api/podcasts/[id]/generate

### Phase 4: Interactive Playback
23. Audio player (HTML5 Audio + React state + AudioPlayerProvider context)
24. MiniPlayer (persists while navigating the app)
25. Transcript panel with speaker labels + auto-scroll
26. Interrupt button + chat interface + ResolutionPrompt
27. Interaction + segment regeneration workers
28. Playback page (/podcast/[id]) assembly
29. API routes: /api/podcasts/[id]/interact, /api/podcasts/[id]/regenerate-segment

### Phase 5: Social Feed & Follow System
30. Feed components (PodcastCard, FeedGrid, TagFilter, SearchBar, TrendingSection)
31. Feed page (/feed) with search + tag filtering + trending
32. Profile page (/profile/[userId]) with follow button + podcast list
33. Follow system (API: /api/users/[id]/follow, followers/following lists)
34. Fork flow (/podcast/[id]/fork → re-runs discovery chat)
35. Like/Save API + UI integration
36. API routes: /api/feed, /api/users, /api/tags

### Phase 6: Notifications & Push
37. Web Push API integration (lib/push-notifications.ts, service worker)
38. PushPrompt component (ask user to enable notifications)
39. NotificationBell + NotificationList components
40. API routes: /api/notifications

### Phase 7: Billing, Pricing & Polish
41. Stripe integration (lib/stripe.ts, lib/subscription.ts)
42. Pricing page (/pricing) with tiers + SOON badges for premium features
43. Billing pages + Stripe webhook handler
44. Dashboard page (my podcasts, usage meter, create CTA)
45. Landing page (hero, how it works, featured podcasts, social proof, pricing)
46. PWA manifest + service worker for offline-capable mobile web

## Key Files to Reference from Quvo

| Quvo File | Sotto Equivalent | Adapt How |
|-----------|-----------------|-----------|
| `src/lib/queue.ts` | `src/lib/queue.ts` | Same BullMQ pattern, podcast job types + notification queue |
| `src/lib/r2.ts` | `src/lib/r2.ts` | Same S3 client, `podcasts/` key prefix |
| `src/lib/claude.ts` | `src/lib/claude.ts` | Same wrapper, add streaming for discovery chat + script gen |
| `src/workers/index.ts` | `src/workers/index.ts` | Same orchestration, 7 Sotto workers |
| `prisma/schema.prisma` | `prisma/schema.prisma` | Same conventions, podcast + social models |
| `src/lib/stripe.ts` | `src/lib/stripe.ts` | Same integration, Sotto pricing tiers |
| `src/components/chat/` | `src/components/discovery/` | Quvo has chat for project discovery; Sotto adapts for podcast creation chat |
| `docs/01-product-vision.md` | `docs/01-product-vision.md` | Same depth and rigor, Sotto product |
| `docs/02-market-analysis.md` | `docs/02-market-analysis.md` | Same structure, podcast market data |
| `docker-compose.yml` | `docker-compose.yml` | Same PostgreSQL + Redis setup |
| `src/middleware.ts` | `src/middleware.ts` | Same auth protection pattern |
| `src/lib/notifications.ts` | `src/lib/push-notifications.ts` | Extend with Web Push API for push delivery |

## Verification

1. `npm install` succeeds
2. `docker-compose up -d` starts PostgreSQL + Redis
3. `npx prisma db push` creates all tables
4. `npm run dev` starts Next.js + workers without errors
5. Auth flow works (login/signup pages render)
6. Dashboard shell renders with sidebar + mobile nav
7. `/create` page opens chat-based discovery flow
8. Discovery chat streams AI responses with suggestion chips
9. `/feed` page renders with podcast cards + search
10. `/pricing` page renders with tiers + SOON badges
11. MiniPlayer component renders (empty state)
12. All component stubs render without errors
13. All 11 docs/ files are comprehensive and self-contained
14. PWA manifest present at `/manifest.json`
