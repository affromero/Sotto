# Technical Architecture — Sotto

> **Date**: 2026-02-08
>
> **Summary**: System design for Sotto's interactive podcast platform. Covers the end-to-end data flow from user chat through script generation, audio synthesis, stitching, and delivery. Details the worker pipeline architecture, database schema, authentication flow, storage strategy, queue system, and scaling considerations. The architecture prioritizes async processing via BullMQ workers, keeping API routes thin and responsive while heavy AI and audio processing runs in background workers.

---

## 1. System Overview

Sotto's architecture follows a three-layer pattern: a Next.js web application handles user-facing requests, a BullMQ worker pool processes heavy computation asynchronously, and external services (Claude, ElevenLabs, Cloudflare R2) provide AI and storage capabilities.

```
                    +-------------------+
                    |   User (Browser)  |
                    +--------+----------+
                             |
                    HTTPS (Vercel/Caddy)
                             |
                    +--------v----------+
                    |   Next.js App     |
                    |   (App Router)    |
                    |                   |
                    | - API Routes      |
                    | - Server Components|
                    | - Client Components|
                    | - Middleware       |
                    +---+-----+-----+---+
                        |     |     |
            +-----------+     |     +-----------+
            |                 |                 |
    +-------v-------+ +------v------+  +-------v-------+
    |  PostgreSQL   | |    Redis    |  |  Cloudflare   |
    |  (Prisma ORM) | |  (BullMQ)  |  |      R2       |
    +-------+-------+ +------+------+  +-------+-------+
            |                 |                 ^
            |          +------v------+          |
            +--------->|   Workers   |----------+
                       |  (BullMQ)   |
                       |             |
                       | - content   |
                       | - script    |
                       | - audio     |
                       | - stitch    |
                       | - interact  |
                       | - regen     |
                       | - notify    |
                       +--+------+--+
                          |      |
                +---------+      +----------+
                |                           |
        +-------v-------+          +-------v-------+
        |   Anthropic   |          |  ElevenLabs   |
        |   Claude API  |          |   TTS API     |
        +---------------+          +---------------+
```

---

## 2. Data Flow: End-to-End Podcast Creation

### 2.1 Phase 1: Discovery Chat

The user initiates podcast creation by chatting with Sotto's AI agent. This happens in real-time via streaming:

```
User types message
    |
    v
POST /api/discovery (streaming)
    |
    v
discovery-agent.ts
    |-- Creates/updates Discovery record in PostgreSQL
    |-- Sends user message + conversation history to Claude (streaming)
    |-- Claude responds with conversational follow-up + chip suggestions
    |-- Streams response tokens back to client via ReadableStream
    |-- Saves DiscoveryMessage records (role, content, chips)
    |-- Extracts structured metadata as conversation progresses:
    |   {topic, depth, audienceLevel, focusAreas, tone, durationTarget, priorKnowledge}
    |
    v
Client renders streamed response + tappable chips
    |
    v
User continues conversation (3-6 exchanges typical)
    |
    v
Agent determines enough context gathered
    |-- Searches existing public podcasts via recommendations.ts
    |-- Returns recommendation cards if matches found
    |
    v
User selects "Create mine" (or listens to existing)
```

**Key implementation details**:

- The discovery chat uses Claude Haiku 4.5 for speed and cost efficiency
- Streaming uses the Web Streams API (ReadableStream) via the Next.js route handler
- Each message is persisted as a DiscoveryMessage for context reconstruction
- Metadata extraction is cumulative — the agent updates the Discovery record after each exchange
- The chat system prompt instructs Claude to ask one question at a time and provide 3-5 chip suggestions per question

### 2.2 Phase 2: Content Extraction (Optional)

If the user provides a URL or PDF during discovery, content extraction runs first:

```
User confirms "Create mine"
    |
    v
POST /api/podcasts (create podcast record, status: PENDING)
    |
    v
Enqueue content-extraction job (if sourceUrl exists)
    |
    v
content-extraction.worker.ts
    |-- Podcast status -> EXTRACTING
    |-- Fetch URL content (cheerio for HTML, pdf-parse for PDF)
    |-- Extract text, headings, key sections
    |-- Truncate to 50K characters (Claude context window management)
    |-- Store extracted content in Discovery.sourceContent
    |-- Podcast status -> SCRIPTING (triggers next worker)
    |-- Enqueue script-generation job
```

If no source URL is provided, the pipeline skips directly to script generation.

### 2.3 Phase 3: Script Generation

```
script-generation.worker.ts
    |-- Podcast status -> SCRIPTING
    |-- Load Discovery metadata (topic, depth, audience, tone, focus, duration)
    |-- Load source content (if extracted)
    |-- Build Claude system prompt with:
    |   - Role definition (podcast scriptwriter)
    |   - Discovery metadata as structured context
    |   - Source content (if available)
    |   - Format instructions (JSON array of turns)
    |   - Duration target (maps to approximate word count)
    |   - Tone and style directives
    |   - Delivery direction instructions (laughing, excited, thoughtful)
    |
    |-- Call Claude Sonnet 4.5 (best quality/cost for creative writing)
    |-- Parse response into structured turns:
    |   [{speaker: "HOST", text: "...", direction: "curious"},
    |    {speaker: "EXPERT", text: "...", direction: "enthusiastic"}, ...]
    |
    |-- Create Script record (turns JSON + raw markdown + version)
    |-- Create Segment records for each turn (text, speaker, order)
    |-- Podcast status -> GENERATING_AUDIO
    |-- Enqueue audio-generation job
```

**Script structure**: Each turn is 2-4 sentences. A 10-minute podcast has approximately 40-60 turns. The Host asks questions, makes observations, and provides transitions. The Expert delivers explanations, examples, and analogies. Delivery directions are embedded in square brackets before each turn.

### 2.4 Phase 4: Audio Generation

```
audio-generation.worker.ts
    |-- Load all Segment records for podcast (ordered)
    |-- Select voice pair from voice pool (deterministic based on podcast ID)
    |   - HOST voice: selected from 8 host voices
    |   - EXPERT voice: selected from 8 expert voices (contrasting gender/accent)
    |
    |-- Process segments in parallel (concurrency: 5)
    |   For each segment:
    |   |-- Map delivery direction to TTS parameters:
    |   |   stability, similarity_boost, style, use_speaker_boost
    |   |-- Call ElevenLabs TTS API with:
    |   |   - Voice ID (host or expert)
    |   |   - Segment text
    |   |   - TTS parameters
    |   |-- Receive audio buffer (MP3)
    |   |-- Upload segment audio to R2: podcasts/{podcastId}/segments/{order}.mp3
    |   |-- Update Segment record: audioUrl, duration
    |   |-- Report progress (segment N of M)
    |
    |-- Generate sound effects via ElevenLabs SFX API:
    |   - Intro jingle (3s)
    |   - 2-3 transition sounds
    |   - Outro music (4s)
    |   - Upload to R2: podcasts/{podcastId}/sfx/
    |
    |-- All segments complete
    |-- Podcast status -> STITCHING
    |-- Enqueue audio-stitching job
```

**Parallelism**: Audio generation is the most time-consuming step. With 5 concurrent ElevenLabs API calls, a 50-segment podcast takes approximately 60-90 seconds (vs. 5-7 minutes sequential). Each segment is independent, so parallelism is safe.

### 2.5 Phase 5: Audio Stitching

```
audio-stitching.worker.ts
    |-- Load all Segment records with audioUrls (ordered)
    |-- Download all segment audio files from R2 to temp directory
    |-- Download sound effect files from R2
    |
    |-- Build FFmpeg filter graph:
    |   1. Concatenate: intro + segments (in order) + outro
    |   2. Insert transition sounds between major topic shifts
    |   3. Apply crossfade (100ms) between consecutive segments
    |   4. Apply loudness normalization (EBU R128, target: -16 LUFS)
    |   5. Output: MP3, 128kbps, 44.1kHz
    |
    |-- Execute FFmpeg command
    |-- Calculate final duration and file size
    |-- Upload final audio to R2: podcasts/{podcastId}/audio.mp3
    |-- Update Podcast record: audioUrl, duration, fileSize
    |-- Update Segment records: startTime (calculated from concat order)
    |-- Podcast status -> READY
    |-- Enqueue notification job
    |-- Clean up temp files
```

**FFmpeg command structure**:

```
ffmpeg -i intro.mp3 -i seg_001.mp3 -i seg_002.mp3 ... -i outro.mp3 \
  -filter_complex "[0:a][1:a]acrossfade=d=0.1[a01]; \
                    [a01][2:a]acrossfade=d=0.1[a02]; ..." \
  -af loudnorm=I=-16:TP=-1.5:LRA=11 \
  -codec:a libmp3lame -b:a 128k -ar 44100 \
  output.mp3
```

### 2.6 Phase 6: Notification and Delivery

```
notification.worker.ts
    |-- Load user's PushSubscription records
    |-- Send Web Push notification:
    |   Title: "Your podcast is ready!"
    |   Body: "{podcastTitle} - {duration} min"
    |   Action: Open /podcast/{podcastId}
    |
    |-- Create Notification record (type: PODCAST_READY)
    |-- Mark notification as pushed: true
```

---

## 3. Interactive Playback Data Flow

### 3.1 Interrupt and Ask

```
User taps "Ask a Question" at timestamp T
    |
    v
Client pauses HTML5 Audio, opens chat interface
    |
    v
POST /api/podcasts/{id}/interact
    Body: {question, timestamp}
    |
    v
API route:
    |-- Validate session (auth required)
    |-- Check interaction limits (Free: 3 per podcast)
    |-- Create Interaction record (status: PENDING)
    |-- Enqueue interaction job
    |-- Return interaction ID
    |
    v
interaction.worker.ts
    |-- Interaction status -> ANSWERING
    |-- Load Script turns up to timestamp T
    |-- Load Discovery metadata (user's background, knowledge level)
    |-- Load previous interactions for this podcast (context continuity)
    |
    |-- Build Claude prompt:
    |   System: "You are answering a listener's question about a podcast.
    |            Here is the script up to the point where they paused: ..."
    |   User context: "Listener background: {audienceLevel}, {priorKnowledge}"
    |   Previous Q&A: [{question, answer}, ...]
    |   Current question: "{question}"
    |
    |-- Call Claude Haiku 4.5 (speed priority — user is waiting)
    |-- Store answer in Interaction record
    |-- Interaction status -> ANSWERED
    |-- Push update to client (polling or SSE)
    |
    v
Client displays answer
    |
    v
"Was that clear?" -> User taps Yes
    |-- Interaction status -> RESOLVED
    |
    v
"Update podcast with this?" -> User taps Yes
    |-- Interaction status -> INCORPORATING
    |-- Enqueue segment-regeneration job
```

### 3.2 Segment Regeneration

```
segment-regeneration.worker.ts
    |-- Podcast status -> UPDATING
    |-- Load current Script + resolved Interaction
    |-- Determine affected segments (around timestamp T)
    |
    |-- Call Claude to generate revised turns:
    |   "The listener asked: {question}
    |    Original explanation: {original turns around timestamp}
    |    Your answer: {interaction answer}
    |    Rewrite the relevant turns to incorporate the clarification naturally."
    |
    |-- Update Script (increment version, replace affected turns)
    |-- Update affected Segment records (new text)
    |-- Re-generate audio for affected segments (ElevenLabs, same voices)
    |-- Re-run audio stitching (full re-stitch for timing consistency)
    |-- Interaction status -> INCORPORATED
    |-- Podcast status -> READY
```

---

## 4. Worker Pipeline Architecture

### 4.1 Worker Types and Configuration

| Worker               | Queue Name           | Concurrency              | Timeout | Retry | Priority |
| -------------------- | -------------------- | ------------------------ | ------- | ----- | -------- |
| Content Extraction   | `content-extraction` | 3                        | 60s     | 2     | Normal   |
| Script Generation    | `script-generation`  | 2                        | 120s    | 2     | Normal   |
| Audio Generation     | `audio-generation`   | 2 (x5 internal parallel) | 300s    | 3     | Normal   |
| Audio Stitching      | `audio-stitching`    | 2                        | 180s    | 2     | Normal   |
| Interaction          | `interaction`        | 5                        | 30s     | 2     | High     |
| Segment Regeneration | `segment-regen`      | 1                        | 300s    | 2     | Normal   |
| Notification         | `notification`       | 5                        | 10s     | 3     | Low      |

### 4.2 Worker Orchestration

The worker entry point (`src/workers/index.ts`) initializes all seven workers, each with its own Redis connection (BullMQ requirement). Workers are orchestrated through job chaining — each worker enqueues the next job upon completion:

```
content-extraction -> script-generation -> audio-generation -> audio-stitching -> notification
                                                                                        |
interaction -> segment-regeneration -> audio-generation -> audio-stitching ------>-------+
```

### 4.3 Job Tracking

Every job is tracked in the `Job` database model with:

- `type`: Worker queue name
- `status`: pending, processing, complete, failed
- `payload`: Input data (JSON)
- `result`: Output data (JSON, on success)
- `error`: Error message (on failure)
- `attempts`: Retry count

This allows the dashboard to show real-time generation progress and the API to report status to the client.

### 4.4 Error Handling and Retries

| Error Type                  | Handling Strategy                                          |
| --------------------------- | ---------------------------------------------------------- |
| ElevenLabs rate limit (429) | Exponential backoff: 5s, 15s, 45s                          |
| Claude API timeout          | Retry with same payload, max 2 retries                     |
| FFmpeg processing failure   | Retry once, then mark podcast as FAILED                    |
| R2 upload failure           | Retry with exponential backoff, max 3 retries              |
| Unrecoverable error         | Mark podcast as FAILED, create error notification for user |

Failed jobs update the Podcast status to `FAILED` and create a Notification for the user with a "Retry" action.

### 4.5 Progress Reporting

Workers report progress via `job.updateProgress(percentage)`. The client polls `GET /api/podcasts/{id}` to display real-time progress:

| Status           | Progress Display                         |
| ---------------- | ---------------------------------------- |
| PENDING          | "Queued..."                              |
| DISCOVERING      | "Chatting..." (real-time in UI)          |
| EXTRACTING       | "Reading your source..."                 |
| SCRIPTING        | "Writing the script..."                  |
| GENERATING_AUDIO | "Generating voices... (segment 3 of 48)" |
| STITCHING        | "Putting it all together..."             |
| READY            | "Your podcast is ready!"                 |
| UPDATING         | "Updating with your feedback..."         |
| FAILED           | "Something went wrong. Retry?"           |

---

## 5. Database Schema Overview

### 5.1 Entity Relationship Summary

```
User ──< Podcast ──< Segment
  |         |──── Script (1:1)
  |         |──── Discovery (1:1) ──< DiscoveryMessage
  |         |──< Interaction
  |         |──< Like
  |         |──< Save
  |         |──< PodcastTag >── Tag
  |         |──< Job
  |         └── Podcast (forkedFrom, self-referential)
  |
  |──< Follow (follower/following, self-referential through User)
  |──< Notification
  |──< PushSubscription
  |──< Subscription
  |──< ApiUsageLog
  |── Team (membership + ownership)
```

### 5.2 Core Models

| Model                 | Primary Key | Key Fields                                                                                                                                         | Indexes                                                     |
| --------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **User**              | `id` (cuid) | email (unique), name, image, bio, role (USER/CREATOR/ADMIN), teamId                                                                                | teamId, role                                                |
| **Podcast**           | `id` (cuid) | userId, title, topic, status, audioUrl, duration, visibility, forkedFromId, playCount, likeCount, forkCount                                        | userId, status, visibility, createdAt, playCount, likeCount |
| **Discovery**         | `id` (cuid) | podcastId (unique), userId, topic, depth, audienceLevel, focusAreas[], tone, durationTarget, sourceUrl, sourceContent                              | userId                                                      |
| **DiscoveryMessage**  | `id` (cuid) | discoveryId, role, content, chips (JSON)                                                                                                           | discoveryId                                                 |
| **Script**            | `id` (cuid) | podcastId (unique), turns (JSON), markdown, context, version                                                                                       |                                                             |
| **Segment**           | `id` (cuid) | podcastId, speaker (HOST/EXPERT), text, audioUrl, order, startTime, duration, version                                                              | podcastId, order                                            |
| **Interaction**       | `id` (cuid) | podcastId, userId, status, question, timestamp, answer, resolved, incorporated                                                                     | podcastId, userId, status                                   |
| **Subscription**      | `id` (cuid) | userId (unique), stripeCustomerId, stripeSubscriptionId, stripePriceId, status, tier, creditsBalance, creditsMonthly, rolloverCredits, maxRollover | status, tier                                                |
| **CreditTransaction** | `id` (cuid) | userId, amount, type (GRANT/CONSUMPTION/REFUND/PURCHASE), podcastId, description, balanceAfter, createdAt                                          | userId, type, createdAt                                     |

### 5.3 Key Enums

| Enum                 | Values                                                                                            | Usage                                      |
| -------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `PodcastStatus`      | PENDING, DISCOVERING, EXTRACTING, SCRIPTING, GENERATING_AUDIO, STITCHING, READY, UPDATING, FAILED | Tracks podcast through generation pipeline |
| `Speaker`            | HOST, EXPERT                                                                                      | Identifies speaker in segments             |
| `InteractionStatus`  | PENDING, ANSWERING, ANSWERED, RESOLVED, INCORPORATING, INCORPORATED                               | Tracks Q&A lifecycle                       |
| `PodcastVisibility`  | PUBLIC, UNLISTED, PRIVATE                                                                         | Access control                             |
| `SubscriptionTier`   | FREE, STARTER, PRO, STUDIO                                                                        | Billing tier                               |
| `SubscriptionStatus` | PENDING, ACTIVE, PAST_DUE, CANCELED, UNPAID, TRIALING                                             | Stripe subscription state                  |
| `NotificationType`   | PODCAST_READY, PODCAST_LIKED, PODCAST_FORKED, NEW_FOLLOWER, SIMILAR_PODCAST_CREATED               | Notification categorization                |

### 5.4 Denormalized Counters

The Podcast model maintains denormalized counters (`playCount`, `likeCount`, `forkCount`, `saveCount`) that are incremented atomically via Prisma's `increment` operation. This avoids expensive COUNT queries on the social feed:

```typescript
await prisma.podcast.update({
  where: { id: podcastId },
  data: { likeCount: { increment: 1 } },
});
```

---

## 6. Authentication Flow

### 6.1 NextAuth.js v5 Configuration

Sotto uses NextAuth.js v5 with four authentication providers:

| Provider               | Use Case                           | Configuration                           |
| ---------------------- | ---------------------------------- | --------------------------------------- |
| **Email (Magic Link)** | Primary signup/login for all users | Resend email provider, 10-minute expiry |
| **Google OAuth**       | One-click login for Google users   | Google Cloud Console OAuth 2.0 client   |
| **GitHub OAuth**       | Developer-friendly login           | GitHub OAuth App                        |
| **Apple Sign In**      | Required for future iOS app        | Apple Developer Program                 |

### 6.2 Auth Flow

```
User visits /auth/login
    |
    v
Selects provider (Email / Google / GitHub / Apple)
    |
    +-- Email: enters email -> receives magic link -> clicks -> authenticated
    |
    +-- OAuth: redirected to provider -> grants access -> callback -> authenticated
    |
    v
NextAuth creates Session + Account records
    |-- If new user: creates User record with defaults (tier: FREE) + Subscription (creditsBalance: 2, tier: FREE)
    |-- If existing user: refreshes session token
    |
    v
Session cookie set (httpOnly, secure, sameSite: lax)
    |
    v
Middleware (src/middleware.ts) checks session on protected routes:
    - /dashboard/* -> requires auth
    - /create/* -> requires auth
    - /api/podcasts/* (mutating) -> requires auth
    - /api/discovery/* -> requires auth
    - /api/billing/* -> requires auth
    - /feed, /podcast/*, /profile/* -> public (read)
    - /api/feed/* -> public (read)
```

### 6.3 Session Strategy

NextAuth is configured with a database session strategy (not JWT) for the following reasons:

- Sessions can be revoked server-side (important for subscription changes)
- Session data stays in sync with User record changes
- No token size limitations
- Suitable for server-side rendering in Next.js App Router

---

## 7. Storage Strategy (Cloudflare R2)

### 7.1 Why R2

| Factor           | R2                    | AWS S3            | Why R2 Wins                                                |
| ---------------- | --------------------- | ----------------- | ---------------------------------------------------------- |
| Egress bandwidth | $0                    | $0.09/GB          | Audio files are served frequently; zero egress is critical |
| Storage cost     | $0.015/GB/month       | $0.023/GB/month   | 35% cheaper                                                |
| S3 compatibility | Full                  | Native            | Same SDK, drop-in replacement                              |
| CDN integration  | Cloudflare CDN (free) | CloudFront (paid) | Built-in global CDN                                        |

### 7.2 Storage Structure

```
sotto-audio-bucket/
├── podcasts/
│   ├── {podcastId}/
│   │   ├── audio.mp3              # Final stitched podcast (public URL)
│   │   ├── segments/
│   │   │   ├── 001.mp3            # Individual segment audio
│   │   │   ├── 002.mp3
│   │   │   └── ...
│   │   └── sfx/
│   │       ├── intro.mp3          # Sound effects
│   │       ├── transition_01.mp3
│   │       └── outro.mp3
│   └── ...
├── avatars/
│   └── {userId}.jpg               # User profile images
└── exports/
    └── {podcastId}/
        └── transcript.md          # Exported transcripts (Pro+)
```

### 7.3 Access Control

| Content Type           | Access           | Mechanism                                |
| ---------------------- | ---------------- | ---------------------------------------- |
| Public podcast audio   | Anyone           | Direct R2 public URL via Cloudflare CDN  |
| Unlisted podcast audio | Anyone with link | Direct R2 URL (not indexed, not on feed) |
| Private podcast audio  | Owner only       | Presigned URL (1-hour expiry) via API    |
| Segment audio          | Workers only     | R2 API with service credentials          |
| User avatars           | Anyone           | Direct R2 public URL                     |

### 7.4 Cost Projection

| Scale            | Audio Files | Storage | Monthly Cost |
| ---------------- | ----------- | ------- | ------------ |
| 100 podcasts     | ~1.5 GB     | 1.5 GB  | $0.02        |
| 1,000 podcasts   | ~15 GB      | 15 GB   | $0.23        |
| 10,000 podcasts  | ~150 GB     | 150 GB  | $2.25        |
| 100,000 podcasts | ~1.5 TB     | 1.5 TB  | $22.50       |

Average podcast file size: ~15 MB (10 min, 128kbps MP3).

---

## 8. Queue System (BullMQ + Redis)

### 8.1 Queue Architecture

BullMQ manages all asynchronous work through named queues. Each queue corresponds to one worker type. Redis serves as the message broker.

```
Redis (port 6379)
    |
    +-- Queue: content-extraction
    |   +-- Job: {podcastId, sourceUrl}
    |
    +-- Queue: script-generation
    |   +-- Job: {podcastId, discoveryId}
    |
    +-- Queue: audio-generation
    |   +-- Job: {podcastId, scriptId}
    |
    +-- Queue: audio-stitching
    |   +-- Job: {podcastId}
    |
    +-- Queue: interaction
    |   +-- Job: {interactionId, podcastId, question, timestamp}
    |
    +-- Queue: segment-regen
    |   +-- Job: {podcastId, interactionId}
    |
    +-- Queue: notification
        +-- Job: {userId, type, title, message, data}
```

### 8.2 Redis Connection Strategy

BullMQ requires separate Redis connections for each worker (one for the worker, one for the queue client). With 7 workers, Sotto uses 14 Redis connections plus 1 for the web application's queue client:

| Component                        | Connections | Purpose                                 |
| -------------------------------- | ----------- | --------------------------------------- |
| Web app queue client             | 1           | Enqueue jobs from API routes            |
| Worker instances (7 workers x 2) | 14          | Process jobs + internal communication   |
| Cache client                     | 1           | General caching (feed, recommendations) |
| **Total**                        | **16**      |                                         |

Redis 7 supports up to 10,000 concurrent connections by default, so this is well within limits.

### 8.3 Job Priority

| Priority Level | Queues                                                                                  | Rationale                                        |
| -------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------ |
| High (1)       | interaction                                                                             | User is waiting with podcast paused              |
| Normal (5)     | content-extraction, script-generation, audio-generation, audio-stitching, segment-regen | Standard generation pipeline                     |
| Low (10)       | notification                                                                            | Notifications can be delayed without user impact |

### 8.4 Redis Memory Management

| Data Type               | Estimated Size | TTL                                 |
| ----------------------- | -------------- | ----------------------------------- |
| Job data (per job)      | ~2 KB          | Completed: 24 hours, Failed: 7 days |
| Cache: feed page        | ~50 KB         | 5 minutes                           |
| Cache: podcast metadata | ~1 KB          | 1 hour                              |
| Cache: user profile     | ~500 bytes     | 30 minutes                          |
| Cache: recommendations  | ~10 KB         | 15 minutes                          |

Estimated Redis memory at 10,000 users: ~500 MB (well within 1 GB free tier on Upstash or a standard Redis instance).

---

## 9. API Route Architecture

### 9.1 Route Map

| Method | Route                              | Auth     | Purpose                                                 |
| ------ | ---------------------------------- | -------- | ------------------------------------------------------- |
| POST   | `/api/discovery`                   | Required | Send discovery chat message, receive streaming response |
| GET    | `/api/recommendations`             | Required | Search similar public podcasts                          |
| POST   | `/api/podcasts`                    | Required | Create new podcast                                      |
| GET    | `/api/podcasts/[id]`               | Optional | Get podcast details (public or owned)                   |
| POST   | `/api/podcasts/[id]/generate`      | Required | Start generation pipeline                               |
| POST   | `/api/podcasts/[id]/interact`      | Required | Ask a question during playback                          |
| POST   | `/api/podcasts/[id]/fork`          | Required | Fork a public podcast                                   |
| POST   | `/api/podcasts/[id]/like`          | Required | Like/unlike a podcast                                   |
| POST   | `/api/podcasts/[id]/save`          | Required | Save/unsave a podcast                                   |
| GET    | `/api/feed`                        | Public   | Public feed with search, tags, trending                 |
| GET    | `/api/users/[id]`                  | Public   | User profile                                            |
| POST   | `/api/users/[id]/follow`           | Required | Follow/unfollow a user                                  |
| POST   | `/api/billing/checkout`            | Required | Create Stripe checkout session                          |
| GET    | `/api/billing/subscription`        | Required | Get current subscription                                |
| POST   | `/api/billing/portal`              | Required | Create Stripe customer portal session                   |
| GET    | `/api/notifications`               | Required | List notifications                                      |
| PATCH  | `/api/notifications/[id]`          | Required | Mark notification as read                               |
| POST   | `/api/notifications/push/register` | Required | Register push subscription                              |
| GET    | `/api/tags`                        | Public   | List all tags                                           |
| POST   | `/api/webhooks/stripe`             | Webhook  | Handle Stripe webhook events                            |

### 9.2 API Validation

All API inputs are validated with Zod schemas defined in `src/lib/validations.ts`. Example:

```typescript
const createPodcastSchema = z.object({
  title: z.string().min(1).max(200),
  topic: z.string().min(1).max(5000),
  discoveryId: z.string().cuid(),
  visibility: z.enum(['PUBLIC', 'UNLISTED', 'PRIVATE']).default('PUBLIC'),
});

const interactSchema = z.object({
  question: z.string().min(1).max(2000),
  timestamp: z.number().min(0),
});
```

### 9.3 Rate Limiting

Rate limiting is applied at the API route level using Redis-backed sliding window counters:

| Route Group                | Limit               | Window   |
| -------------------------- | ------------------- | -------- |
| `/api/discovery`           | 30 requests/minute  | Per user |
| `/api/podcasts/*/generate` | 5 requests/hour     | Per user |
| `/api/podcasts/*/interact` | 20 requests/hour    | Per user |
| `/api/feed`                | 60 requests/minute  | Per IP   |
| `/api/billing/*`           | 10 requests/minute  | Per user |
| All other API routes       | 100 requests/minute | Per user |

---

## 10. Scaling Considerations

### 10.1 Current Architecture Limits

| Component                         | Current Limit                      | Bottleneck                      |
| --------------------------------- | ---------------------------------- | ------------------------------- |
| Web app (single Vercel instance)  | ~500 concurrent users              | Serverless function cold starts |
| Workers (single Railway instance) | ~10 concurrent podcast generations | CPU + memory for FFmpeg         |
| PostgreSQL (single instance)      | ~1,000 queries/second              | Connection pool size            |
| Redis (single instance)           | ~50,000 operations/second          | Memory (queue depth)            |
| ElevenLabs API                    | ~100 concurrent requests           | API rate limits                 |
| Claude API                        | ~50 concurrent requests            | API rate limits                 |

### 10.2 Scaling Strategy by User Count

| User Count | Architecture Change                                                          | Estimated Cost |
| ---------- | ---------------------------------------------------------------------------- | -------------- |
| 0-500      | Single server (Hetzner CPX31): web + workers + DB + Redis                    | $17/month      |
| 500-2K     | Upgrade to CPX41, separate worker process                                    | $27/month      |
| 2K-5K      | Dedicated CPU (CCX33), separate PostgreSQL instance, external Redis          | $80/month      |
| 5K-10K     | Split web and workers to separate servers, connection pooling (PgBouncer)    | $150/month     |
| 10K-50K    | Multiple worker instances, read replicas for PostgreSQL, Redis cluster       | $500/month     |
| 50K+       | Container orchestration (Kubernetes), auto-scaling workers, managed database | $2,000+/month  |

### 10.3 Performance Optimization Strategies

| Strategy                        | When to Apply | Impact                                                       |
| ------------------------------- | ------------- | ------------------------------------------------------------ |
| **PostgreSQL read replicas**    | >5K users     | Offload feed/search queries from primary                     |
| **Redis caching for feed**      | >1K users     | Cache feed pages for 5 minutes, reduce DB queries by 90%     |
| **CDN for audio**               | Immediately   | Cloudflare CDN in front of R2, global edge delivery          |
| **Connection pooling**          | >2K users     | PgBouncer to manage PostgreSQL connections                   |
| **Worker auto-scaling**         | >5K users     | Scale worker count based on queue depth                      |
| **Script caching**              | >10K users    | Cache Claude responses for near-identical discovery metadata |
| **Audio segment caching**       | >10K users    | If same text + voice + params, reuse cached audio            |
| **PostgreSQL full-text search** | MVP           | `to_tsvector` on podcast title + topic for feed search       |
| **Vector similarity search**    | >10K podcasts | pgvector extension for semantic podcast discovery            |

### 10.4 Monitoring and Observability

| Layer          | Tool                          | Metrics                                    |
| -------------- | ----------------------------- | ------------------------------------------ |
| Application    | Sentry                        | Errors, performance traces, user impact    |
| Infrastructure | Netdata / Grafana             | CPU, memory, disk, network                 |
| Database       | pg_stat_statements            | Slow queries, connection counts            |
| Queue          | BullMQ Dashboard (Bull Board) | Queue depth, processing time, failure rate |
| External APIs  | ApiUsageLog model             | Cost per service, latency, error rates     |
| User behavior  | PostHog                       | Funnel analysis, feature usage, retention  |

### 10.5 Disaster Recovery

| Scenario            | Recovery Strategy                                         | RTO        | RPO                             |
| ------------------- | --------------------------------------------------------- | ---------- | ------------------------------- |
| Server failure      | Restore from Hetzner snapshot, redeploy                   | 30 minutes | 24 hours (daily backup)         |
| Database corruption | Restore from PostgreSQL backup                            | 15 minutes | 1 hour (hourly backup at scale) |
| Redis data loss     | Workers re-process any in-flight jobs (idempotent design) | 5 minutes  | 0 (ephemeral queue data)        |
| R2 outage           | Cloudflare manages redundancy internally                  | N/A        | N/A                             |
| External API outage | Queue jobs with retry, notify users of delay              | Automatic  | 0                               |
