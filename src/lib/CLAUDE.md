# src/lib/ — Core Libraries

All shared business logic and external service integrations live here.

## File Index

| File                     | Purpose                                                                                             | External Service               |
| ------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------ |
| `prisma.ts`              | Database client (PostgreSQL)                                                                        | Prisma ORM                     |
| `redis.ts`               | Redis connections, cache helpers, rate limiting                                                     | Redis / ioredis                |
| `queue.ts`               | BullMQ job queues (12 types), worker creation                                                       | BullMQ + Redis                 |
| `auth.ts`                | NextAuth configuration, OAuth providers (Google, GitHub, Twitter)                                   | NextAuth v5                    |
| `claude.ts`              | Anthropic Claude client (streaming + non-streaming)                                                 | Anthropic API                  |
| `elevenlabs.ts`          | ElevenLabs TTS client, voice ID mapping                                                             | ElevenLabs API                 |
| `stripe.ts`              | Stripe client, pricing tier limits, checkout                                                        | Stripe                         |
| `r2.ts`                  | Cloudflare R2 file storage (upload, download, presign)                                              | AWS S3 SDK → R2                |
| `discovery-agent.ts`     | Chat-based discovery: system prompt, chip parsing, metadata extraction                              | Uses `claude.ts`               |
| `script-generator.ts`    | 2-voice podcast script generation with `[N]` citations + revision with feedback                     | Uses `claude.ts`               |
| `script-verifier.ts`     | Claude-based "teacher" agent: extracts claims, evaluates sourcing, enforces duration limits         | Uses `claude.ts`               |
| `reference-validator.ts` | Source quality pre-filter + 4-layer verification: URL HEAD, CrossRef DOI, OpenAlex title, Claude AI | fetch, `claude.ts`             |
| `script-updater.ts`      | Citation cleanup + renumbering when references are removed after verification                       | Pure utility                   |
| `citation-parser.tsx`    | Parse `[N]` citation markers in text → React CitationMarker components                              | React                          |
| `pdf-generator.ts`       | Generate academic-style PDF transcripts with references via pdfmake                                 | pdfmake                        |
| `audio-stitcher.ts`      | FFmpeg segment concatenation + loudness normalization                                               | FFmpeg (CLI)                   |
| `content-parser.ts`      | URL/PDF text extraction for source material                                                         | fetch + pdf-parse              |
| `recommendations.ts`     | Search similar public podcasts (PostgreSQL full-text)                                               | Uses `prisma.ts`               |
| `push-notifications.ts`  | Web Push API: send to user devices, clean expired subs                                              | web-push                       |
| `subscription.ts`        | Tier management, usage tracking, limit enforcement                                                  | Uses `prisma.ts` + `stripe.ts` |
| `validations.ts`         | Zod schemas for all API input validation                                                            | Zod                            |
| `logger.ts`              | Structured logging with levels (debug/info/warn/error)                                              | Console                        |
| `notifications.ts`       | In-app notification helpers                                                                         | Uses `prisma.ts`               |
| `twitter.ts`             | Twitter API v2 client (mentions, tweets, replies, OAuth 1.0a)                                       | Twitter API v2                 |
| `tweet-parser.ts`        | Claude-based tweet intent extraction (topic, title, depth, tone)                                    | Uses `claude.ts`               |
| `api-keys.ts`            | API key generation, hashing, validation                                                             | crypto                         |

## Providers (`src/lib/providers/`)

Modular provider architecture — swap external services via env vars.

| File          | Interface         | Implementations                                    | Env Var            |
| ------------- | ----------------- | -------------------------------------------------- | ------------------ |
| `ai.ts`       | `AIProvider`      | `AnthropicProvider`, `OpenAIProvider`              | `AI_PROVIDER`      |
| `tts.ts`      | `TtsProvider`     | `ElevenLabsProvider`, `OpenAITtsProvider`          | `TTS_PROVIDER`     |
| `storage.ts`  | `StorageProvider` | `R2Provider`, `S3Provider`, `LocalProvider`        | `STORAGE_PROVIDER` |
| `payment.ts`  | `PaymentProvider` | `StripeProvider`, `NoOpProvider`                   | `PAYMENT_PROVIDER` |
| `index.ts`    | `Providers`       | `getProviders()` singleton factory                 | —                  |
| `openai.d.ts` | —                 | Type declarations for optional `openai` dependency | —                  |

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
