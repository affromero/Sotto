# src/lib/ — Core Libraries

All shared business logic and external service integrations live here.

## File Index

| File | Purpose | External Service |
| --- | --- | --- |
| `prisma.ts` | Database client (PostgreSQL) | Prisma ORM |
| `redis.ts` | Redis connections, cache helpers, rate limiting | Redis / ioredis |
| `queue.ts` | BullMQ job queues (23 types), worker creation | BullMQ + Redis |
| `auth.ts` | NextAuth config, OAuth providers (Google, GitHub, Twitter, Apple), role system (USER/CREATOR/ADMIN), `ADMIN_EMAILS` auto-assignment | NextAuth v5 |
| `admin-emails.ts` | Admin email list loader from `config/admins.json`, `isAdminEmail()` check | Filesystem |
| `auth-guards.ts` | Suspension check for write-path API routes (`checkSuspension()`) | Pure utility |
| `claude.ts` | Anthropic Claude client (streaming + non-streaming), provider-aware (`AI_PROVIDER`) | Anthropic API / Claude CLI |
| `claude-code-client.ts` | Claude Code CLI wrapper (`claude -p`): serialize messages, execute, stream | Claude CLI (`claude`) |
| `elevenlabs.ts` | ElevenLabs TTS client, voice ID mapping | ElevenLabs API |
| `fal-voice-clone.ts` | Fal.ai voice cloning via Qwen3-TTS: upload audio to R2, call clone-voice endpoint, return speaker embedding URL | Fal API + R2 |
| `stripe.ts` | Stripe SDK client, `PLATFORM_FEE_PERCENT` (10%), flat feature limits | Stripe API |
| `voice-pricing.ts` | Voice marketplace pricing: `computeVoiceCharges()`, `createVoicePayment()`, `captureVoicePayment()`, `cancelVoicePayment()`, `capturePodcastPayments()`, `cancelPodcastPayments()`, `checkFreeAccess()` | Uses `prisma.ts`, `stripe.ts` |
| `r2.ts` | Cloudflare R2 file storage (upload, download, presign) | AWS S3 SDK → R2 |
| `duration.ts` | Centralized duration constants (WPM, chars/sec, tolerance) & helpers (word↔minute, bounds, estimation) | Pure utility |
| `discovery-agent.ts` | Chat-based discovery: system prompt, chip parsing, metadata extraction | Uses `claude.ts` |
| `script-generator.ts` | 2-voice podcast script generation with `[N]` citations + revision with feedback | Uses `claude.ts` |
| `script-verifier.ts` | Claude-based "teacher" agent: extracts claims, evaluates sourcing, enforces duration limits | Uses `claude.ts` |
| `reference-validator.ts` | Source quality pre-filter + 4-layer verification: URL HEAD, CrossRef DOI, OpenAlex title, Claude AI | fetch, `claude.ts` |
| `script-updater.ts` | Citation cleanup + renumbering when references are removed after verification | Pure utility |
| `segment-creator.ts` | Shared utility: create Segment records from script turns and queue audio generation jobs (used by reference-validation, script approve endpoint) | Uses `prisma.ts`, `queue.ts` |
| `citation-parser.tsx` | Parse `[N]` citation markers in text → React CitationMarker components | React |
| `pdf-generator.ts` | Generate academic-style PDF transcripts with references via pdfmake | pdfmake |
| `audio-stitcher.ts` | FFmpeg segment concatenation + crossfades + SFX overlay (`adelay`, `duration=first`) + loudness normalization. `SfxInsert` includes `delayMs` for positioning. `skipSfx` flag bypasses SFX on re-stitch. | FFmpeg (CLI) |
| `byok.ts` | Multi-provider BYOK key management: encrypt/decrypt (AES-256-GCM), store/retrieve via `UserTtsKey` + `UserAiKey` models, validate keys per provider | Uses `prisma.ts` |
| `byok-errors.ts` | BYOK job failure classifier: `classifyError()` → `auth_invalid`, `insufficient_credits`, `rate_limited`, `provider_error`; `isKeyInvalidationError()`, `userMessage()` | Pure utility |
| `content-parser.ts` | Thin re-export wrapper (deprecated) — delegates to `extractors/` | — |
| `extractors/` | Multi-layer content extraction: Readability + cheerio HTML, pdf-parse PDF, YouTube transcript. Facade via `extractContent(url)` and `extractFromPdfBuffer(buffer)`, returns `ExtractedContent` | jsdom, @mozilla/readability, cheerio, fetch |
| `recommendations.ts` | Search similar public podcasts (PostgreSQL full-text) | Uses `prisma.ts` |
| `recommendation-engine.ts` | ML-powered recommendation engine: daily picks, explore, trending categories | Uses `prisma.ts`, `providers/ml.ts` |
| `push-notifications.ts` | Web Push API: send to user devices, clean expired subs | web-push |
| `subscription.ts` | (Simplified) Usage queries, generation counts — no tiers or credits | Uses `prisma.ts` |
| `validations.ts` | Zod schemas for all API input validation (includes addToAllowlistSchema, userSearchSchema) | Zod |
| `validations/` | Additional Zod schemas: `events.ts` (behavioral event validation) | Zod |
| `logger.ts` | Structured logging with levels (debug/info/warn/error) | Console |
| `notifications.ts` | In-app notification helpers | Uses `prisma.ts` |
| `twitter.ts` | Twitter API v2 client (mentions, tweets, replies, OAuth 1.0a) | Twitter API v2 |
| `tweet-parser.ts` | Claude-based tweet intent extraction (topic, title, depth, tone) | Uses `claude.ts` |
| `telegram.ts` | Telegram Bot API client (send messages, get updates, inline keyboards) | Telegram Bot API |
| `telegram-parser.ts` | Claude-based Telegram message intent extraction (topic, title, depth, tone, sourceUrl) | Uses `claude.ts` |
| `voice-pool.ts` | Unified voice pool: 16 curated voices with per-provider IDs, deterministic `selectVoicePair(podcastId)` hash, `resolveVoiceId()`, `findByVoiceId()` | Pure utility |
| `pipeline-resume.ts` | Smart resume: `markPodcastFailed(podcastId)` records `failedAtStatus`, `determineResumePoint(podcastId)` inspects existing data (Script, Segments, References) and returns the optimal pipeline restart step | Uses `prisma.ts` |
| `api-keys.ts` | API key generation, hashing, validation | crypto |
| `tag-icons.tsx` | Tag slug → SVG icon mapping (12 categories), `TagIcon` component, `ONBOARDING_TAG_SLUGS` array | React (SVG) |
| `taste-quiz.ts` | Taste quiz + Inspire Me: `generateQuestions()` for onboarding, `generateForYouQuestions()` (interest-based, no web search), `generateNewsQuestions()` (current events, web search) | Anthropic API + `redis.ts` |
| `handles.ts` | Handle validation, availability checks, unique generation (reserved handles, format validation) | Uses `prisma.ts` |
| `rss.ts` | `generateCreatorRssFeed(userId)`: RSS 2.0 XML with iTunes namespace for user's public podcasts | Uses `prisma.ts` |
| `free-tier-config.ts` | `getFreeTierConfig()` reads singleton FreeTierConfig row; `setFreeTierConfig()` for admin updates | Uses `prisma.ts` |
| `twitter-config.ts` | `getTwitterConfig()` reads singleton TwitterConfig row (auto-tweet thresholds, trend polling, template); `setTwitterConfig()` for admin updates | Uses `prisma.ts` |
| `twitter-auto-tweet.ts` | `checkAutoTweetThreshold(podcastId)` — fire-and-forget after like/fork/play; `manualTweet(podcastId)` — admin-triggered tweet | Uses `prisma.ts`, `twitter-config.ts`, `queue.ts` |
| `generation-gate.ts` | `checkGenerationGate(userId)`: BYOK check + free tier counter; `tryIncrementFreeGeneration()`: atomic SQL increment; `getFreeTierStatus()` for display | Uses `prisma.ts`, `byok.ts` |
| `cost-monitor.ts` | Per-provider cost tracking from ApiUsageLog: daily/weekly/monthly breakdowns, per-category aggregation | Uses `prisma.ts` |
| `traffic-report.ts` | Traffic report builder: 70+ aggregation queries → structured JSON for `/api/admin/traffic-report` | Uses `prisma.ts`, `cost-monitor.ts`, `free-tier-config.ts` |
| `revenue-metrics.ts` | Revenue aggregation: `getRevenueOverview()`, `getDailyRevenueTrend()`, `getTopSellingVoices()`, `getRevenueByStatus()`, `getMarketplaceHealth()` — voice marketplace | Uses `prisma.ts` |
| `engagement-metrics.ts` | Engagement queries: `getEngagementOverview()`, `getDailyEngagementTrend()`, `getTopLiked/Forked/Commented()`, `getInteractionStats()` — social metrics | Uses `prisma.ts` |
| `playback-metrics.ts` | Playback analytics: `getPlaybackOverview()`, `getSpeedDistribution()`, `getCompletionDistribution()`, `getDailyListenHours()` — listening data | Uses `prisma.ts` |
| `funnel-metrics.ts` | Conversion funnel: `getFreeTierFunnel()`, `getByokAdoption()`, `getPipelineHealth()` — BYOK conversion + pipeline health | Uses `prisma.ts` |
| `retention-metrics.ts` | Retention: `getDAU_WAU_MAU()`, `getDailyActiveUsers()`, `getRetentionCohorts()` — active users + weekly cohort heatmap (filters null userId) | Uses `prisma.ts` |
| `detect-urls.ts` | URL detection in message strings (client-safe, no server dependencies) | Pure utility |
| `embeddings.ts` | Embedding provider abstraction (384-dim): stub hash-based for dev, swap to `text-embedding-3-small` | Pure utility (swappable) |
| `event-buffer.ts` | Client-side behavioral event buffer: 5s flush / 50-event cap, `sendBeacon` on unload | `'use client'` |
| `import-metadata-generator.ts` | Claude-based title + topic generation from imported audio transcripts | Uses `claude.ts` |
| `language-detect.ts` | Language detection via franc-min → ISO 639-1 code | franc-min |
| `moderation.ts` | OpenAI Moderation API client: per-category thresholds, Redis caching (10min TTL) | OpenAI Moderation API, `redis.ts` |
| `user-moderation.ts` | Admin user moderation actions: warn, suspend, ban, unban, unsuspend, remove content | Uses `prisma.ts` |
| `podcast-gradient.ts` | Deterministic gradient generation from podcast ID (12 brand palettes) | Pure utility |
| `safety-prompts.ts` | Reusable LLM safety fragments: `CONTENT_SAFETY_INSTRUCTIONS`, `INPUT_SANITIZATION_INSTRUCTIONS`, `MATURE_AUDIENCE_GUIDANCE` | Pure constants |
| `slugify.ts` | URL-safe tag slug generator: `generateTagSlug(name)` (50 char cap) | Pure utility |
| `theme-script.ts` | Inline dark mode init script (`THEME_INIT_SCRIPT`) — prevents flash on page load | Pure utility |
| `topic-tagger.ts` | Keyword-based topic tag matcher: maps topics to tag slugs (deterministic, no AI) | Pure utility |
| `transcript-parser.ts` | Transcript parser (SRT, VTT, plain text) → `ParsedSegment[]` with speaker diarization | Uses `claude.ts` |
| `tts-text-cleaner.ts` | TTS text preprocessor: strips `[SFX:]`, citations, delivery directions; preserves audio tags for ElevenLabs | Pure utility |

## Hooks (`src/lib/hooks/`)

Client-side React hooks (`'use client'`).

| Hook | Purpose |
| --- | --- |
| `useAudioPlayer` | HTML5 Audio playback: play/pause, seek, volume, playback rate, podcast loading |
| `useAuth` | Session wrapper: `user`, `isAuthenticated`, `isLoading`, `signIn()`, `signOut()` |
| `useDiscovery` | Discovery chat state: messages, metadata, streaming, URL detection + link previews |
| `useImpressionTracker` | IntersectionObserver-based feed impression tracking (50% visible for 1s, deduped) |
| `useNotifications` | Notification polling (30s interval): list, unread count, mark read, refresh |
| `usePlaybackTelemetry` | Playback event tracking: heartbeats (30s), pause/seek/speed counts, abandon detection |
| `usePodcast` | Podcast detail fetcher: loading state, like/unlike, save/unsave, fork |

## Providers (`src/lib/providers/`)

Modular provider architecture — swap external services via env vars.

| File | Interface | Implementations | Env Var |
| --- | --- | --- | --- |
| `ai.ts` | `AIProvider` | `AnthropicProvider`, `OpenAIProvider`, `ClaudeCodeLazyProvider` + `resolveAiProvider()`, `canResolveAi()` | `AI_PROVIDER` |
| `ai-registry.ts` | `AiProviderMeta` | Declarative AI provider metadata: validation functions for Anthropic + OpenAI keys | — |
| `claude-code.ts` | `AIProvider` | `ClaudeCodeProvider` (standalone) | `AI_PROVIDER` |
| `tts.ts` | `TtsProvider` | `ElevenLabsProvider`, `OpenAITtsProvider`, `PlayHTProvider`, `CartesiaProvider`, `HumeProvider`, `FalProvider`, `ReplicateProvider` + `FallbackTtsProvider`, `resolveTtsProvider()`, `canResolveTts()` | `TTS_PROVIDER` |
| `tts-registry.ts` | `TtsProviderMeta` | Declarative provider metadata: quality tiers, costs, auth validation, capabilities, models | — |
| `tts-voices.ts` | `ProviderVoice` | Per-provider voice pools (PlayHT, Cartesia, Hume, Fal/Replicate) with curated voices + deterministic hash selection | — |
| `tts/*.provider.ts` | `TtsProvider` | Per-provider implementations: `elevenlabs`, `openai`, `playht`, `cartesia`, `hume`, `fal`, `replicate` | Various TTS APIs |
| `stt.ts` | `SttProvider` | OpenAI Whisper (`WhisperProvider`), Groq, ElevenLabs STT + `resolveSttProvider()` | `STT_PROVIDER` |
| `stt-registry.ts` | `SttProviderMeta` | Declarative STT provider metadata: models for OpenAI, Groq, ElevenLabs | — |
| `ml.ts` | `MLProvider` | `SottoMLProvider`: pgvector similarity, multi-signal scoring (relevance, collaborative, quality, freshness, novelty) | — |
| `storage.ts` | `StorageProvider` | `R2Provider`, `S3Provider`, `LocalProvider` | `STORAGE_PROVIDER` |
| `index.ts` | `Providers` | `getProviders()` singleton factory | — |
| `openai.d.ts` | — | Type declarations for optional `openai` dependency | — |

## Patterns

### Redis Connection Rule

BullMQ requires **dedicated Redis connections** per worker/queue. Never share the general Redis client for BullMQ operations. Use `createRedisConnection('name')` for each worker.

### External Service Initialization

All external clients check for API keys on module load and log warnings if missing. This allows the app to start in development without all services configured.

### Error Handling

All lib functions throw descriptive errors. API routes catch and return proper HTTP status codes. Workers log errors and let BullMQ handle retries.

## Adding a New Lib File

1. Create `src/lib/new-service.ts`
2. Add types to `src/types/` if needed
3. Update this CLAUDE.md with the file description
4. If it's an external service, add env vars to `.env.example`
