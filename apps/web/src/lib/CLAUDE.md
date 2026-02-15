# src/lib/ — Core Libraries

All shared business logic and external service integrations live here.

## File Index

| File                     | Purpose                                                                                                                                                                                                    | External Service                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `prisma.ts`              | Database client (PostgreSQL)                                                                                                                                                                               | Prisma ORM                                    |
| `redis.ts`               | Redis connections, cache helpers, rate limiting                                                                                                                                                            | Redis / ioredis                               |
| `queue.ts`               | BullMQ job queues (12 types), worker creation                                                                                                                                                              | BullMQ + Redis                                |
| `auth.ts`                | NextAuth config, OAuth providers (Google, GitHub, Twitter, Apple), role system (USER/CREATOR/ADMIN), `ADMIN_EMAILS` auto-assignment                                                                        | NextAuth v5                                   |
| `claude.ts`              | Anthropic Claude client (streaming + non-streaming), provider-aware (`AI_PROVIDER`)                                                                                                                        | Anthropic API / Claude CLI                    |
| `claude-code-client.ts`  | Claude Code CLI wrapper (`claude -p`): serialize messages, execute, stream                                                                                                                                 | Claude CLI (`claude`)                         |
| `elevenlabs.ts`          | ElevenLabs TTS client, voice ID mapping                                                                                                                                                                    | ElevenLabs API                                |
| `stripe.ts`              | Flat feature limits (no tiers, all features enabled for everyone)                                                                                                                                          | —                                             |
| `r2.ts`                  | Cloudflare R2 file storage (upload, download, presign)                                                                                                                                                     | AWS S3 SDK → R2                               |
| `discovery-agent.ts`     | Chat-based discovery: system prompt, chip parsing, metadata extraction                                                                                                                                     | Uses `claude.ts`                              |
| `script-generator.ts`    | 2-voice podcast script generation with `[N]` citations + revision with feedback                                                                                                                            | Uses `claude.ts`                              |
| `script-verifier.ts`     | Claude-based "teacher" agent: extracts claims, evaluates sourcing, enforces duration limits                                                                                                                | Uses `claude.ts`                              |
| `reference-validator.ts` | Source quality pre-filter + 4-layer verification: URL HEAD, CrossRef DOI, OpenAlex title, Claude AI                                                                                                        | fetch, `claude.ts`                            |
| `script-updater.ts`      | Citation cleanup + renumbering when references are removed after verification                                                                                                                              | Pure utility                                  |
| `segment-creator.ts`     | Shared utility: create Segment records from script turns and queue audio generation jobs (used by reference-validation, script approve endpoint)                                                           | Uses `prisma.ts`, `queue.ts`                  |
| `citation-parser.tsx`    | Parse `[N]` citation markers in text → React CitationMarker components                                                                                                                                     | React                                         |
| `pdf-generator.ts`       | Generate academic-style PDF transcripts with references via pdfmake                                                                                                                                        | pdfmake                                       |
| `audio-stitcher.ts`      | FFmpeg segment concatenation + crossfades + SFX overlay (`adelay`, `duration=first`) + loudness normalization. `SfxInsert` includes `delayMs` for positioning. `skipSfx` flag bypasses SFX on re-stitch.   | FFmpeg (CLI)                                  |
| `byok.ts`                | Multi-provider BYOK key management: encrypt/decrypt (AES-256-GCM), store/retrieve via `UserTtsKey` + `UserAiKey` models, validate keys per provider                                                        | Uses `prisma.ts`                              |
| `content-parser.ts`      | Thin re-export wrapper (deprecated) — delegates to `extractors/`                                                                                                                                           | —                                             |
| `extractors/`            | Multi-layer content extraction: Readability + cheerio HTML, pdf-parse PDF, YouTube transcript. Facade via `extractContent(url)` and `extractFromPdfBuffer(buffer)`, returns `ExtractedContent`              | jsdom, @mozilla/readability, cheerio, fetch   |
| `recommendations.ts`     | Search similar public podcasts (PostgreSQL full-text)                                                                                                                                                      | Uses `prisma.ts`                              |
| `push-notifications.ts`  | Web Push API: send to user devices, clean expired subs                                                                                                                                                     | web-push                                      |
| `subscription.ts`        | (Simplified) Usage queries, generation counts — no tiers or credits                                                                                                                                        | Uses `prisma.ts`                              |
| `validations.ts`         | Zod schemas for all API input validation (includes addToAllowlistSchema, userSearchSchema)                                                                                                                 | Zod                                           |
| `logger.ts`              | Structured logging with levels (debug/info/warn/error)                                                                                                                                                     | Console                                       |
| `notifications.ts`       | In-app notification helpers                                                                                                                                                                                | Uses `prisma.ts`                              |
| `twitter.ts`             | Twitter API v2 client (mentions, tweets, replies, OAuth 1.0a)                                                                                                                                              | Twitter API v2                                |
| `tweet-parser.ts`        | Claude-based tweet intent extraction (topic, title, depth, tone)                                                                                                                                           | Uses `claude.ts`                              |
| `voice-pool.ts`          | Unified voice pool: 16 curated voices with per-provider IDs, deterministic `selectVoicePair(podcastId)` hash, `resolveVoiceId()`, `findByVoiceId()`                                                        | Pure utility                                  |
| `pipeline-resume.ts`     | Smart resume: `markPodcastFailed(podcastId)` records `failedAtStatus`, `determineResumePoint(podcastId)` inspects existing data (Script, Segments, References) and returns the optimal pipeline restart step | Uses `prisma.ts`                              |
| `api-keys.ts`            | API key generation, hashing, validation                                                                                                                                                                    | crypto                                        |
| `tag-icons.tsx`          | Tag slug → SVG icon mapping (12 categories), `TagIcon` component, `ONBOARDING_TAG_SLUGS` array                                                                                                             | React (SVG)                                   |
| `inspire-engine.ts`      | "Inspire Me" topic suggestions: `getPersonalizedTopics()`, `getTrendingTopics()`, `getCurrentEvents()` (Claude + web search), `drillDown()`                                                                | Anthropic API + `redis.ts`                    |
| `handles.ts`             | Handle validation, availability checks, unique generation (reserved handles, format validation)                                                                                                            | Uses `prisma.ts`                              |
| `rss.ts`                 | `generateCreatorRssFeed(userId)`: RSS 2.0 XML with iTunes namespace for user's public podcasts                                                                                                             | Uses `prisma.ts`                              |
| `free-tier-config.ts`    | `getFreeTierConfig()` reads singleton FreeTierConfig row; `setFreeTierConfig()` for admin updates                                                                                                          | Uses `prisma.ts`                              |
| `generation-gate.ts`     | `checkGenerationGate(userId)`: BYOK check + free tier counter; `tryIncrementFreeGeneration()`: atomic SQL increment; `getFreeTierStatus()` for display                                                     | Uses `prisma.ts`, `byok.ts`                  |
| `traffic-report.ts`      | Traffic report builder: 70+ aggregation queries → structured JSON for `/api/admin/traffic-report`                                                                                                          | Uses `prisma.ts`, `cost-monitor.ts`, `free-tier-config.ts` |

## Providers (`src/lib/providers/`)

Modular provider architecture — swap external services via env vars.

| File                | Interface         | Implementations                                                                                                                                 | Env Var            |
| ------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `ai.ts`             | `AIProvider`      | `AnthropicProvider`, `OpenAIProvider`, `ClaudeCodeLazyProvider` + `resolveAiProvider()`, `canResolveAi()`                                       | `AI_PROVIDER`      |
| `ai-registry.ts`    | `AiProviderMeta`  | Declarative AI provider metadata: validation functions for Anthropic + OpenAI keys                                                              | —                  |
| `claude-code.ts`    | `AIProvider`      | `ClaudeCodeProvider` (standalone)                                                                                                               | `AI_PROVIDER`      |
| `tts.ts`            | `TtsProvider`     | `ElevenLabsProvider`, `OpenAITtsProvider`, `PlayHTProvider`, `CartesiaProvider`, `HumeProvider` + `FallbackTtsProvider`, `resolveTtsProvider()`, `canResolveTts()` | `TTS_PROVIDER`     |
| `tts-registry.ts`   | `TtsProviderMeta` | Declarative provider metadata: quality tiers, costs, auth validation, capabilities                                                              | —                  |
| `tts/*.provider.ts` | `TtsProvider`     | Per-provider implementations: `elevenlabs`, `openai`, `playht`, `cartesia`, `hume`                                                              | Various TTS APIs   |
| `storage.ts`        | `StorageProvider` | `R2Provider`, `S3Provider`, `LocalProvider`                                                                                                     | `STORAGE_PROVIDER` |
| `index.ts`          | `Providers`       | `getProviders()` singleton factory                                                                                                              | —                  |
| `openai.d.ts`       | —                 | Type declarations for optional `openai` dependency                                                                                              | —                  |

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
