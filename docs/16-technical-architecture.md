# Technical Architecture - Sotto

> **Date**: 2026-05-15
>
> **Summary**: Sotto is a private-first audio briefing system built around a Next.js web app, PostgreSQL, Redis/BullMQ workers, explicit provider routing, local or cloud storage, and private RSS delivery. Heavy generation work stays in workers. API routes stay thin. The system has no public social data model.

---

## 1. System Overview

```text
Browser / Mobile / Bot / Agent
        |
        v
Next.js App Router + API Routes
        |
        +--> PostgreSQL via Prisma
        +--> Redis via BullMQ
        +--> Storage provider
        |
        v
Worker pool
        |
        +--> LLM provider or local agent
        +--> TTS provider
        +--> STT provider when transcription is needed
        +--> FFmpeg stitching
        |
        v
Private library + private RSS
```

The default local OSS deployment uses:

- Next.js app and workers on the developer machine.
- PostgreSQL and Redis from Docker Compose.
- Local file storage under `.sotto/storage`.
- Explicit provider configuration in `.env.local` and user settings.

Hosted deployments can replace storage, database, Redis, and provider custody with managed services, but must keep the same private-first data model.

---

## 2. Monorepo

| Path | Responsibility |
|---|---|
| `apps/web` | Next.js app, API routes, Prisma schema, workers, tests |
| `apps/mobile` | Expo app and mobile playback surfaces |
| `apps/maps` | Next.js playground for `@sotto/maps` |
| `packages/shared` | Shared TypeScript types, Zod schemas, tokens, provider display helpers |
| `packages/maps` | Map components and related utilities |
| `packages/mcp` | MCP integration surface |
| `packages/verification-standard` | Reference verification standard package |
| `services/remotion` | Video rendering service |
| `e2e` | Playwright and Maestro tests |
| `scripts` | Setup, launch, recording, migration, and release automation |

Root scripts proxy the primary web commands to `@sotto/web`.

---

## 3. Core Data Model

The active data model is private workspace oriented. Important groups:

| Group | Models |
|---|---|
| Identity | `User`, `Account`, `Session`, `VerificationToken` |
| Creation | `Discovery`, `DiscoveryMessage`, `Podcast`, `PodcastSegment`, `PodcastVersion` |
| Delivery | `PrivateRssToken`, `Save`, `Collection`, `CollectionItem` |
| Interaction | `PodcastInteraction`, `InteractionResolution`, analytics/event models |
| Provider config | user keys, model config, provider settings, voice settings |
| Operations | queue/job metadata, reports, audit/admin records |

Removed social primitives must stay removed:

- `Follow`
- `Comment`
- `Like`
- `CollectionFollow`
- `Activity`
- `InteractionVote`
- podcast fork lineage fields
- public engagement counters for likes, comments, forks, and followers

`saveCount` remains because saving is a private library signal, not a public popularity mechanism.

---

## 4. Request Pattern

API routes follow the same shape:

```text
auth()
  -> validate input with Zod
  -> check ownership or admin permission
  -> perform a small database change or enqueue work
  -> return NextResponse.json()
```

Routes should not run LLM calls, TTS calls, transcription, video work, or audio stitching directly. They enqueue jobs and return.

---

## 5. Worker Pipeline

The normal episode pipeline is:

```text
content extraction
  -> script generation
  -> script verification
  -> reference validation
  -> audio generation
  -> audio stitching
  -> notification/private library update
```

Episode statuses:

```text
PENDING
DISCOVERING
EXTRACTING
SCRIPTING
VERIFYING_SCRIPT
VALIDATING_REFERENCES
SCRIPT_READY
GENERATING_AUDIO
STITCHING
READY
FAILED
```

Worker rules:

- Use typed job payloads.
- Update progress for long-running work.
- Use one Redis connection per worker.
- Keep provider choice explicit in the job context.
- Persist enough error detail for setup remediation.
- Do not retry configuration errors as if they were transient provider errors.

---

## 6. Provider Resolution

Provider selection must be explicit. The architecture should reject implicit "try whichever key exists" behavior.

Target resolution flow:

```text
source request
  -> selected provider profile
  -> capability requirement (LLM, TTS, STT)
  -> resolver validates credentials and model config
  -> concrete provider client
```

Expected resolvers:

- `resolveAutoModel()` for LLM/script generation.
- `resolveTtsProvider()` for TTS.
- `resolveSttProvider()` for transcription.
- Local-agent resolver for CLI-backed generation.

Resolver output should be either:

- a concrete provider client and model/settings, or
- a typed setup error with missing capability and action.

No worker should silently route to a different provider because another API key is present.

---

## 7. Local Agents

Local-agent support should be modeled as a provider family, not as a special case scattered through routes.

Profiles:

- Claude Code.
- Codex.
- OpenClaw.
- Hermes.
- Generic command adapter.

The generic adapter should require explicit opt-in and configuration:

- command template
- working directory
- input file
- output file
- timeout
- environment allowlist

Agent outputs should be treated as private user data. Logs must avoid leaking prompts, transcripts, API keys, or raw meeting content.

---

## 8. Source Ingestion

Sotto should support multiple source types through a common ingestion shape:

| Source | Trigger | Output |
|---|---|---|
| Manual | user creates topic or URL | on-demand private episode |
| Agent | CLI/webhook/API token | project or daily work briefing |
| Meeting | upload, transcript, recorder, calendar integration | recap and daily roll-up |
| News | schedule | separate world briefing |
| Twitter | mention, DM, or owner command depending on deployment | private episode |
| Telegram | bot command | private episode |
| Webhook | signed HTTP event | private episode or scheduled source |

Common requirements:

- user ownership
- authentication or signature verification
- idempotency key
- source status and last error
- private default visibility
- queue handoff for heavy work

---

## 9. Private RSS

Private RSS is the main delivery primitive.

Token lifecycle:

```text
POST /api/rss/private
  -> generate raw token
  -> store SHA-256 hash
  -> return raw token and feed URL once

GET /api/rss/private
  -> list token metadata only

DELETE /api/rss/private/tokens/:tokenId
  -> revoke token

GET /api/rss/private/:token
  -> hash token
  -> find active token
  -> return ready, non-deleted owner episodes
```

Rules:

- Never store raw private RSS tokens.
- Never expose another user's private episodes.
- Include private and unlisted episodes owned by the token owner.
- Exclude deleted, failed, and processing episodes.
- Keep public creator RSS routes removed.

---

## 10. Storage

Local storage is the default for OSS.

| Deployment | Storage |
|---|---|
| Local OSS | local filesystem under `.sotto/storage` |
| VPS self-hosted | local volume or S3-compatible storage |
| Managed hosted | S3/R2-compatible storage |

Storage rules:

- Workers must respect `STORAGE_PROVIDER`.
- Local storage must support the full audio pipeline.
- No cleanup script may bulk-delete protected podcast or segment audio by pattern.
- Deletion paths must go through existing storage guards.

---

## 11. Security

Security priorities:

- Session auth for dashboard and settings.
- Route-level ownership checks for every private resource.
- Hashed RSS tokens.
- Encrypted user provider keys.
- Token-authenticated ingestion endpoints.
- Signed webhook validation when the caller supports signatures.
- Rate limits for bots and ingestion.
- Redaction of provider keys and raw private content from logs.

Meeting and agent content should be treated as highly sensitive. Store raw inputs only as long as the configured retention policy requires.

---

## 12. Managed Hosting

Managed hosting reuses the same architecture but Sotto operates the infrastructure:

- app runtime
- worker runtime
- PostgreSQL
- Redis
- storage
- scheduled jobs
- bot/webhook operations
- backups and monitoring

Billing boundaries:

- Privacy stays available on OSS and free/local paths.
- Billing is for managed operations.
- Trial status should not alter private episode visibility.
- Provider custody must be explicit when Sotto-managed keys are used.

---

## 13. Observability

Track private operational health, not public popularity:

- job duration
- job failure reason
- provider latency
- provider cost estimate
- storage writes
- RSS token usage count and last used timestamp
- source last run and last error
- episode listen count and completion when available
- save-to-listen ratio as a private library signal

Do not add public engagement metrics such as likes, public comments, public fork counts, followers, or public rank.

---

## 14. Release Guardrails

The architecture is considered aligned when:

- `npm run ci` passes.
- Prisma validates and generates.
- OSS guard tests fail if removed social primitives return.
- Root docs describe private-first OSS onboarding.
- Local setup works without Doppler.
- Private RSS works with local storage.
- Provider setup errors are explicit.
- Managed-hosting code does not gate privacy.
