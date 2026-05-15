# src/lib/ — Core Libraries

All shared business logic and external service integrations live here.

## File Index

| File | Purpose | External Service |
| --- | --- | --- |
| `prisma.ts` | Database client (PostgreSQL) | Prisma ORM |
| `redis.ts` | Redis connections, cache helpers, rate limiting | Redis / ioredis |
| `queue.ts` | BullMQ job queues (27 types), worker creation | BullMQ + Redis |
| `auth.ts` | NextAuth config, OAuth providers (Google, GitHub, Apple for login; Twitter for account linking only), role system (USER/ADMIN), `ADMIN_EMAILS` auto-assignment | NextAuth v5 |
| `admin-emails.ts` | Admin email list from `ADMIN_EMAILS` env var, `isAdminEmail()` check | Doppler |
| `auth-guards.ts` | Suspension check for write-path API routes (`checkSuspension()`) | Pure utility |
| `llm.ts` | Anthropic LLM client (streaming + non-streaming), with auto-routing guardrail for non-Anthropic models | Anthropic API / Claude CLI |
| `claude-code-client.ts` | Claude Code CLI wrapper (`claude -p`): serialize messages, execute, stream | Claude CLI (`claude`) |
| `elevenlabs.ts` | ElevenLabs TTS client, voice ID mapping | ElevenLabs API |
| `fal-voice-clone.ts` | Fal.ai voice cloning via Qwen3-TTS: upload audio to R2, call clone-voice endpoint, return speaker embedding URL | Fal API + R2 |
| `stripe.ts` | Stripe SDK client, `PLATFORM_FEE_PERCENT` (10%), flat feature limits | Stripe API |
| `voice-pricing.ts` | Voice marketplace pricing: `computeVoiceCharges()`, `createVoicePayment()`, `captureVoicePayment()`, `cancelVoicePayment()`, `capturePodcastPayments()`, `cancelPodcastPayments()`, `checkFreeAccess()` | Uses `prisma.ts`, `stripe.ts` |
| `r2.ts` | Cloudflare R2 file storage (upload, download, presign) | AWS S3 SDK → R2 |
| `duration.ts` | Centralized duration constants (WPM, chars/sec, tolerance) & helpers (word↔minute, bounds, estimation) | Pure utility |
| `discovery-agent.ts` | Chat-based discovery: system prompt, chip parsing, metadata extraction | Uses `llm.ts` |
| `feedback-formatter.ts` | Format user feedback (general, per-turn, highlights) into prompt string for script revision | Pure utility |
| `script-generator.ts` | 2-voice podcast script generation with `[N]` citations + revision with feedback (fact-checker + user) | Uses `llm.ts` |
| `script-verifier.ts` | Claude-based "teacher" agent: extracts claims, evaluates sourcing, enforces duration limits | Uses `llm.ts` |
| `reference-validator.ts` | Source quality pre-filter (`assessSourceQuality`), URL HEAD, CrossRef DOI, OpenAlex title-search layers. Used by `reference-verification/` pipeline. | fetch, `llm.ts` |
| `reference-verification/` | Domain-aware verification pipeline: `classifyReference()` → applicable layers → AI batch call → grounding (OpenAlex + AI web search for fully-failed refs) → `computeBayesianScore()`. Exports `runReferenceVerification()`, `groundFailedReferences()`. | `@sottofm/verification-standard`, `llm.ts` |
| `script-updater.ts` | Citation cleanup + renumbering when references are removed after verification | Pure utility |
| `segment-creator.ts` | Shared utility: create Segment records from script turns and queue audio generation jobs (used by reference-validation, script approve endpoint) | Uses `prisma.ts`, `queue.ts` |
| `citation-parser.tsx` | Parse `[N]` citation markers in text → React CitationMarker components | React |
| `pdf-generator.ts` | Generate academic-style PDF transcripts with references via pdfmake | pdfmake |
| `audio-stitcher.ts` | FFmpeg segment concatenation + crossfades + SFX overlay (`adelay`, `duration=first`) + loudness normalization. `SfxInsert` includes `delayMs` for positioning. `skipSfx` flag bypasses SFX on re-stitch. | FFmpeg (CLI) |
| `waveform-extractor.ts` | FFmpeg-based waveform peak extraction (astats RMS → normalized 0-1 array) and spectrogram PNG generation (showspectrumpic) | FFmpeg (CLI) |
| `byok.ts` | Multi-provider BYOK key management: encrypt/decrypt (AES-256-GCM), store/retrieve via `UserTtsKey` + `UserAiKey` models, validate keys per provider | Uses `prisma.ts` |
| `byok-errors.ts` | BYOK job failure classifier: `classifyError()` → `auth_invalid`, `insufficient_credits`, `rate_limited`, `provider_error`; `isKeyInvalidationError()`, `userMessage()` | Pure utility |
| `content-parser.ts` | Thin re-export wrapper (deprecated) — delegates to `extractors/` | — |
| `extractors/` | Multi-layer content extraction: Readability + cheerio HTML, pdf-parse PDF, YouTube transcript, Pinchtab browser fallback. Facade via `extractContent(url)` and `extractFromPdfBuffer(buffer)`, returns `ExtractedContent` | jsdom, @mozilla/readability, cheerio, fetch |
| `recommendations.ts` | Search similar public podcasts (PostgreSQL full-text) | Uses `prisma.ts` |
| `recommendation-engine.ts` | ML-powered recommendation engine: daily picks, explore, trending with private categorization | Uses `prisma.ts`, `providers/ml.ts`, `private-recommendations.ts` |
| `private-recommendations.ts` | Recommendation scoring, diversity, categorization, explanations, and listener archetypes | Pure utility |
| `push-notifications.ts` | Web Push API: send to user devices, clean expired subs | web-push |
| `subscription.ts` | (Simplified) Usage queries, generation counts — no tiers or credits | Uses `prisma.ts` |
| `validations.ts` | Zod schemas for all API input validation (re-exports `createPodcastSchema` from `@sotto/shared`; includes addToAllowlistSchema, userSearchSchema) | Zod |
| `validations/` | Additional Zod schemas: `events.ts` (behavioral event validation) | Zod |
| `api-response.ts` | `errorResponse()` helper: returns JSON error with `requestId` for tracking, logs 5xx errors, sets `x-request-id` header | Uses `logger.ts` |
| `logger.ts` | Structured logging with levels (debug/info/warn/error) | Console |
| `notifications.ts` | In-app notification helpers | Uses `prisma.ts` |
| `twitter.ts` | Twitter API v2 client (mentions, tweets, replies, OAuth 1.0a) | Twitter API v2 |
| `tweet-parser.ts` | Claude-based tweet intent extraction (topic, title, depth, tone) | Uses `llm.ts` |
| `twitter-utils.ts` | Thread source text formatting (engagement-aware, credential-aware) | Pure utility |
| `credential-lookup.ts` | Verified participant credential lookup via Claude + web search | Uses `llm.ts` |
| `telegram.ts` | Telegram Bot API client (send messages, get updates, inline keyboards, webhook management) | Telegram Bot API |
| `telegram-handler.ts` | Telegram update router: /start (account linking), /help, save-for-later (any text/URL → PodcastIdea), legacy callback query fallback | Uses `prisma.ts`, `telegram.ts`, `discovery-agent.ts`, `byok.ts` |
| `telegram-parser.ts` | Claude-based Telegram message intent extraction (topic, title, depth, tone, sourceUrl) | Uses `llm.ts` |
| `voice-pool.ts` | Unified voice pool: 16 curated voices with per-provider IDs, deterministic `selectVoicePair(podcastId)` hash, `resolveVoiceId()`, `findByVoiceId()` | Pure utility |
| `pipeline-resume.ts` | Smart resume: `markPodcastFailed(podcastId)` records `failedAtStatus`, `determineResumePoint(podcastId)` inspects existing data (Script, Segments, References) and returns the optimal pipeline restart step | Uses `prisma.ts` |
| `api-keys.ts` | API key generation, hashing, validation | crypto |
| `tag-icons.tsx` | Tag slug → SVG icon mapping (12 categories), `TagIcon` component, `ONBOARDING_TAG_SLUGS` array | React (SVG) |
| `taste-quiz.ts` | Taste quiz + Inspire Me: `generateQuestions()` for onboarding, `generateForYouQuestions()` (interest-based, no web search), `generateNewsQuestions()` (current events, newsletter-first with web search fallback), `generateCuriosityQuestions()` (fascinating facts + surprising connections) | Anthropic API + `redis.ts` |
| `newsletter-fetcher.ts` | RSS fetcher for news: 26 curated feeds (balanced politics + aggregators + tech + international), JSDOM XML parsing. `fetchNewsletterArticles()` reads from `IngestedArticle` DB table (falls back to live RSS), `fetchFeed()` exported for news-ingest worker, `formatArticlesForPrompt()` | Fetch + JSDOM + `prisma.ts` |
| `handles.ts` | Handle validation, availability checks, unique generation (reserved handles, format validation) | Uses `prisma.ts` |
| `rss.ts` | Private feed token creation and token-scoped RSS 2.0 XML with iTunes namespace | Uses `prisma.ts` |
| `auto-model-config.ts` | `getAutoModelConfig()` / `setAutoModelConfig()` for per-plan "Auto" model resolution + daily limits + provider allocations; `resolveAutoModel(plan)` returns AI/TTS/STT config for FREE or PRO | Uses `prisma.ts` |
| `twitter-config.ts` | `getTwitterConfig()` reads singleton TwitterConfig row (auto-tweet thresholds, trend polling, template); `setTwitterConfig()` for admin updates | Uses `prisma.ts` |
| `landing-showcase.ts` | `getLandingShowcaseConfig()` reads singleton LandingShowcase row; `setLandingShowcaseConfig()` for admin updates. Follows twitter-config singleton pattern | Uses `prisma.ts` |
| `showcase.ts` | `getShowcasePodcast()` for HeroChapter embed; `getLandingShowcaseData()` fetches full showcase data (chat, script, refs, audio/video clips, bot overrides) for all landing chapters | Uses `prisma.ts`, `landing-showcase.ts` |
| `twitter-auto-tweet.ts` | `checkAutoTweetThreshold(podcastId)` — fire-and-forget after like/fork/play; `manualTweet(podcastId)` — admin-triggered tweet | Uses `prisma.ts`, `twitter-config.ts`, `queue.ts` |
| `generation-gate.ts` | `checkGenerationGate(userId)`: BYOK check + free tier counter; `tryIncrementFreeGeneration()`: atomic SQL increment; `getFreeTierStatus()` for display | Uses `prisma.ts`, `byok.ts` |
| `pricing.ts` | AI model pricing table + cost lookup: `getAiCost()`, `getAiPricing()`, `getCheapestModel()`, `refreshPricingFromDb()`, `getAllCurrentPricing()`, `startPricingRefreshInterval()` — centralized pricing with dynamic DB refresh | Pure utility + `pricing-fetcher.ts` |
| `pricing-fetcher.ts` | Pricetoken API fetcher: `fetchPricingFromPricetoken()`, `savePricingSnapshots()`, `getLatestPricingFromDb()`, `getAdminOverriddenModels()`, `seedPricingFromRegistry()`, `filterToKnownModels()` | Uses `prisma.ts`, `pricetoken`, `ai-registry.ts` |
| `pricing-metrics.ts` | Admin pricing queries: `getCurrentModelPricing()`, `getModelPriceHistory()`, `getLastFetchTime()` — enriches pricing with registry metadata | Uses `prisma.ts`, `pricing.ts`, `ai-registry.ts` |
| `usage-logger.ts` | Unified `logUsage()` function for all provider cost tracking — replaces old `logApiUsage()`, auto-computes AI costs from model pricing | Uses `prisma.ts`, `pricing.ts` |
| `cost-monitor.ts` | Per-provider cost tracking from ApiUsageLog: daily/weekly/monthly breakdowns, per-category + per-model aggregation, `getPerModelCostBreakdown()` | Uses `prisma.ts` |
| `podcast-cost-stats.ts` | Per-podcast + per-user cost aggregation: 4-bucket breakdown (text/audio/video/avatar), `getPodcastCostBreakdown()`, `getUserCostSummary()`, `getTopUsersByCost()` | Uses `prisma.ts` |
| `podcast-data.ts` | React.cache-wrapped podcast detail query (deduplicates generateMetadata + page fetch) | Prisma ORM |
| `cloudflare-r2-usage.ts` | Cloudflare R2 usage monitoring: `fetchBucketUsage()`, `fetchOperationCounts()`, `estimateCosts()`, `isR2MonitoringConfigured()` — REST + GraphQL API client with cost estimation | Pure utility (Cloudflare API) |
| `storage-metrics.ts` | R2 storage dashboard queries: `getStorageOverview()`, `getStorageTrend()`, `checkStorageAlerts()` — reads from R2UsageSnapshot | Uses `prisma.ts` |
| `data-completeness.ts` | Per-podcast ML readiness: 15-dimension completeness scoring (`computeCompletenessChecklist()`), corpus-wide aggregation (`getCorpusCompleteness()`), paginated podcast scores (`getPodcastCompletenessScores()`) | Uses `prisma.ts` |
| `traffic-report.ts` | Traffic report builder: 70+ aggregation queries → structured JSON for `/api/admin/traffic-report` | Uses `prisma.ts`, `cost-monitor.ts`, `auto-model-config.ts` |
| `revenue-metrics.ts` | Revenue aggregation: `getRevenueOverview()`, `getDailyRevenueTrend()`, `getTopSellingVoices()`, `getRevenueByStatus()`, `getMarketplaceHealth()` — voice marketplace | Uses `prisma.ts` |
| `engagement-metrics.ts` | Engagement queries: `getEngagementOverview()`, `getDailyEngagementTrend()`, `getTopLiked/Forked/Commented()`, `getInteractionStats()` — social metrics | Uses `prisma.ts` |
| `playback-metrics.ts` | Playback analytics: `getPlaybackOverview()`, `getSpeedDistribution()`, `getCompletionDistribution()`, `getDailyListenHours()` — listening data | Uses `prisma.ts` |
| `funnel-metrics.ts` | Conversion funnel: `getFreeTierFunnel()`, `getByokAdoption()`, `getPipelineHealth()` — BYOK conversion + pipeline health | Uses `prisma.ts` |
| `retention-metrics.ts` | Retention: `getDAU_WAU_MAU()`, `getDailyActiveUsers()`, `getRetentionCohorts()` — active users + weekly cohort heatmap (filters null userId) | Uses `prisma.ts` |
| `quality-metrics.ts` | Quality analytics: `getModelUsageDistribution()`, `getQualityTrend()`, `getBestModelByTopic()`, `getRatingVolumeTrend()`, `getOverallQualityScore()` — investor-facing quality dashboard | Uses `prisma.ts` |
| `segment-utils.ts` | Shared segment utilities: `findActiveIndex()` for time-based segment lookup | Pure utility |
| `detect-urls.ts` | URL detection in message strings (client-safe, no server dependencies) | Pure utility |
| `embeddings.ts` | Embedding provider abstraction (384-dim): stub hash-based for dev, swap to `text-embedding-3-small` | Pure utility (swappable) |
| `event-buffer.ts` | Client-side behavioral event buffer: 5s flush / 50-event cap, `sendBeacon` on unload | `'use client'` |
| `import-metadata-generator.ts` | Claude-based title + topic generation from imported audio transcripts | Uses `llm.ts` |
| `language-detect.ts` | Language detection via platform AI model (`resolveAutoModel('PLATFORM')`) → ISO 639-1 code | Uses `providers/ai.ts`, `auto-model-config.ts`, `tts-language-support.ts` |
| `tts-language-support.ts` | TTS language support lookups: `supportsLanguage()`, `getProvidersForLanguage()`, `getDefaultModelForLanguage()`, `SOTTO_LANGUAGE_CODES`, `VOICE_LANGUAGE_AFFINITIES` — thin query layer over registry language data | Uses `providers/tts-registry.ts` |
| `moderation.ts` | OpenAI Moderation API client: per-category thresholds, Redis caching (10min TTL) | OpenAI Moderation API, `redis.ts` |
| `user-moderation.ts` | Admin user moderation actions: warn, suspend, ban, unban, unsuspend, remove content | Uses `prisma.ts` |
| `podcast-gradient.ts` | Deterministic gradient generation from podcast ID (12 brand palettes) | Pure utility |
| `safety-prompts.ts` | Reusable LLM safety fragments: `CONTENT_SAFETY_INSTRUCTIONS`, `INPUT_SANITIZATION_INSTRUCTIONS`, `MATURE_AUDIENCE_GUIDANCE` | Pure constants |
| `slugify.ts` | URL-safe tag slug generator: `generateTagSlug(name)` (50 char cap) | Pure utility |
| `theme-script.ts` | Inline dark mode init script (`THEME_INIT_SCRIPT`) — prevents flash on page load | Pure utility |
| `topic-tagger.ts` | Keyword-based topic tag matcher: maps topics to tag slugs (deterministic, no AI) | Pure utility |
| `media-bias.ts` | MBFC media bias detection: domain lookup, alias resolution, political topic detection, `analyzeBias()` for source bias analysis | Filesystem (static JSON) |
| `transcript-parser.ts` | Transcript parser (SRT, VTT, plain text) → `ParsedSegment[]` with speaker diarization | Uses `llm.ts` |
| `email.ts` | Resend email client (graceful no-op if key missing) | Resend API |
| `email-templates.ts` | Waitlist welcome + weekly digest HTML templates | Pure utility |
| `tts-text-cleaner.ts` | TTS text safety net: strips `[SFX:]` markers and `[N]` citations before sending to TTS. Provider-specific tag conversion handled upstream by `tts-tag-converter.ts` | Pure utility |
| `tts-generation.ts` | Shared TTS generation core used by `audio-generation` and `voice-track-audio` workers: semaphore-controlled concurrency, `generateSpeech` with full params, BYOK 404 fallback, 429 concurrency updates, FFprobe duration measurement, usage logging. Also exports `getPlatformTtsKey()` | Uses `providers/tts.ts`, `redis.ts`, `byok.ts`, `elevenlabs.ts`, `audio-stitcher.ts`, `usage-logger.ts` |
| `tts-tag-converter.ts` | LLM-based TTS tag converter: converts script inline markup to provider-native format at approve time. Uses cheapest model via `pricing.ts`, fetches provider docs via `tts-doc-fetcher.ts` | Uses `llm.ts`, `pricing.ts`, `tts-doc-fetcher.ts` |
| `tts-doc-fetcher.ts` | TTS provider docs fetcher: fetches formatting docs from provider URL, Redis cache (24h TTL), HTML content extraction | Fetch + `redis.ts` |
| `visual-classifier.ts` | Claude Haiku-based batch segment classification: assigns visual type + prompt/metadata + `endStatePrompt` per segment (8 types: ai-illustration, stock-footage, data-chart, quote, comparison, timeline, diagram, text-card). `endStatePrompt` describes how the scene should look after narration ends (used for last-frame image generation in video mode) | Uses `llm.ts` |
| `stock-footage.ts` | Pexels Video API search + download: returns stock video clips for STOCK_FOOTAGE segments, falls back to TEXT_CARD if no results | Pexels API |
| `video-gate.ts` | PRO/admin feature gate for video generation: checks user plan, role, and fal key availability (BYOK or platform FAL_KEY) | Uses `prisma.ts` |
| `video-cost-estimator.ts` | Pricetoken-based cost calculation for video pipeline: `estimateSegmentCost()`, `estimateTransitionCost()`, `estimateAllTransitionsCost()`, `estimatePipelineCost()`, `formatCost()`, `fetchFalImageModels()`, `fetchFalVideoModels()`, `cheapestModel()` — live pricing via `PriceTokenClient` | pricetoken API |

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
| `useRotatingMessage` | Rotating sub-messages for generation progress: cycles through stage-specific pools every 9s, switches early→late after 2min |
| `usePodcast` | Podcast detail fetcher: loading state, like/unlike, save/unsave, fork |
| `useScrollFollow` | Auto-scroll follow with user-input detection (wheel/touch), scrollability guard, 3s debounce relock |
| `useHasMounted` | Hydration-safe mount guard: returns `false` on server/initial render, `true` after client mount |

## Providers (`src/lib/providers/`)

Modular provider architecture — swap external services via env vars.

| File | Interface | Implementations | Env Var |
| --- | --- | --- | --- |
| `ai.ts` | `AIProvider` | `AnthropicProvider`, `OpenAIProvider`, `GoogleProvider`, `ClaudeCodeLazyProvider` | `AI_PROVIDER` |
| `ai-registry.ts` | `AiProviderMeta` | Declarative AI provider metadata: validation functions for Anthropic + OpenAI keys | — |
| `claude-code.ts` | `AIProvider` | `ClaudeCodeProvider` (standalone) | `AI_PROVIDER` |
| `tts.ts` | `TtsProvider` | `ElevenLabsProvider`, `OpenAITtsProvider`, `CartesiaProvider`, `HumeProvider`, `FalProvider`, `ReplicateProvider`, `MinimaxProvider` + `FallbackTtsProvider`, `resolveTtsProvider()`, `canResolveTts()` | `TTS_PROVIDER` |
| `tts-registry.ts` | `TtsProviderMeta` | Declarative provider metadata: quality tiers, costs, auth validation, capabilities, models | — |
| `tts-voices.ts` | `ProviderVoice` | Per-provider voice pools (Cartesia, Hume, Fal/Replicate, MiniMax) with curated voices + deterministic hash selection | — |
| `tts/*.provider.ts` | `TtsProvider` | Per-provider implementations: `elevenlabs`, `openai`, `cartesia`, `hume`, `fal`, `replicate`, `minimax` | Various TTS APIs |
| `stt.ts` | `SttProvider` | OpenAI Whisper, Together, Deepgram, AssemblyAI, ElevenLabs Scribe + `resolveSttProvider()` (BYOK → platform → auto-model config), `getSttPlatformKey()`, `createSttProvider()` | `STT_PROVIDER` |
| `stt-registry.ts` | `SttProviderMeta` | Declarative STT provider metadata: models for OpenAI, ElevenLabs | — |
| `image.ts` | `ImageProvider` | `resolveImageProvider()`: fal.ai FLUX image generation (Schnell, 1.1 Pro, 2 Pro) for video pipeline AI illustrations | `FAL_KEY` |
| `image-registry.ts` | `ImageProviderMeta` | Fal provider metadata: model catalog, costs, auth validation | — |
| `image/fal.provider.ts` | `ImageProvider` | Fal FLUX implementation: generate image from prompt, configurable model/resolution | Fal API |
| `image/fal-video.ts` | — | Fal video generation (text-to-video) via async queue API with polling | Fal API |
| `fal-endpoints.ts` | — | Pricetoken model ID → Fal REST API endpoint mapping (image + video + legacy) | Pure utility |
| `ml.ts` | `MLProvider` | `SottoMLProvider`: pgvector similarity, delegates signal computation/scoring/archetypes/explain to private recommendation utilities | `private-recommendations.ts` |
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

## MANDATORY — Adding a New TTS Provider Voice Pool

**Every new TTS provider with preset voices MUST touch all files below. Missing any causes silent fallbacks to ElevenLabs voices or raw UUIDs in the UI.**

### Voice pool & registry (backend)

- [ ] `providers/tts-voices.ts` — add `export const NEW_VOICE_POOL: ProviderVoice[]` + add entry to `PROVIDER_VOICE_POOLS` map
- [ ] `providers/tts-registry.ts` — add to `TtsProviderId` union + add full `TtsProviderMeta` entry (languages, models, costs)
- [ ] `providers/tts/new.provider.ts` — create provider class implementing `TtsProvider`
- [ ] `providers/tts.ts` — add async import + `case` in `createTtsProviderAsync` + platform key resolution
- [ ] `voice-pool.ts` → `findVoiceName()` — add pool to destructured import + `providerPools` array (otherwise UUIDs show in UI)
- [ ] `voice-catalog.ts` → `getVoiceCatalog()` — add import + `case` in switch (otherwise falls to ElevenLabs catalog)
- [ ] `voice-assigner.ts` → `getFallbackVoiceIds()` — add import + `case` in switch (otherwise assigns wrong ElevenLabs voice IDs)

### Validation schemas & API routes

- [ ] `validations.ts` → `byokSchema` — add to `provider` z.enum (otherwise BYOK key save returns 400)
- [ ] `validations.ts` → `voicePreviewSchema` — add to `provider` z.enum (otherwise voice preview returns 400)
- [ ] `api/settings/byok/route.ts` → DELETE `validProviders` array — add provider (otherwise key deletion falls back to elevenlabs)
- [ ] `api/podcasts/[id]/voice-tracks/route.ts` → GET enrichment uses `findVoiceName()` — works automatically if voice pool is registered

### Display names (shared + UI)

- [ ] `packages/shared/src/provider-display.ts` — add to `TTS_PROVIDER_DISPLAY` + `TTS_MODEL_DISPLAY`
- [ ] `components/player/VoiceTrackSelector.tsx` — add to local `PROVIDER_DISPLAY`
- [ ] `components/player/VoiceTrackManager.tsx` — add to local `PROVIDER_DISPLAY`

### Expression mapping (if provider supports SSML/tags)

- [ ] `tts-expression-mapper.ts` — add type + direction map entries + `case` in `mapDirectionToExpression` and `convertInlineAudioTags`

### Tests

- [ ] `tests/smoke/connectivity.test.ts` — add provider smoke test block
- [ ] `tests/api/admin-test-model.test.ts` — add to voice pool mock + `getProviderIds` mock
