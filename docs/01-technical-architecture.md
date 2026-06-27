# Technical Architecture - Sotto

> **Date**: 2026-06-13
>
> **Diagrams**: [07-architecture-diagrams.md](./07-architecture-diagrams.md) renders every flow below as Mermaid.
>
> **Summary**: Sotto is free, open-source, self-hostable language-learning infrastructure built around a Next.js web app, PostgreSQL/Prisma, Redis/BullMQ workers, explicit BYOK/local provider routing, and local or S3-compatible storage. Heavy generation and grading work stays in workers. API routes stay thin. The active product is CEFR language learning with courses, classes, practice, exams, memory, and a reused audio engine for listening.

---

## 1. System Overview

```text
Browser / Desktop / Local Agent
        |
        v
Next.js App Router + /api/v1 routes
        |
        +--> PostgreSQL via Prisma
        +--> Redis via BullMQ
        +--> Storage provider
        |
        v
Worker pool
        |
        +--> Learning LLM provider or local agent
        +--> TTS provider for listening/reference audio
        +--> STT provider for speaking recordings
        +--> FFmpeg stitching for listening audio
        |
        v
Course classes + practice + exams + memory graph
```

The default local OSS deployment uses:

- Next.js app and workers on the developer machine.
- PostgreSQL and Redis from Docker Compose.
- Local file storage under `.sotto/storage`.
- Explicit provider configuration in `.env.local`, server config, and user settings.
- BYOK or keyless local providers for the learning LLM, TTS, and STT.

Sotto may run on a VPS or managed infrastructure, but the self-hosted product must keep the same free, full-featured learning data model.

---

## 2. Monorepo

| Path                   | Responsibility                                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`             | Next.js app, `/api/v1` routes, Prisma schema, workers, tests                                                                                                    |
| `apps/desktop`         | Tauri desktop shell, built outside the npm workspaces                                                                                                           |
| `tui/`                 | Rust + ratatui headless terminal client (the `sotto` binary), built outside the npm workspaces; consumes `/api/v1` over HTTP with a progenitor-generated client |
| `packages/shared`      | Shared TypeScript types, Zod schemas, brand copy, tokens, provider display helpers; also emits the OpenAPI contract the `tui/` client is generated from         |
| `packages/mcp`         | MCP integration surface for local agents                                                                                                                        |
| `packages/groundcheck` | Reference verification standard package                                                                                                                         |
| `services/local-tts`   | Keyless Kokoro TTS sidecar for local listening and speaking audio                                                                                               |
| `e2e`                  | Playwright end-to-end tests                                                                                                                                     |
| `scripts`              | Setup, launch, recording, migration, and release automation                                                                                                     |

Root scripts proxy the primary web commands to `@sotto/web`.

---

## 3. Core Data Model

The active data model is learner and course oriented. Important groups:

| Group               | Models                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| Identity            | `User`, `ApiKey`, `PairingToken` (single-learner build; no NextAuth `Account`/`Session`)            |
| Curriculum          | `Curriculum`, `Lesson`, `CefrLevel`, `PedagogyStyle`                                                |
| Enrollment          | `Course`, `CourseNote`, `PlacementResult`                                                           |
| Classes             | `CourseClass`, `ClassSection`, `LessonQuestion`, `ClassSubmission`, `SectionAnswer`                 |
| Speaking            | `SpeakingPrompt`, `SpeakingRecording`, `SpeakingGradeStatus`                                        |
| Writing             | `WritingPrompt`, `WritingResponse`                                                                  |
| Practice            | `PracticeSession`, `PracticeKind`, `PracticeStatus`                                                 |
| Mock exams          | `MockExam`, `ExamSection`, `ExamQuestion`, `ExamSubmission`, `ExamSectionResult`, `ExamInstitution` |
| Memory graph        | `LearnerVocab`, `LearnerGrammar`, `VocabEdge`, `EdgeType`                                           |
| Reused audio engine | `Episode`, `EpisodeSegment`, `EpisodeVersion`, interaction/reference models used by listening audio |
| Provider config     | `UserAiKey`, `UserTtsKey`, model config, provider settings, voice settings                          |
| Operations          | queue/job metadata, reports, audit/admin records, usage and cost records                            |

`Episode` is the audio engine the listening skill reuses — script generation, verification, TTS, stitching, playback, and references — backing listening sections, listening practice, and exam listening.

---

## 4. Request Pattern

API routes follow the same shape:

```text
authenticateRequest()        # Bearer sk_sotto_... first, then the local session fallback
  -> validate input with Zod
  -> check ownership or admin permission against the authenticated userId
  -> perform a small database change or enqueue work
  -> return NextResponse.json()
```

Most `/api/v1` routes authenticate with `authenticateRequest()`, which accepts a Bearer `sk_sotto_` API key first — used by the `sotto` CLI, local agents, and connected devices — and falls back to the web session. In the single-learner build `auth()` resolves to the local owner without session verification, so the API trusts the local owner by construction: a remotely exposed instance must be gated at the proxy/deploy layer, and admin-only routes resolve the authenticated user's role with `isUserAdmin(userId)` rather than the ambient session.

Routes should not run LLM calls, TTS calls, transcription, video work, or audio stitching directly. They enqueue jobs or call narrow synchronous helpers only when the work is intentionally lightweight, such as scoring a writing response.

---

## 5. Worker Pipeline

The main learning work is split across class, audio, speaking, reference, and key-validation workers.

Class generation flow:

```text
course + lesson + CEFR level + memory seed + course note
  -> section specs
  -> grammar questions
  -> reading passage + questions
  -> listening audio request
  -> speaking prompts
  -> writing prompts
  -> CourseClass AVAILABLE
```

Listening audio reuses the existing audio pipeline:

```text
lesson spec, source, vocabulary set, CEFR level, or exercise prompt
  -> content extraction / curriculum resolution
  -> script generation
  -> script verification
  -> reference validation
  -> audio generation
  -> audio stitching
  -> listening section, practice session, or mock exam
```

Audio statuses remain:

```text
PENDING
DISCOVERING
EXTRACTING
RESEARCHING
PLANNING
SCRIPTING
COMPILING
SCRIPT_READY
GENERATING_AUDIO
STITCHING
READY
UPDATING
IMPORTING
TRANSCRIBING
FAILED
```

Speaking flow:

```text
SpeakingRecording
  -> STT transcription through resolveSttProvider()
  -> pronunciation scoring
  -> rubric and phoneme feedback
  -> status SCORED or FAILED
```

Speaking uploads carry containerized audio bytes only. `detectAudioFormat()` sniffs the leading magic bytes (WebM, WAV, Ogg, FLAC, MP4, MP3) to set the stored R2 extension, the content type, and the STT filename/MIME — the browser uploads WebM/Opus, the `sotto` CLI uploads WAV. Raw PCM must be wrapped as WAV before upload.

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
learning request
  -> selected provider or local-agent profile
  -> capability requirement (LLM, TTS, STT)
  -> resolver validates credentials, base URL, and model config
  -> concrete provider client
```

Expected resolvers:

- `resolveLearningAi()` for placement, class generation, practice generation, scoring, memory extraction, and curriculum work.
- `resolveTtsProvider()` for listening audio, reference pronunciation audio, and spoken feedback.
- `resolveSttProvider()` for learner recordings.
- `resolveAutoModel()` and related model config helpers where admin-configured model selection is still used.

Resolver output should be either:

- a concrete provider client and model/settings, or
- a typed setup error with missing capability and action.

No worker should silently route to a different provider because another API key is present.

---

## 7. Local Agents

Local-agent support is modeled as a provider family. Supported profiles include:

- Claude Code.
- Codex.
- OpenClaw.
- Hermes.
- Generic command adapter when explicitly configured.

The generic adapter should require explicit opt-in and configuration:

- command template
- working directory
- input file
- output file
- timeout
- environment allowlist

Agent outputs should be treated as private learner data. Logs must avoid leaking prompts, transcripts, course notes, API keys, recordings, or raw source content.

---

## 8. Source Ingestion

Sotto supports learning context, not public content distribution. Current input types should feed course generation, practice, or the memory graph:

| Input                  | Trigger                                         | Output                                                      |
| ---------------------- | ----------------------------------------------- | ----------------------------------------------------------- |
| Placement              | learner starts a language pair                  | `Course` and `PlacementResult`                              |
| Course note            | learner edits goals/background/interests        | personalization for placement, classes, and practice        |
| Sourced class          | learner provides a URL or topic                 | CEFR-leveled class with verified references where available |
| Agent context          | local agent/MCP/API ingestion                   | private learning context for the learner's course           |
| Live conversation      | learner finishes a Gemini Live session          | target-language vocabulary extracted into the memory graph  |
| Practice/exam attempts | learner submits answers, recordings, or writing | SRS updates, scores, feedback, mock band                    |

Common requirements:

- user ownership
- authentication or token validation
- idempotency where external agents submit data
- queue handoff for heavy work
- raw inputs handled as private learner data

Do not describe meeting recap, news briefing, public feed, or bot workflow surfaces as current behavior.

---

## 9. Learning API Surfaces

The current learning API surface is under `/api/v1`:

| Endpoint                                           | Purpose                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| `/api/v1/placement`                                | Generate and submit placement, then create a course                  |
| `/api/v1/courses`                                  | List and create learner courses                                      |
| `/api/v1/courses/[courseId]/next-class`            | Generate the next gated class, optionally from a source URL or topic |
| `/api/v1/courses/[courseId]/graph`                 | Fetch memory graph vocabulary, grammar, and edges                    |
| `/api/v1/courses/[courseId]/topics`                | Suggest sourced-class topics from learner interests                  |
| `/api/v1/courses/[courseId]/notes`                 | Read and update course-scoped learner notes                          |
| `/api/v1/courses/[courseId]/practice`              | Inspect due counts and start ungated practice                        |
| `/api/v1/classes/[classId]`                        | Fetch or regenerate class sections                                   |
| `/api/v1/classes/[classId]/submit`                 | Submit a class and advance on mastery                                |
| `/api/v1/classes/[classId]/speaking/[promptId]`    | Upload a class speaking recording                                    |
| `/api/v1/classes/[classId]/writing/[promptId]`     | Submit and score class writing                                       |
| `/api/v1/classes/[classId]/worksheet`              | Fetch or generate worksheet PDF                                      |
| `/api/v1/practice/[sessionId]/submit`              | Submit ungated practice and update SRS                               |
| `/api/v1/practice/[sessionId]/speaking/[promptId]` | Upload/poll practice speaking                                        |
| `/api/v1/practice/[sessionId]/writing/[promptId]`  | Submit and score practice writing                                    |
| `/api/v1/exams`                                    | Start a mock exam                                                    |
| `/api/v1/exams/[examId]`                           | Fetch exam sections                                                  |
| `/api/v1/exams/[examId]/submit`                    | Submit and score exam answers                                        |
| `/api/v1/exams/[examId]/speaking/[promptId]`       | Upload/poll exam speaking                                            |
| `/api/v1/exams/[examId]/writing/[promptId]`        | Submit and score exam writing                                        |
| `/api/v1/live-translate/token`                     | Mint a BYOK Google Live token without exposing the key               |
| `/api/v1/live-translate/session`                   | Store live conversation transcript and extract vocabulary            |

Existing `/api/v1/episodes/*` routes may still be used by the reused audio engine and player components. They should not be documented as the primary product surface.

---

## 10. Storage

Local storage is the default for OSS.

| Deployment                         | Storage                                 |
| ---------------------------------- | --------------------------------------- |
| Local OSS                          | local filesystem under `.sotto/storage` |
| VPS self-hosted                    | local volume or S3-compatible storage   |
| Managed infrastructure, if offered | S3/R2-compatible storage                |

Storage rules:

- Workers must respect `STORAGE_PROVIDER`.
- Local storage must support the full listening audio, worksheet, recording, and export paths.
- No cleanup script may bulk-delete protected episode or segment audio by pattern.
- Deletion paths must go through existing storage guards.

---

## 11. Security

Security priorities:

- Bearer `sk_sotto_` API-key auth for `/api/v1` (CLI, local agents, connected devices), with the web session as fallback; admin-only routes resolve the authenticated user's DB role, not the ambient session.
- Route-level ownership checks for every course, class, practice session, exam, recording, and memory graph.
- Encrypted user provider keys.
- Token-authenticated local-agent and connected-device API flows.
- Short-lived live-translation tokens that keep the learner's BYOK Google key server-side.
- Redaction of provider keys, course notes, prompts, recordings, transcripts, and raw source content from logs.
- Admin inspection that is explicit and auditable.

Learning data is sensitive. Course notes, vocabulary graphs, speaking recordings, writing responses, and agent context should be treated as private learner records.

---

## 12. Managed Hosting

The active product should not depend on managed hosting or Sotto billing. The free self-hosted build includes the full learning loop.

If managed infrastructure exists, it reuses the same architecture:

- app runtime
- worker runtime
- PostgreSQL
- Redis
- storage
- provider configuration
- backups and monitoring

Boundaries:

- Privacy stays available on OSS and local paths.
- Provider custody must be explicit when Sotto-managed keys are used.
- Every learner gets full access to the learning loop for free, on infrastructure they control.

---

## 13. Observability

Track private learning and operational health:

- course count and active class status
- placement completion
- class pass/fail and regeneration rates
- practice due counts and completion
- memory graph due items and mastery distribution
- speaking grading duration and failure reason
- writing scoring duration and failure reason
- listening audio job duration and failure reason
- provider latency and provider cost estimate
- storage writes and recording/audio availability
- setup readiness for LLM, TTS, STT, local agent, Redis, database, and storage

---

## 14. Release Guardrails

The architecture is considered aligned when:

- `npm run ci` passes.
- Prisma validates and generates.
- OSS guard tests pass.
- Root docs describe free, self-hostable language-learning onboarding.
- Local setup works without Doppler.
- Placement, courses, classes, practice, exams, memory, speaking, writing, and listening are documented against current routes and schema.
- Provider setup errors are explicit.
- Listening audio works through the reused audio pipeline without positioning Sotto as a episode platform.
