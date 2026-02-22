# Technical Architecture — Sotto

> **Date**: 2026-02-08
>
> **Summary**: System design for Sotto's interactive podcast platform. Covers the end-to-end data flow from user chat through script generation, verification, audio synthesis, stitching, and delivery. Details the 23-worker pipeline architecture, database schema, authentication flow, storage strategy, queue system, and scaling considerations. The architecture prioritizes async processing via BullMQ workers, keeping API routes thin and responsive while heavy AI and audio processing runs in background workers.

---

## 1. System Overview

Sotto's architecture follows a three-layer pattern: a Next.js web application handles user-facing requests, a BullMQ worker pool (23 workers) processes heavy computation asynchronously, and external services (Claude, multi-provider TTS, Cloudflare R2) provide AI and storage capabilities. Everything runs on a single Hetzner VPS via Docker Compose with Caddy as the reverse proxy.

```
                    +-------------------+
                    |   User (Browser)  |
                    +--------+----------+
                             |
                    HTTPS (Caddy)
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
                       | 23 workers  |
                       | (see §4.1)  |
                       +--+------+--+
                          |      |
                +---------+      +----------+
                |                           |
        +-------v-------+          +-------v-------+
        |   Anthropic   |          | Multi-Provider|
        |   Claude API  |          |   TTS APIs    |
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
    |-- Create Reference records for cited sources ([N] citations)
    |-- Podcast status -> VERIFYING_SCRIPT
    |-- Enqueue script-verification job
```

**Script structure**: Each turn is 2-4 sentences. A 10-minute podcast has approximately 40-60 turns. The Host asks questions, makes observations, and provides transitions. The Expert delivers explanations, examples, and analogies. Delivery directions are embedded in square brackets before each turn.

### 2.4 Phase 4: Script Verification

A "teacher" agent reviews the generated script for factual claims and sourcing quality:

```
script-verification.worker.ts
    |-- Podcast status -> VERIFYING_SCRIPT
    |-- Extract claims from script turns
    |-- Check each claim against cited references
    |-- If claims unsupported or poorly sourced:
    |   |-- Request revision from Claude (up to 3 loops)
    |   |-- Re-check revised script
    |-- If passes verification:
    |   |-- Podcast status -> VALIDATING_REFERENCES
    |   |-- Enqueue reference-validation job
    |-- If fails after 3 attempts:
    |   |-- Re-enqueue script-generation with feedback
```

### 2.5 Phase 5: Reference Validation

4-layer verification ensures source quality:

```
reference-validation.worker.ts
    |-- Podcast status -> VALIDATING_REFERENCES
    |-- For each Reference:
    |   |-- Layer 1: URL validation (HEAD request, check HTTP 200)
    |   |-- Layer 2: CrossRef DOI lookup
    |   |-- Layer 3: OpenAlex metadata enrichment
    |   |-- Layer 4: AI verification (Claude cross-check)
    |-- Set verificationStatus per reference (VERIFIED, UNVERIFIED, REPLACED, REMOVED)
    |-- Source quality filter: remove low-quality references
    |
    |-- Route based on podcast source:
    |   |-- WEB / IMPORT: Podcast status -> SCRIPT_READY (pause for user review)
    |   |-- TWITTER / API: Auto-approve, create Segments, enqueue audio-generation
```

### 2.6 Phase 6: Script Review (SCRIPT_READY Pause)

For WEB and IMPORT sources, the pipeline pauses for user review:

```
SCRIPT_READY state:
    |-- User reviews script + verified references at /podcast/{id}
    |-- Three options:
    |   |-- Edit: PATCH /api/podcasts/[id]/script (save edits, stay in SCRIPT_READY)
    |   |-- Approve: POST /api/podcasts/[id]/script/approve
    |   |   |-- Creates Segment records for each turn
    |   |   |-- Enqueue audio-generation job
    |   |-- Regenerate: POST /api/podcasts/[id]/script/regenerate
    |       |-- Re-enqueue script-generation
```

### 2.7 Phase 7: Audio Generation

```
audio-generation.worker.ts
    |-- Load all Segment records for podcast (ordered)
    |-- Select voice pair from voice pool (deterministic based on podcast ID)
    |   - HOST voice: selected from 8 host voices
    |   - EXPERT voice: selected from 8 expert voices (contrasting gender/accent)
    |
    |-- Resolve TTS provider via resolveTtsProvider():
    |   - Check user's BYOK TTS key (UserTtsKey)
    |   - Fall back to platform TTS key if no BYOK
    |   - Supports: ElevenLabs, OpenAI, PlayHT, Cartesia, Hume
    |
    |-- Process segments in parallel (concurrency: 15)
    |   For each segment:
    |   |-- Map delivery direction to TTS parameters
    |   |-- Call resolved TTS provider API
    |   |-- Receive audio buffer (MP3)
    |   |-- Upload segment audio to R2: podcasts/{podcastId}/segments/{order}.mp3
    |   |-- FFprobe: measure actual duration
    |   |-- Update Segment record: audioUrl, duration
    |   |-- Log cost to ApiUsageLog
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

**Parallelism**: Audio generation is the most time-consuming step. With 15 concurrent TTS API calls, a 50-segment podcast completes much faster than sequential processing. Each segment is independent, so parallelism is safe.

### 2.8 Phase 8: Audio Stitching

```
audio-stitching.worker.ts
    |-- Load all Segment records with audioUrls (ordered)
    |-- Download all segment audio files from R2 to temp directory
    |-- Download sound effect files from R2
    |
    |-- Build FFmpeg filter graph:
    |   1. Concatenate: intro + segments (in order) + outro
    |   2. Insert transition sounds with adelay positioning
    |   3. Apply crossfade (100ms) between consecutive segments
    |   4. Apply loudness normalization (EBU R128, target: -16 LUFS)
    |   5. Output: MP3, 128kbps, 44.1kHz
    |
    |-- Execute FFmpeg command
    |-- Duration hard check (verify against target)
    |-- Calculate final duration and file size
    |-- Upload final audio to R2: podcasts/{podcastId}/audio.mp3
    |-- Create PodcastVersion record (immutable snapshot)
    |-- Update Podcast record: audioUrl, duration, fileSize, currentVersion
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

### 2.9 Phase 9: Notification and Delivery

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
    |
    |-- If source == TWITTER:
    |   |-- Enqueue twitter-reply job
    |-- If source == TELEGRAM:
    |   |-- Enqueue telegram-reply job
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
    |-- Check rate limit (60 interactions/hour)
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
    |-- Call Claude to generate natural HOST segment addressing Q&A
    |
    |-- TTS via resolveTtsProvider (matching podcast voice + provider config)
    |-- Transactional insert: new segment at correct position
    |-- Queue audio-stitching (skipSfx flag — no re-generated SFX)
    |-- Re-concat + update startTimes
    |-- Interaction status -> INCORPORATED
    |-- Podcast status -> READY
```

---

## 4. Worker Pipeline Architecture

### 4.1 Worker Types and Configuration

Sotto runs **23 BullMQ workers**, each with its own Redis connection pair:

| Worker                  | Queue Name                | Concurrency | Purpose                                                              |
| ----------------------- | ------------------------- | ----------- | -------------------------------------------------------------------- |
| Content Extraction      | `content-extraction`      | 2           | URL/PDF → extracted text for script context                          |
| Script Generation       | `script-generation`       | 2           | Discovery metadata → 2-voice script with `[N]` citations            |
| Script Verification     | `script-verification`     | 2           | Claim extraction + sourcing check (≤3 revision loops)                |
| Reference Validation    | `reference-validation`    | 2           | 4-layer source verification (URL, CrossRef, OpenAlex, AI)           |
| Audio Generation        | `audio-generation`        | 15          | Segment text → TTS via `resolveTtsProvider` (5 providers, BYOK)     |
| Audio Stitching         | `audio-stitching`         | 1           | FFmpeg concat + SFX overlay + normalization → final.mp3              |
| Interaction             | `interactions`            | 3           | User Q&A → Claude answer + segmentOrder computation                  |
| Segment Regeneration    | `segment-regeneration`    | 2           | Q&A incorporation → TTS + transactional insert → re-stitch          |
| Notification            | `notifications`           | 5           | In-app + Web Push notifications                                      |
| PDF Generation          | `pdf-generation`          | 2           | Podcast → pdfmake PDF → R2 upload                                    |
| Twitter Mentions        | `twitter-mentions`        | 1           | Poll @sottofm mentions → parse intent → create podcast               |
| Twitter Reply           | `twitter-reply`           | 2           | Podcast ready → compose reply → post to Twitter                      |
| Twitter Auto-Tweet      | `twitter-auto-tweet`      | 1           | Interpolate template → post promotional tweet                        |
| Twitter Trend Poll      | `twitter-trend-poll`      | 1           | Search trending tweets → score + deduplicate → create podcast        |
| Admin Thread-to-Podcast | `admin-thread-to-podcast` | 1           | Tweet URL → fetch thread → create podcast as @sotto                  |
| Telegram Bot            | `telegram-bot`            | 1           | Process Telegram bot updates → parse commands → create podcast       |
| Telegram Reply          | `telegram-reply`          | 2           | Podcast ready → reply in Telegram chat with link                     |
| Audio Import            | `audio-import`            | 2           | Import existing audio → transcribe → create script + segments        |
| Event Ingestion         | `event-ingestion`         | 5           | Ingest social activity events for the activity feed                  |
| Feature Computation     | `feature-computation`     | 2           | ML feature extraction for recommendation engine                      |
| Data Export             | `data-export`             | 1           | User data export (GDPR compliance)                                   |
| Key Validation          | `key-validation`          | 1           | Periodic BYOK API key validation (24h cycle)                         |
| Content Moderation      | `content-moderation`      | 3           | OpenAI Moderation API check on generated scripts                     |

**Interaction worker**: In addition to generating the answer via Claude, the interaction worker computes `segmentOrder` — mapping the question's playback timestamp to the corresponding segment order number — and writes it alongside the answer to the Interaction record.

### 4.2 Worker Orchestration

The worker entry point (`src/workers/index.ts`) initializes all 23 workers, each with its own Redis connection pair (BullMQ requirement). Workers are orchestrated through job chaining — each worker enqueues the next job upon completion:

```
content-extraction → script-generation → script-verification → reference-validation → [SCRIPT_READY]
                                              ↑       │                                      │
                                              │  FAIL (≤3)                         WEB/IMPORT: pause
                                              └───────┘                            TWITTER/API: auto-approve
                                                                                         │
                          audio-generation (×N, parallel) ← ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┘
                                    │
                          audio-stitching → notification → pdf-generation (on-demand)
                                    │                            │
                          twitter-reply (if TWITTER)             └→ telegram-reply (if TELEGRAM)

interaction → segment-regeneration → audio-stitching (skipSfx) → READY

twitter-mentions (polls every 60s) → creates Podcast → kicks off pipeline
twitter-trend-poll (polls every 2hrs) → creates Podcast as @sotto → kicks off pipeline
telegram-bot (polls every 35s) → creates Podcast → kicks off pipeline
content-moderation → runs on generated scripts before audio generation
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
| TTS rate limit (429)        | Exponential backoff: 5s, 15s, 45s                          |
| Claude API timeout          | Retry with same payload, max 2 retries                     |
| FFmpeg processing failure   | Retry once, then mark podcast as FAILED                    |
| R2 upload failure           | Retry with exponential backoff, max 3 retries              |
| Unrecoverable error         | Mark podcast as FAILED, create error notification for user |

Failed jobs trigger the centralized failure handler in `queue.ts`, which records `failedAtStatus` and sets podcast status to `FAILED`, then queues a notification.

### 4.5 Progress Reporting

Workers report progress via `job.updateProgress(percentage)`. The client polls `GET /api/podcasts/{id}` to display real-time progress:

| Status                 | Progress Display                         |
| ---------------------- | ---------------------------------------- |
| PENDING                | "Queued..."                              |
| DISCOVERING            | "Chatting..." (real-time in UI)          |
| EXTRACTING             | "Reading your source..."                 |
| SCRIPTING              | "Writing the script..."                  |
| VERIFYING_SCRIPT       | "Verifying claims..."                    |
| VALIDATING_REFERENCES  | "Checking sources..."                    |
| SCRIPT_READY           | "Script ready for review"                |
| GENERATING_AUDIO       | "Generating voices... (segment 3 of 48)" |
| STITCHING              | "Putting it all together..."             |
| READY                  | "Your podcast is ready!"                 |
| UPDATING               | "Updating with your feedback..."         |
| IMPORTING              | "Importing podcast..."                   |
| TRANSCRIBING           | "Transcribing audio..."                  |
| FAILED                 | "Something went wrong. Retry?"           |

---

## 5. Database Schema Overview

### 5.1 Entity Relationship Summary

```
User ──< Podcast ──< Segment
  |         |──── Script (1:1)
  |         |──── Discovery (1:1) ──< DiscoveryMessage
  |         |──< Interaction ──< InteractionVote
  |         |──< Reference
  |         |──< Like
  |         |──< Save
  |         |──< Comment (threaded, self-referential via parentId)
  |         |──< PodcastTag >── Tag
  |         |──< PodcastVersion ──< PodcastVersionSegment
  |         |──< VoicePurchase
  |         |──< Job
  |         └── Podcast (forkedFrom, self-referential)
  |
  |──< Follow (follower/following, self-referential through User)
  |──< UserAiKey (BYOK: Anthropic, OpenAI — AES-256-GCM encrypted)
  |──< UserTtsKey (BYOK: ElevenLabs, OpenAI, PlayHT, Cartesia, Hume)
  |──< VoiceClone ──< VoicePurchase
  |──< Collection ──< CollectionItem
  |──< Activity
  |──< Notification
  |──< PushSubscription
  |──< ApiKey (developer API keys)
  |──< ApiUsageLog
  |── Team (membership + ownership)
```

### 5.2 Core Models

| Model                | Primary Key | Key Fields                                                                                                                    | Indexes                                                     |
| -------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **User**             | `id` (cuid) | email (unique), name, image, bio, role (USER/CREATOR/ADMIN), twitterHandle, stripeAccountId                                  | teamId, role                                                |
| **Podcast**          | `id` (cuid) | userId, title, topic, status, audioUrl, duration, visibility, forkedFromId, source (WEB/TWITTER/API), currentVersion, commentCount | userId, status, visibility, createdAt, playCount, likeCount |
| **Discovery**        | `id` (cuid) | podcastId (unique), userId, topic, depth, audienceLevel, focusAreas[], tone, durationTarget, sourceUrl, sourceContent         | userId                                                      |
| **DiscoveryMessage** | `id` (cuid) | discoveryId, role, content, chips (JSON)                                                                                      | discoveryId                                                 |
| **Script**           | `id` (cuid) | podcastId (unique), turns (JSON), markdown, context, version                                                                  |                                                             |
| **Segment**          | `id` (cuid) | podcastId, speaker (HOST/EXPERT), text, audioUrl, order, startTime, duration, version                                         | podcastId, order                                            |
| **Reference**        | `id` (cuid) | podcastId, number, title, authors, year, url, type, verificationStatus                                                        | podcastId                                                   |
| **Interaction**      | `id` (cuid) | podcastId, userId, status, question, timestamp, answer, helpful, segmentOrder, visibility (PUBLIC/PRIVATE), upvoteCount       | podcastId, userId, status                                   |
| **UserAiKey**        | `id` (cuid) | userId, provider (ANTHROPIC/OPENAI), encryptedKey, isValid — `@@unique([userId, provider])`                                   | userId                                                      |
| **UserTtsKey**       | `id` (cuid) | userId, provider (ELEVENLABS/OPENAI/PLAYHT/CARTESIA/HUME), encryptedKey, isValid — `@@unique([userId, provider])`             | userId                                                      |
| **VoiceClone**       | `id` (cuid) | userId, name, provider, externalVoiceId, priceInCents                                                                         | userId                                                      |
| **VoicePurchase**    | `id` (cuid) | buyerId, voiceCloneId, podcastId, amountCents, platformFeeCents, status (authorized/captured/cancelled/refunded)              | buyerId, voiceCloneId                                       |
| **FreeTierConfig**   | `id` (cuid) | aiProvider, aiModel, ttsProvider, generationLimit — singleton row                                                              |                                                             |

### 5.3 Key Enums

| Enum                | Values                                                                                                                              | Usage                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `PodcastStatus`     | PENDING, DISCOVERING, EXTRACTING, SCRIPTING, VERIFYING_SCRIPT, VALIDATING_REFERENCES, SCRIPT_READY, GENERATING_AUDIO, STITCHING, READY, UPDATING, FAILED, IMPORTING, TRANSCRIBING | Tracks podcast through generation pipeline |
| `Speaker`           | HOST, EXPERT                                                                                                                        | Identifies speaker in segments             |
| `InteractionStatus` | PENDING, ANSWERING, ANSWERED, RESOLVED, INCORPORATING, INCORPORATED                                                                 | Tracks Q&A lifecycle                       |
| `PodcastVisibility` | PUBLIC, UNLISTED, PRIVATE                                                                                                           | Access control                             |
| `PodcastSource`     | WEB, TWITTER, API, IMPORT                                                                                                           | How podcast was created                    |
| `UserRole`          | USER, CREATOR, ADMIN                                                                                                                | Authorization level                        |
| `NotificationType`  | PODCAST_READY, PODCAST_LIKED, PODCAST_FORKED, NEW_FOLLOWER, SIMILAR_PODCAST_CREATED, COMMENT_POSTED                                 | Notification categorization                |
| `ActivityType`      | PODCAST_CREATED, FORKED, LIKED, USER_FOLLOWED, COMMENT_POSTED, COLLECTION_CREATED                                                   | Social activity feed events                |

### 5.4 Denormalized Counters

The Podcast model maintains denormalized counters (`playCount`, `likeCount`, `forkCount`, `saveCount`, `commentCount`) that are incremented atomically via Prisma's `increment` operation. This avoids expensive COUNT queries on the social feed:

```typescript
await prisma.podcast.update({
  where: { id: podcastId },
  data: { likeCount: { increment: 1 } },
});
```

---

## 6. Authentication Flow

### 6.1 NextAuth.js v5 Configuration

Sotto uses NextAuth.js v5 with four OAuth authentication providers (no email/password):

| Provider          | Use Case                           | Configuration                         |
| ----------------- | ---------------------------------- | ------------------------------------- |
| **Google OAuth**  | One-click login for Google users   | Google Cloud Console OAuth 2.0 client |
| **GitHub OAuth**  | Developer-friendly login           | GitHub OAuth App                      |
| **Twitter OAuth** | Social login for Twitter users     | Twitter Developer App (OAuth 2.0)     |
| **Apple Sign In** | Required for iOS app               | Apple Developer Program               |

### 6.2 Auth Flow

```
User visits /auth/login
    |
    v
Selects provider (Google / GitHub / Twitter / Apple)
    |
    +-- OAuth: redirected to provider -> grants access -> callback -> authenticated
    |
    v
NextAuth creates Session + Account records
    |-- If new user: creates User record with defaults (role: USER)
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

- Sessions can be revoked server-side
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
│   │   ├── transcript.pdf         # Generated PDF transcript
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
    └── {userId}/
        └── data-export.zip        # GDPR data export
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

BullMQ manages all asynchronous work through 23 named queues. Each queue corresponds to one worker type. Redis serves as the message broker.

```
Redis (port 6379)
    |
    +-- Queue: content-extraction
    +-- Queue: script-generation
    +-- Queue: script-verification
    +-- Queue: reference-validation
    +-- Queue: audio-generation
    +-- Queue: audio-stitching
    +-- Queue: interactions
    +-- Queue: segment-regeneration
    +-- Queue: notifications
    +-- Queue: pdf-generation
    +-- Queue: twitter-mentions (repeatable, every 60s)
    +-- Queue: twitter-reply
    +-- Queue: twitter-auto-tweet
    +-- Queue: twitter-trend-poll (repeatable, every 2hrs)
    +-- Queue: admin-thread-to-podcast
    +-- Queue: telegram-bot (repeatable, every 35s)
    +-- Queue: telegram-reply
    +-- Queue: audio-import
    +-- Queue: event-ingestion
    +-- Queue: feature-computation
    +-- Queue: data-export
    +-- Queue: key-validation (repeatable, every 24hrs)
    +-- Queue: content-moderation
```

### 8.2 Redis Connection Strategy

BullMQ requires separate Redis connections for each worker (one for the worker, one for the queue client). With 23 workers, Sotto uses ~48 Redis connections:

| Component                         | Connections | Purpose                                 |
| --------------------------------- | ----------- | --------------------------------------- |
| Web app queue client              | 1           | Enqueue jobs from API routes            |
| Worker instances (23 workers × 2) | 46          | Process jobs + internal communication   |
| Cache client                      | 1           | General caching (feed, recommendations) |
| **Total**                         | **~48**     |                                         |

Redis 7 supports up to 10,000 concurrent connections by default, so this is well within limits.

### 8.3 Job Priority

| Priority Level | Queues                                                                                                               | Rationale                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| High (1)       | interaction                                                                                                          | User is waiting with podcast paused              |
| Normal (5)     | content-extraction, script-generation, script-verification, reference-validation, audio-generation, audio-stitching, segment-regeneration, audio-import | Standard generation pipeline |
| Low (10)       | notification, event-ingestion, feature-computation, pdf-generation, data-export, content-moderation                  | Background tasks, can be delayed                 |

### 8.4 Redis Memory Management

| Data Type               | Estimated Size | TTL                                 |
| ----------------------- | -------------- | ----------------------------------- |
| Job data (per job)      | ~2 KB          | Completed: 24 hours, Failed: 7 days |
| Cache: feed page        | ~50 KB         | 5 minutes                           |
| Cache: podcast metadata | ~1 KB          | 1 hour                              |
| Cache: user profile     | ~500 bytes     | 30 minutes                          |
| Cache: recommendations  | ~10 KB         | 15 minutes                          |

Estimated Redis memory at 10,000 users: ~500 MB (well within the 512MB default Docker allocation, increase as needed).

---

## 9. API Route Architecture

### 9.1 Route Map

| Method | Route                                       | Auth     | Purpose                                                  |
| ------ | ------------------------------------------- | -------- | -------------------------------------------------------- |
| POST   | `/api/discovery`                            | Required | Send discovery chat message, receive streaming response  |
| GET    | `/api/recommendations`                      | Required | Search similar public podcasts                           |
| POST   | `/api/podcasts`                             | Required | Create new podcast                                       |
| GET    | `/api/podcasts/[id]`                        | Optional | Get podcast details (public or owned)                    |
| POST   | `/api/podcasts/[id]/generate`               | Required | Start generation pipeline                                |
| PATCH  | `/api/podcasts/[id]/script`                 | Required | Edit script (at SCRIPT_READY)                            |
| POST   | `/api/podcasts/[id]/script/approve`         | Required | Approve script, proceed to audio generation              |
| POST   | `/api/podcasts/[id]/script/regenerate`      | Required | Regenerate script from scratch                           |
| POST   | `/api/podcasts/[id]/interact`               | Required | Ask a question during playback                           |
| GET    | `/api/podcasts/[id]/interact/[iid]`         | Required | Get single interaction (polling for answer)              |
| PATCH  | `/api/podcasts/[id]/interact/[iid]/resolve` | Required | Resolve interaction with helpful/unhelpful feedback      |
| POST   | `/api/podcasts/[id]/interact/[iid]/incorporate` | Required | Incorporate Q&A into podcast                         |
| GET    | `/api/podcasts/[id]/knowledge-gaps`         | Required | Knowledge gap aggregation by segment (owner/admin)       |
| GET    | `/api/podcasts/[id]/download`               | Public   | Download podcast audio (Content-Disposition: attachment) |
| POST   | `/api/podcasts/[id]/fork`                   | Required | Fork a public podcast                                    |
| POST   | `/api/podcasts/[id]/like`                   | Required | Like/unlike a podcast                                    |
| POST   | `/api/podcasts/[id]/save`                   | Required | Save/unsave a podcast                                    |
| GET    | `/api/feed`                                 | Public   | Public feed with search, tags, trending                  |
| GET    | `/api/users/[id]`                           | Public   | User profile                                             |
| GET    | `/api/users/[id]/rss`                       | Public   | Per-creator RSS 2.0 feed (public podcasts)               |
| POST   | `/api/users/[id]/follow`                    | Required | Follow/unfollow a user                                   |
| GET    | `/api/users/handle/[handle]/rss`            | Public   | Per-creator RSS feed resolved by handle                  |
| GET    | `/api/oembed`                               | Public   | oEmbed 1.0 JSON for podcast embeds                       |
| GET    | `/api/billing/usage`                        | Required | BYOK key status + usage stats                            |
| POST   | `/api/billing/keys`                         | Required | Add/update BYOK API keys                                 |
| GET    | `/api/notifications`                        | Required | List notifications                                       |
| PATCH  | `/api/notifications/[id]`                   | Required | Mark notification as read                                |
| POST   | `/api/notifications/push/register`          | Required | Register push subscription                               |
| GET    | `/api/tags`                                 | Public   | List all tags                                            |
| POST   | `/api/webhooks/stripe`                      | Webhook  | Handle Stripe Connect webhook events                     |

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

Rate limiting is applied at the API route level using Redis-backed sliding window counters. No subscription tiers or credits — abuse prevention only:

| Route Group                | Limit                | Window   |
| -------------------------- | -------------------- | -------- |
| `/api/discovery`           | 30 requests/minute   | Per user |
| `/api/podcasts/*/generate` | 20 generations/hour  | Per user |
| Generation daily cap       | 100 generations/day  | Per user |
| `/api/podcasts/*/interact` | 60 interactions/hour | Per user |
| `/api/feed`                | 60 requests/minute   | Per IP   |
| All other API routes       | 100 requests/minute  | Per user |

---

## 10. Scaling Considerations

### 10.1 Current Architecture Limits

| Component                              | Current Limit                      | Bottleneck                   |
| -------------------------------------- | ---------------------------------- | ---------------------------- |
| Web app (Hetzner CX32, Docker)         | ~500 concurrent users              | CPU + memory (8GB shared)    |
| Workers (same VPS, 23 workers)         | ~10 concurrent podcast generations | CPU + memory for FFmpeg      |
| PostgreSQL (Docker, single instance)   | ~1,000 queries/second              | Connection pool size         |
| Redis (Docker, 512MB)                  | ~50,000 operations/second          | Memory (queue depth)         |
| TTS APIs (multi-provider, BYOK)        | Per-user rate limits               | Provider API rate limits     |
| Claude API                             | ~50 concurrent requests            | API rate limits              |

### 10.2 Scaling Strategy by User Count

| User Count | Architecture Change                                                          | Estimated Cost |
| ---------- | ---------------------------------------------------------------------------- | -------------- |
| 0-500      | Single server (Hetzner CX32): web + workers + DB + Redis                     | $8/month       |
| 500-2K     | Upgrade to CPX41, separate worker process                                    | $21/month      |
| 2K-5K      | Dedicated CPU (CCX33), separate PostgreSQL instance, external Redis          | $80/month      |
| 5K-10K     | Split web and workers to separate servers, connection pooling (PgBouncer)    | $150/month     |
| 10K-50K    | Multiple worker instances, read replicas for PostgreSQL, Redis cluster       | $500/month     |
| 50K+       | Container orchestration (Kubernetes), auto-scaling workers, managed database | $2,000+/month  |

**Key insight**: The BYOK model means platform AI/TTS costs stay low regardless of user count. Infrastructure scaling is the primary cost driver, not API usage.

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
| **ML recommendations**          | >1K podcasts  | Feature computation worker + recommendation engine           |

### 10.4 Monitoring and Observability

| Layer          | Tool                          | Metrics                                    |
| -------------- | ----------------------------- | ------------------------------------------ |
| Application    | Sentry                        | Errors, performance traces, user impact    |
| Infrastructure | Netdata / Grafana             | CPU, memory, disk, network                 |
| Database       | pg_stat_statements            | Slow queries, connection counts            |
| Queue          | BullMQ Dashboard (Bull Board) | Queue depth, processing time, failure rate |
| External APIs  | ApiUsageLog model             | Cost per service, latency, error rates     |
| User behavior  | PostHog                       | Funnel analysis, feature usage, retention  |
| Content safety | Content Moderation worker     | Flagged content, false positive rate       |

### 10.5 Disaster Recovery

| Scenario            | Recovery Strategy                                         | RTO        | RPO                             |
| ------------------- | --------------------------------------------------------- | ---------- | ------------------------------- |
| Server failure      | Restore from Hetzner snapshot, redeploy                   | 30 minutes | 24 hours (daily backup)         |
| Database corruption | Restore from PostgreSQL backup                            | 15 minutes | 1 hour (hourly backup at scale) |
| Redis data loss     | Workers re-process any in-flight jobs (idempotent design) | 5 minutes  | 0 (ephemeral queue data)        |
| R2 outage           | Cloudflare manages redundancy internally                  | N/A        | N/A                             |
| External API outage | Queue jobs with retry, notify users of delay              | Automatic  | 0                               |

---

## 11. Additional Systems

### 11.1 Telegram Bot Integration

The `@SottoFMBot` Telegram bot allows users to create podcasts via chat:

- `telegram-bot` worker polls for updates every 35s
- Parses commands and natural language intent via Claude
- Creates podcasts and kicks off the standard pipeline
- `telegram-reply` worker sends podcast link back to chat when ready

### 11.2 Content Moderation

The `content-moderation` worker uses OpenAI's Moderation API to check generated scripts for harmful content before audio generation. Flagged content is logged and can be reviewed by admins.

### 11.3 ML Recommendations

The `feature-computation` worker extracts features from podcasts (topic embeddings, engagement signals, creator graphs) that power the recommendation engine. Combined with pgvector for semantic similarity search on podcast discovery.
