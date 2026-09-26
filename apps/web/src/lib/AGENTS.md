# src/lib/ — Core Libraries

All shared business logic and external service integrations live here.

`sidedoor/storage-probe-runtime.ts` adapts the shared probe lifecycle to a captured
backend, original authority callback and dedicated PostgreSQL lock. It checks
configuration and authority after lock release. `storage-probe.ts` supplies owner
authority for onboarding. Worker preflights must reuse their probed backend for
publication and run inside their existing execution lifetime. Shared
`StorageProbeCleanupError` preserves unresolved probe ownership across that boundary.

Profile deletion retains registered storage and relocation endpoint dependencies
before cascading application rows. Shared relocation erasure runs in that same
Serializable transaction under the exact cleanup job and profile tombstone.
Cleanup remains preparing until every manifest is classified. Missing endpoint
attribution stays unresolved; removing metadata does not prove byte deletion.
The pre-cascade visitor retires only exact registered consumers belonging to the
deleted profile generation. Inventory and deletion share `storage-consumers.ts`.
Other consumers remain registered. Historical shared scopes still need explicit
ownership separation before deletion can preserve surviving consumers' access.

`sidedoor/storage-migration-plan.ts` reads bounded canonical asset pages under
original owner authority. It retains historical destinations and every live
consumer claim, reports stale or unsupported consumers, and rejects erased
ownership scopes. Inventory is read-only and does not authorize publication or
a configuration switch. `storage-migration-references.ts` separately scans all
twelve application reference fields in bounded pages. Missing attribution,
including external URLs and empty values, is reported explicitly. Neither scan
guesses a historical backend from current configuration.
Course worksheets and focus-target pronunciation and visual references use
`course-storage.ts` to capture the exact course, owner and instance generations.
Inventory rejects changed or erased ownership instead of expanding saved scopes.
Episode storage also includes the independent exam owner when an exam is attached.
`speaking-storage.ts` captures prompt parents and recording ownership separately,
including an independently owned recording practice session. Scalar recording
section IDs require explicit lookup. Captures retain association IDs as well as
scopes so producers can detect parent changes within the same course.
`storage-migration-dry-run.ts` combines the two passes with bounded memory and
diagnostics. Its `migrated` counter means individually eligible references;
`hasBlockers` includes orphaned or stale sibling consumers. It revalidates owner
authority before returning and never authorizes a later copy or switch.
`planStorageDestination` in `storage-configuration.ts` resolves a target without
creating its local directory or connecting to object storage. Execution must
compare the captured destination with that plan; a path binding is not an inode.

`storage-publication.ts` verifies exact references or explicit shared relocation
chains and returns the original registered attribution. It bounds lookup to 1,000
relocations and propagates cancellation. Transcript proof keeps its sealed source
fingerprint and original reference. `initial-stitch-relocation.ts` normalizes only
verified storage fields in a temporary comparison for completed replay. Segment
identity, content, ordering, voice, timings, generation and ownership remain exact.
Pending work retains its original strict admission and replacement claims.

`sidedoor/transcript-export.ts` admits request-based PDF queue version 2 for READY
episodes, including imports without stitching history. The original request
delegates background completion. Requester deletion and visibility changes fence
the job; published storage retains only the episode owner's scopes. Version 1
continues to require stitching ancestry. `transcript-publication.ts` verifies
owner-scoped Episode metadata and registered consumer attribution when concurrent
requests reuse a result, including after the producing requester job was erased.

`sidedoor/initial-stitch-inputs.ts` captures the original generation key, ownership,
ordered segment content and attributed storage. `initial-stitch-admission.ts`
prepares an explicit sound policy and atomically records the outbox job, attempt
identity and STITCHING phase. Producers must use Serializable transactions and
original request or generation-job authority. Both segment-generation producers
and the HTTP stitching resume route admit version 2 jobs. Final segment audio,
storage attribution and stitching admission commit in the same transaction.

`admitInitialStitch` reconciles concurrent producers using the stored winning
attempt and returns waiting, admitted or existing work. Allocate identities before
transaction retries. `verifyCurrentInitialStitch` only reads and validates the
current attempt, including its sealed outcome after publication; recovery must
never invoke a helper that could admit new work.

`initial-stitch-failure.ts` atomically records a processing failure, its reserved
notification/status effects and sealed outcome after validating current ownership
and inputs. Reconciliation consumes verified failed v2 deliveries. Administrator
retry revalidates the original request and admits a new canonical job ID. Storage
write and execution guards reject replacement while earlier cleanup is unresolved.

`sidedoor/job-execution-lifetime.ts` adapts shared `runJobExecution` to Sotto
transactions and authority validation. Its private temporary location has a
persistent inode-bound marker. Waveform and stitching jobs use only the directory
supplied by that lifecycle. Publication and cleanup receipts remain independent. Recovery
reads the exact binding after a lost COMMIT response and revalidates work before
execution. If cancellation or revocation prevents unstarted work, cleanup still
settles that admission. Uncertain provider outcomes and cleanup failures stay
unresolved. Sound-effect requests report transport invocation after authority
admission, so rejection before dispatch does not strand an execution. Responses
use shared owned text/binary readers that await body cancellation. Dispatched
failures remain conservative. Complete documented ElevenLabs rejections settle
the request; successful synchronous responses require MP3 recognition before
settlement and later FFmpeg validation. Truncated or ambiguous responses remain
unresolved. Practical body limits and operator resolution remain open.

`audio/media-process.ts` runs FFmpeg and FFprobe through the shared process runner.
It preserves per-stream output limits and workloads without a wall-clock deadline.
Cancellation waits for process cleanup and retains typed cleanup failures.
Stitching passes the worker signal through encoding and duration measurement.
Boundary detection and fingerprint subprocesses use the same runner and signal.
Boundary analysis creates files beneath the caller's execution workspace and yields during correlation so
cancellation can arrive. Optional analysis preserves wrapped cleanup errors.

Waveform extraction uses the shared binary process stream for stereo PCM and
the same media helper for FFprobe and spectrogram generation. It preserves
30-second probe and 300-second decoder/image deadlines. Binary output is
processed into temporal energy bins without retaining the recording; stderr
diagnostics retain at most 64 KiB. Partial stereo frames fail the operation.

`sidedoor/initial-stitch-contract.ts` strictly validates v2 inputs, sound policy
and output identities. Preparation allocates output IDs once and stores them in
the job; transaction retries and serialized replay retain those exact IDs.

`sidedoor/stitching-parent.ts` selects initial or incorporation ancestry from the
durable receipt version, then validates completion, fingerprint and scopes through
the shared parent reader. Initial children must match the saved effect ID. Artifact
admission additionally requires the saved version-row ID.

`sidedoor/initial-stitch-outcome.ts` seals one shared job snapshot atomically with
publication, parent completion and downstream jobs. It distinguishes READY from
duration failure and binds every effect to its actual fingerprint. Completed
producer replay reauthorizes the original attempt and verifies current inputs,
the exact version and both registered audio consumers. Superseded results reject
without re-enqueuing work. Snapshots follow shared job retention and erasure.

`sidedoor/credential-validation-work.ts` schedules bounded canonical credential
pages and verifies exact owner, instance, revision and endpoint bindings around
external probes. Rejections and durable owner notifications commit together.
Queue failures never infer a credential from the current provider or profile.

`sidedoor/credential-selection-contract.ts` composes the shared credential schemas
for owner context and selected personal revisions. `credential-endpoints.ts`
maps settings endpoints to physical slots. `credential-selection.ts` validates
that context, selected slots and availability before and after onboarding work.
Effective shared credentials still require their own runtime admission.

`agent-usage/account.ts` captures complete canonical or platform audio accounts,
returns immutable fields, and shares admission between HTTP and cache publication.
Its process-local keyed fingerprints include recipient, credential and account
identity. Callers include billing windows and validate before returning cached data.

AI and speech credential reads in `byok.ts` use Sidedoor owned credentials and explicit
sharing grants. The returned selection contains auxiliary fields and provenance
from the same transaction. Speech generation and Cartesia usage must consume that
selection without rereading another key or borrowing another account's fields.
`sidedoor/credential-settings.ts` accepts complete credentials or a field patch
bound to the revision displayed to the user. Patches preserve saved secrets and
are validated before replacing that exact revision.
`sidedoor/credential-http.ts` binds the shared edit protocol to authenticated settings
routes. `sidedoor/credential-browser.ts` handles browser transport and reconciles
uncertain outcomes against the exact submitted revision without resubmitting.
`sidedoor/provider-credentials.ts` separates metadata inspection from exact-revision
execution. Its bounded listings retain disabled personal slots ahead of grants
and work without decrypting secrets. Visual credentials stay private.
Provider-omitted AI requests preserve personal-before-shared selection, then
Anthropic preference and creation order among enabled credentials. Explicit
provider requests surface disabled or unreadable credential errors.

`providers/credential-fields.ts` projects shared Sidedoor provider credential
descriptors into the existing settings form fields. Provider help links and
credential requirements come from the shared catalog; app ordering and model
defaults remain in the modality registries.
Compatible LLM and Whisper transports use the shared catalog's endpoint
metadata. Credentials are selected by the caller's provider and ownership rules.

`providers/api-selection.ts` captures endpoint configuration separately from
credential resolution and builds the same transport selection for generation
and validation.

`providers/local-tts-connection.ts` captures sidecar endpoint, optional proxy key,
model and voice pool before provider construction. Local and Kokoro speech use
the shared transport and original caller admission for every HTTP request.

`sidedoor/job-reconciliation.ts` restores incomplete durable work through the shared
outbox page and task loop. `sidedoor/job-contracts.ts` defines supported queue
versions and keeps durable references out of unrelated processing and failure handling.
Dispatcher connections belong to `withDispatchQueue()` and are closed on cancellation.

`sidedoor/job-erasure.ts` completes previously validated durable work only when
a captured scope has a matching generation tombstone and referenced cleanup
identity. Call it in the completion transaction before reading application
rows that deletion may have cascaded. Missing data alone is not deletion proof.
Retain tombstones and cleanup identities while durable jobs can be replayed.

## File Index

| File                           | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | External Service                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `prisma.ts`                    | Database client (PostgreSQL)                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Prisma ORM                                                                                               |
| `redis.ts`                     | Redis connections, cache helpers, rate limiting                                                                                                                                                                                                                                                                                                                                                                                                                                | Redis / ioredis                                                                                          |
| `queue.ts`                     | BullMQ job queues (27 types), worker creation                                                                                                                                                                                                                                                                                                                                                                                                                                  | BullMQ + Redis                                                                                           |
| `auth.ts`                      | Shared browser content identity: validates the shared session and selected learner in one Serializable transaction. Household profiles never grant owner authority; no ambient owner is created. React caching is request-local.                                                                                                                                                                                                                                               | Prisma ORM and Sidedoor                                                                                  |
| `site-config.ts`               | Sidedoor-backed `getSiteConfig()`/`setSiteConfig()`. Holds owner-set non-secret server infrastructure, including AI, speech, and local/R2/S3 storage settings.                                                                                                                                                                                                                                                                                                                 | Uses `sidedoor/store.ts`                                                                                 |
| `server-config.ts`             | Cached access to owner-managed non-secret infrastructure settings. Provider credentials are resolved only through Sidedoor.                                                                                                                                                                                                                                                                                                                                                    | Uses `site-config.ts`                                                                                    |
| `self-hosted.ts`               | `isSelfHosted()` — true by default; `SELF_HOSTED=false` marks the managed showcase, where the /welcome wizard runs as a non-persisting demo                                                                                                                                                                                                                                                                                                                                    | Environment                                                                                              |
| `avatars.ts`                   | Preset profile avatars: Colombian-tropic animals (`ANIMAL_AVATARS`), `avatarImagePath()`, `getAnimalAvatar()`, `resolveProfileAvatar(seed,image)` (always returns a `/avatars/*.png`, deterministic animal fallback). Images at `public/avatars/{slug}.png` (Gemini-generated via `scripts/generate-avatars.mjs`). Used by the picker, AvatarMenu, AccountSwitcher, settings grid.                                                                                             | Pure utility                                                                                             |
| `profile-cookie.ts`            | Canonical household profile-selection cookie name.                                                                                                                                                                                                                                                                                                                                                                                                                             | Used by profile selection, self-service erasure, and factory reset routes.                               |
| `profiles.ts`                  | `getHouseholdProfiles()` — owner-first household list with the resolved animal avatar + a one-line course summary (most recent targetLang + currentLevel). Backs `GET /api/v1/profiles` and the picker.                                                                                                                                                                                                                                                                        | Uses `prisma.ts`, `avatars.ts`                                                                           |
| `theme-prefs.ts`               | Per-profile appearance cookie (`THEME_PREFS_COOKIE` = `sotto_theme`): `ThemePrefs` shape, `themePrefsFromUser()`, `serializeThemePrefs()`, `DEFAULT_THEME_PREFS`. The switch route + users/me PATCH keep the readable cookie in sync; the init script applies it flash-free.                                                                                                                                                                                                   | Pure utility                                                                                             |
| `languages.ts`                 | `LANG_LABELS` + `langLabel(code)` — human language names for course codes. Shared by the learn hub and profile summaries.                                                                                                                                                                                                                                                                                                                                                      | Pure utility                                                                                             |
| `speech-language-support.ts`   | Shared Sotto language-code support for speech providers: canonical ISO 639-1 set, provider language support sets, welcome-provider compatibility helpers, and provider code conversions such as ElevenLabs Scribe `es` ↔ `spa`.                                                                                                                                                                                                                                                | Pure utility                                                                                             |
| `provider-usage/allowances.ts` | Shared provider usage allowance presets and metadata field names for provider settings, onboarding, and usage-status estimators                                                                                                                                                                                                                                                                                                                                                | Pure utility                                                                                             |
| `sidedoor/`                    | Canonical password and passkey access, sessions, devices, invitations, provider credentials, storage, durable work, and request identity.                                                                                                                                                                                                                                                                                                                                      | Sidedoor core, Prisma, Redis                                                                             |
| `auth-guards.ts`               | Admin route helper (`requireAdmin()`)                                                                                                                                                                                                                                                                                                                                                                                                                                          | Uses `auth.ts`                                                                                           |
| `llm.ts`                       | Anthropic LLM client (streaming + non-streaming), with auto-routing guardrail for non-Anthropic models                                                                                                                                                                                                                                                                                                                                                                         | Anthropic API / local agent CLI                                                                          |
| `local-agent client`           | supported local agent CLI wrapper (`local CLI`): serialize messages, execute, stream                                                                                                                                                                                                                                                                                                                                                                                           | local agent CLI                                                                                          |
| `agent-availability.ts`        | Cached local/SSH CLI version and authentication probes with typed readiness for supported local agents                                                                                                                                                                                                                                                                                                                                                                         | Local CLI / SSH                                                                                          |
| `agent-credentials.ts`         | Networkless sidecar snapshot installation and nonce-based local CLI credential reload; never available for SSH agents                                                                                                                                                                                                                                                                                                                                                          | Shared Docker volume                                                                                     |
| `agent-invocation.ts`          | Shared direct-or-SSH agent command construction for CLI-backed providers                                                                                                                                                                                                                                                                                                                                                                                                       | Local CLI / SSH                                                                                          |
| `agent-messages.ts`            | Shared message serialization for CLI-backed AI providers                                                                                                                                                                                                                                                                                                                                                                                                                       | Pure utility                                                                                             |
| `local-command.ts`             | Cached local command availability checks for CLI-backed providers and private source connectors                                                                                                                                                                                                                                                                                                                                                                                | Local CLI binaries                                                                                       |
| `source-connectors.ts`         | Private source connector registry and readiness for Slack, Gmail via Google Workspace CLI, supported local agent, and Codex                                                                                                                                                                                                                                                                                                                                                    | Slack app env, Google Workspace CLI, local agent CLIs                                                    |
| `agent-usage/`                 | Server-side provider usage summaries for the dashboard: per-provider modules read local agent auth or configured provider keys, query usage/rate-limit/subscription surfaces, cache results, and return only browser-safe windows/credits                                                                                                                                                                                                                                      | supported local agent OAuth, ChatGPT/Codex auth, ElevenLabs, Cartesia                                    |
| `elevenlabs.ts`                | ElevenLabs TTS client, voice ID mapping                                                                                                                                                                                                                                                                                                                                                                                                                                        | ElevenLabs API                                                                                           |
| `generation-limits.ts`         | Plain generation ceilings (`MAX_LESSON_DURATION_MINUTES`). No plans, tiers, or quotas — uniform safety limits                                                                                                                                                                                                                                                                                                                                                                  | Pure utility                                                                                             |
| `r2.ts`                        | Runtime media storage helpers for the storage provider selected in Sidedoor configuration                                                                                                                                                                                                                                                                                                                                                                                      | AWS S3 SDK / local filesystem                                                                            |
| `storage/migration.ts`         | Admin storage migration: copies known media references between local, R2, and S3, updates DB URLs after successful copies, and leaves old files in place                                                                                                                                                                                                                                                                                                                       | Uses storage providers, Prisma                                                                           |
| `duration.ts`                  | Centralized duration constants (WPM, chars/sec, tolerance) & helpers (word↔minute, bounds, estimation)                                                                                                                                                                                                                                                                                                                                                                         | Pure utility                                                                                             |
| `cefr-levels.ts`               | Canonical CEFR ordering: `CEFR_ORDER`, `cefrRank()`, `higherLevel()`. Single source of truth for level comparison (placement re-take never lowers currentLevel)                                                                                                                                                                                                                                                                                                                | Pure utility                                                                                             |
| `feedback-formatter.ts`        | Format user feedback (general, per-turn, highlights) into prompt string for script revision                                                                                                                                                                                                                                                                                                                                                                                    | Pure utility                                                                                             |
| `script-generator.ts`          | 2-voice episode script generation with `[N]` citations + revision with feedback (fact-checker + user)                                                                                                                                                                                                                                                                                                                                                                          | Uses `llm.ts`                                                                                            |
| `script-verifier.ts`           | AI-based "teacher" agent: extracts claims, evaluates sourcing, enforces duration limits                                                                                                                                                                                                                                                                                                                                                                                        | Uses `llm.ts`                                                                                            |
| `reference-validator.ts`       | Source quality pre-filter (`assessSourceQuality`), URL HEAD, CrossRef DOI, OpenAlex title-search layers. Used by `reference-verification/` pipeline.                                                                                                                                                                                                                                                                                                                           | fetch, `llm.ts`                                                                                          |
| `reference-verification/`      | Domain-aware verification pipeline: `classifyReference()` → applicable layers → AI batch call → grounding (OpenAlex + AI web search for fully-failed refs) → `computeBayesianScore()`. Exports `runReferenceVerification()`, `groundFailedReferences()`.                                                                                                                                                                                                                       | `groundcheck`, `llm.ts`                                                                                  |
| `script-updater.ts`            | Citation cleanup + renumbering when references are removed after verification                                                                                                                                                                                                                                                                                                                                                                                                  | Pure utility                                                                                             |
| `references.ts`                | `persistGeneratedReferences(episodeId, refs)` — maps all 8 `GeneratedReference` fields onto `Reference` rows via `createMany` (`skipDuplicates`); no-op for empty. Used by sourced-class listening generation.                                                                                                                                                                                                                                                                 | Uses `prisma.ts`                                                                                         |
| `segment-creator.ts`           | Shared utility: create Segment records from script turns and queue audio generation jobs (used by reference-validation, script approve endpoint)                                                                                                                                                                                                                                                                                                                               | Uses `prisma.ts`, `queue.ts`                                                                             |
| `citation-parser.tsx`          | Parse `[N]` citation markers in text → React CitationMarker components                                                                                                                                                                                                                                                                                                                                                                                                         | React                                                                                                    |
| `pdf-generator.ts`             | `generateEpisodeTranscript()` — build an academic-style transcript as markdown text with `[N]` references (uploaded as-is; no PDF lib)                                                                                                                                                                                                                                                                                                                                         | Pure utility                                                                                             |
| `audio-stitcher.ts`            | FFmpeg segment concatenation + crossfades + SFX overlay (`adelay`, `duration=first`) + loudness normalization. `SfxInsert` includes `delayMs` for positioning. `skipSfx` flag bypasses SFX on re-stitch.                                                                                                                                                                                                                                                                       | FFmpeg (CLI)                                                                                             |
| `waveform-extractor.ts`        | FFmpeg-based waveform peak extraction (astats RMS → normalized 0-1 array) and spectrogram PNG generation (showspectrumpic)                                                                                                                                                                                                                                                                                                                                                     | FFmpeg (CLI)                                                                                             |
| `byok.ts`                      | Multi-provider credential lookup and usage tracking through Sidedoor-owned encrypted credentials                                                                                                                                                                                                                                                                                                                                                                               | Uses `sidedoor/provider-credentials.ts`                                                                  |
| `visual-cue-keys.ts`           | Resolves encrypted, owner-scoped Pexels credentials through Sidedoor and records credential use.                                                                                                                                                                                                                                                                                                                                                                               | Uses `sidedoor/provider-credentials.ts`                                                                  |
| `byok-errors.ts`               | BYOK job failure classifier: `classifyError()` → `auth_invalid`, `insufficient_credits`, `rate_limited`, `provider_error`; `isKeyInvalidationError()`, `userMessage()`                                                                                                                                                                                                                                                                                                         | Pure utility                                                                                             |
| `content-parser.ts`            | Public content extraction facade backed by `extractors/`.                                                                                                                                                                                                                                                                                                                                                                                                                      | Uses `extractors/`                                                                                       |
| `extractors/`                  | Multi-layer content extraction: Readability + cheerio HTML, pdf-parse PDF, YouTube transcript, Pinchtab browser fallback. Facade via `extractContent(url)` and `extractFromPdfBuffer(buffer)`, returns `ExtractedContent`                                                                                                                                                                                                                                                      | jsdom, @mozilla/readability, cheerio, fetch                                                              |
| `push-notifications.ts`        | Web Push API: send to user devices, clean expired subs                                                                                                                                                                                                                                                                                                                                                                                                                         | web-push                                                                                                 |
| `validations.ts`               | Zod schemas for all API input validation (re-exports `createEpisodeSchema` from `@sotto/shared`; includes addToAllowlistSchema)                                                                                                                                                                                                                                                                                                                                                | Zod                                                                                                      |
| `api-response.ts`              | `errorResponse()` helper: returns JSON error with `requestId` for tracking, logs 5xx errors, sets `x-request-id` header                                                                                                                                                                                                                                                                                                                                                        | Uses `logger.ts`                                                                                         |
| `logger.ts`                    | Structured logging with levels (debug/info/warn/error)                                                                                                                                                                                                                                                                                                                                                                                                                         | Console                                                                                                  |
| `notifications.ts`             | In-app notification helpers                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Uses `prisma.ts`                                                                                         |
| `voice-pool.ts`                | Unified voice pool: 16 curated voices with per-provider IDs, deterministic `selectVoicePair(episodeId)` hash, `resolveVoiceId()`, `findByVoiceId()`                                                                                                                                                                                                                                                                                                                            | Pure utility                                                                                             |
| `pipeline-resume.ts`           | Smart resume: `markEpisodeFailed(episodeId)` records `failedAtStatus`, `determineResumePoint(episodeId)` inspects existing data (Script, Segments, References) and returns the optimal pipeline restart step                                                                                                                                                                                                                                                                   | Uses `prisma.ts`                                                                                         |
| `private-ingestion.ts`         | Shared helper for owner-scoped ingestion routes that create private episodes, discovery source content, source-specific ledger rows, and content-extraction jobs                                                                                                                                                                                                                                                                                                               | Uses `prisma.ts`, `queue.ts`                                                                             |
| `api-keys.ts`                  | API key generation, hashing, validation                                                                                                                                                                                                                                                                                                                                                                                                                                        | crypto                                                                                                   |
| `tag-icons.tsx`                | Tag slug → SVG icon mapping (12 categories), `TagIcon` component, `ONBOARDING_TAG_SLUGS` array                                                                                                                                                                                                                                                                                                                                                                                 | React (SVG)                                                                                              |
| `class-topics.ts`              | `suggestClassTopics(userId)` — sourced classes: turn the learner's interest tags (highest weight first) into class-topic suggestions for `createNextClass({ topic })`; curiosity-starter fallback when no interests. Deterministic, no LLM                                                                                                                                                                                                                                     | Uses `prisma.ts`                                                                                         |
| `auto-model-config.ts`         | `getAutoModelConfig()` / `setAutoModelConfig()` for Sidedoor-backed provider defaults and included model lists                                                                                                                                                                                                                                                                                                                                                                 | Uses `sidedoor/store.ts`                                                                                 |
| `pricing.ts`                   | AI model pricing table + cost lookup: `getAiCost()`, `getAiPricing()`, `getCheapestModel()`, `refreshPricingFromDb()`, `getAllCurrentPricing()`, `startPricingRefreshInterval()` — centralized pricing with dynamic DB refresh                                                                                                                                                                                                                                                 | Pure utility + `pricing-fetcher.ts`                                                                      |
| `pricing-fetcher.ts`           | Pricetoken API fetcher: `fetchPricingFromPricetoken()`, `savePricingSnapshots()`, `getLatestPricingFromDb()`, `getAdminOverriddenModels()`, `seedPricingFromRegistry()`, `filterToKnownModels()`                                                                                                                                                                                                                                                                               | Uses `prisma.ts`, `pricetoken`, `ai-registry.ts`                                                         |
| `pricing-metrics.ts`           | Admin pricing queries: `getCurrentModelPricing()`, `getModelPriceHistory()`, `getLastFetchTime()` — enriches pricing with registry metadata                                                                                                                                                                                                                                                                                                                                    | Uses `prisma.ts`, `pricing.ts`, `ai-registry.ts`                                                         |
| `usage-logger.ts`              | Unified `logUsage()` function for all provider cost tracking — replaces old `logApiUsage()`, auto-computes AI costs from model pricing                                                                                                                                                                                                                                                                                                                                         | Uses `prisma.ts`, `pricing.ts`                                                                           |
| `episode-data.ts`              | React.cache-wrapped episode detail query (deduplicates generateMetadata + page fetch)                                                                                                                                                                                                                                                                                                                                                                                          | Prisma ORM                                                                                               |
| `segment-utils.ts`             | Shared segment utilities: `findActiveIndex()` for time-based segment lookup                                                                                                                                                                                                                                                                                                                                                                                                    | Pure utility                                                                                             |
| `detect-urls.ts`               | URL detection in message strings (client-safe, no server dependencies)                                                                                                                                                                                                                                                                                                                                                                                                         | Pure utility                                                                                             |
| `embeddings.ts`                | Embedding provider abstraction (384-dim): stub hash-based for dev, swap to `text-embedding-3-small`                                                                                                                                                                                                                                                                                                                                                                            | Pure utility (swappable)                                                                                 |
| `language-detect.ts`           | Language detection via explicitly supplied AI runtime → ISO 639-1 code                                                                                                                                                                                                                                                                                                                                                                                                         | Uses `providers/ai.ts`, `tts-language-support.ts`                                                        |
| `tts-language-support.ts`      | TTS language support lookups: `supportsLanguage()`, `getProvidersForLanguage()`, `getDefaultModelForLanguage()`, `SOTTO_LANGUAGE_CODES`, `VOICE_LANGUAGE_AFFINITIES` — thin query layer over registry language data and shared speech language codes                                                                                                                                                                                                                           | Uses `providers/tts-registry.ts`, `speech-language-support.ts`                                           |
| `moderation.ts`                | OpenAI Moderation API client: per-category thresholds, Redis caching (10min TTL)                                                                                                                                                                                                                                                                                                                                                                                               | OpenAI Moderation API, `redis.ts`                                                                        |
| `episode-gradient.ts`          | Deterministic gradient generation from episode ID (12 brand palettes)                                                                                                                                                                                                                                                                                                                                                                                                          | Pure utility                                                                                             |
| `safety-prompts.ts`            | Reusable LLM safety fragments: `CONTENT_SAFETY_INSTRUCTIONS`, `INPUT_SANITIZATION_INSTRUCTIONS`, `MATURE_AUDIENCE_GUIDANCE`                                                                                                                                                                                                                                                                                                                                                    | Pure constants                                                                                           |
| `slugify.ts`                   | URL-safe tag slug generator: `generateTagSlug(name)` (50 char cap)                                                                                                                                                                                                                                                                                                                                                                                                             | Pure utility                                                                                             |
| `theme-script.ts`              | Inline dark mode init script (`THEME_INIT_SCRIPT`) — prevents flash on page load                                                                                                                                                                                                                                                                                                                                                                                               | Pure utility                                                                                             |
| `topic-tagger.ts`              | Keyword-based topic tag matcher: maps topics to tag slugs (deterministic, no AI)                                                                                                                                                                                                                                                                                                                                                                                               | Pure utility                                                                                             |
| `media-bias.ts`                | MBFC media bias detection: domain lookup, alias resolution, political topic detection, `analyzeBias()` for source bias analysis                                                                                                                                                                                                                                                                                                                                                | Filesystem (static JSON)                                                                                 |
| `transcript-parser.ts`         | Transcript parser (SRT, VTT, plain text) → `ParsedSegment[]` with speaker diarization                                                                                                                                                                                                                                                                                                                                                                                          | Uses `llm.ts`                                                                                            |
| `tts-text-cleaner.ts`          | TTS text safety net: strips `[SFX:]` markers and `[N]` citations before sending to TTS. Provider-specific tag conversion handled upstream by `tts-tag-converter.ts`                                                                                                                                                                                                                                                                                                            | Pure utility                                                                                             |
| `tts-generation.ts`            | Shared TTS generation core used by the listening audio pipeline: semaphore-controlled concurrency, `generateSpeech` with full params, BYOK 404 fallback, 429 concurrency updates, FFprobe duration measurement, usage logging. Also exports `getPlatformTtsKey()`                                                                                                                                                                                                              | Uses `providers/tts.ts`, `redis.ts`, `byok.ts`, `elevenlabs.ts`, `audio-stitcher.ts`, `usage-logger.ts`  |
| `tts-tag-converter.ts`         | Explicit TTS tag converter: disabled by default; converts script inline markup to provider-native format only when a caller supplies an AI runtime                                                                                                                                                                                                                                                                                                                             | Uses `providers/ai.ts`, `tts-doc-fetcher.ts`                                                             |
| `tts-doc-fetcher.ts`           | TTS provider docs fetcher: fetches formatting docs from provider URL, Redis cache (24h TTL), HTML content extraction                                                                                                                                                                                                                                                                                                                                                           | Fetch + `redis.ts`                                                                                       |
| `placement-test.ts`            | Placement test generation + scoring: `generatePlacement(userId, native, target, note?)`, `scorePlacement()`, `toPublic()` — generates CEFR-adaptive MC questions and returns per-skill scores. Pair-agnostic (any native→target). Optional `note` informs level emphasis. Curricula for non-seeded pairs come from `curriculum-generator.ts`. Also `idkLabel()` (native "I don't know") and `deduceLevelFromNotes()` (LLM CEFR estimate from uploaded materials, no DB writes) | Uses `llm.ts`                                                                                            |
| `placement-notes.ts`           | Notes-based placement orchestration: `runNotesDeduction()` (deduce a level + cache the materials under a `placement-notes:` key), `getCachedNotesDeduction()`, `clearNotesDeduction()`. No DB writes — the course is created only on confirm                                                                                                                                                                                                                                   | Uses `placement-test.ts`, `redis.ts`                                                                     |
| `placement-course.ts`          | `createOrRaiseCourse(userId, native, target, level)` — create the pair's course at `level` or raise an existing `currentLevel` to it (never lowering, keeping `startLevel`). Shared by MC placement and notes-based placement                                                                                                                                                                                                                                                  | Uses `prisma.ts`, `curriculum-generator.ts`, `cefr-levels.ts`                                            |
| `note-upload.ts`               | Shared uploaded-file text extraction: `isUploadFile()`, `clipImportedText()`, `extractUploadText()`, `extractUploadTexts()` (text files direct, office/PDF/epub via Markit, clipped). Used by course-notes import and notes-based placement                                                                                                                                                                                                                                    | Uses `extractors/markit`                                                                                 |
| `class-generation.ts`          | Class content generation: builds ClassSection questions and SpeakingPrompts from Lesson spec + adaptive SRS seed                                                                                                                                                                                                                                                                                                                                                               | Uses `llm.ts`, `prisma.ts`                                                                               |
| `class-source.ts`              | `prepareClassSource()` — sourced classes: `extractContent()` a real link/paper/video → CEFR-level it to a target-language passage (prompt `class/level-source.md`) used as the reading passage AND the listening `sourceContent`. Throws `ClassSourceError` (fails closed, never fabricates a source)                                                                                                                                                                          | Uses `extractors/`, `learning-ai.ts`, `providers/ai.ts`                                                  |
| `class-service.ts`             | Class orchestration: `createNextClass()` (gating + generation), `getClassForUser()`, `regenerateFailedSections()`, `CourseNotFoundError`                                                                                                                                                                                                                                                                                                                                       | Uses `prisma.ts`, `queue.ts`                                                                             |
| `class-listening-generator.ts` | `composeListeningContent()` (content-only core: CLASS Episode + `generateScript()` + comprehension questions + graph nodes) and `generateClassListening()` (= core + ClassSection/LessonQuestion persistence). Reused by practice. Optional `note` personalizes generation                                                                                                                                                                                                     | Uses `prisma.ts`, `queue.ts`                                                                             |
| `class-speaking-generator.ts`  | `composeSpeakingPrompts()` (content-only core: LLM phrases + reference TTS, namespaced by `refId`) and `generateClassSpeaking()` (= core + ClassSection/SpeakingPrompt persistence). Reused by practice. Optional `note`                                                                                                                                                                                                                                                       | Uses `providers/tts.ts`, `prisma.ts`                                                                     |
| `class-writing-generator.ts`   | `composeWritingPrompts()` (content-only core: LLM writing tasks, no TTS) and `generateClassWriting()` (= core + ClassSection/WritingPrompt persistence). Reused by practice. Optional `note`                                                                                                                                                                                                                                                                                   | Uses `llm.ts`, `prisma.ts`                                                                               |
| `writing-grader.ts`            | `gradeWriting()` — synchronous LLM grade of a learner's writing: `{ overallScore, corrections:[{old,new,why}], feedback }`. Clamps score, filters malformed corrections                                                                                                                                                                                                                                                                                                        | Uses `llm.ts`                                                                                            |
| `practice-service.ts`          | Ungated practice: `startPractice(courseId, userId, kind, options?)` (VOCAB recall + cold-start guard, GRAMMAR/READING/LISTENING/SPEAKING/WRITING reusing the generator cores, FULL mixed catch-up) and `submitPractice()` (drives SRS — per-item for VOCAB-tagged questions, aggregate otherwise). Focus-target options pull learner-marked hard words/sentences into practice. No gating, no level change                                                                     | Uses `knowledge-graph.ts`, `learning-targets.ts`, the generator cores, `course-notes.ts`                 |
| `activity/heatmap.ts`          | Daily activity heatmap + streaks for the learn hub: `getActivityData(userId)` buckets the three append-only submission tables (PracticeSession by kind, ClassSubmission, ExamSubmission) into per-category counts per local calendar day (`User.timezone`, server-zone fallback) and computes current/longest streaks. Deliberately ignores mutable `lastReviewed` columns (no history, would double-count)                                                                    | Uses `prisma.ts`                                                                                         |
| `learning-targets.ts`          | Learner-marked difficult words, phrases, and sentences: normalizes selections, stores course-scoped focus targets, optionally attaches visual cues and generated pronunciation audio, and exposes focus targets to practice ranking. Pronunciation and visual cues use selected Sidedoor credentials.                                                                                                                                                                          | Uses `prisma.ts`, storage, TTS providers, `visual-cue-keys.ts`                                           |
| `course-notes.ts`              | Course-scoped learner notes: `getCourseNote()` / `setCourseNote()` + normalization/merge helpers + `formatNotesForPrompt()` (empty-safe `{{NOTES}}` block). Feeds placement + per-learner class/practice generation; never the shared curriculum                                                                                                                                                                                                                               | Uses `prisma.ts`                                                                                         |
| `knowledge-graph.ts`           | Per-course memory graph + SRS: `seedLessonItems()`, `applyReviewOutcome()` (updates SRS from class/practice scores), `getDueItems()` (due/weak), `getMemoryGraph()` (nodes + edges), `upsertLiveVocab()` (adds live-conversation words, no class provenance, keeps known SRS state)                                                                                                                                                                                            | Uses `prisma.ts`                                                                                         |
| `srs.ts`                       | Pure SM-2 scheduler: `reviewCard(state, quality, now)` returns updated ease / interval / dueAt / mastery from a review outcome; mastery uses the Sotto learning posterior from `@sotto/learning-model`                                                                                                                                                                                                                                                                         | `@sotto/learning-model`                                                                                  |
| `class-document.ts`            | `buildClassDocument()` — assembles a `ClassDocument` (from `@sotto/shared`) from a CourseClass with all sections, questions, prompts, QR data URLs, and app deep links                                                                                                                                                                                                                                                                                                         | Uses `prisma.ts`, `qr.ts`                                                                                |
| `qr.ts`                        | QR code generator: produces data-URL PNGs from a URL string (used by class documents for print-to-app deep links)                                                                                                                                                                                                                                                                                                                                                              | Pure utility (qrcode lib)                                                                                |
| `worksheet-html.ts`            | `renderWorksheetHtml()` — renders a `ClassDocument` to print-optimized HTML (used by the worksheet-pdf worker before Puppeteer PDF generation)                                                                                                                                                                                                                                                                                                                                 | Pure utility                                                                                             |
| `pronunciation/align.ts`       | Forced-alignment phoneme scorer: maps STT word-level timings to target phrase phonemes, returns per-word alignment ops                                                                                                                                                                                                                                                                                                                                                         | Pure utility                                                                                             |
| `pronunciation/scorer.ts`      | `resolvePronunciationScorer()` — selects and runs the appropriate pronunciation scoring strategy (alignment-based or LLM-based) based on available STT word timing data                                                                                                                                                                                                                                                                                                        | Uses `llm.ts`, `pronunciation/align.ts`                                                                  |
| `live-translate.ts`            | Gemini Live conversation backend: `resolveLiveTranslate()` (BYOK-google-only, throws if absent — no keyless/availability fallback), `canLiveTranslate()` (cheap nav gate probe), `mintLiveToken()` (single-use, short-TTL ephemeral token scoped to the Live model with the direction locked in), `getLiveTranslateModel()` (`GEMINI_LIVE_MODEL`-overridable)                                                                                                                  | Uses `byok.ts`, `prisma.ts`, `@google/genai` (server)                                                    |
| `live-session.ts`              | `openLiveSession()` (`'use client'`) — opens the Gemini Live WebSocket with the ephemeral token + `translationConfig`, streams mic frames in (`sendAudio`), surfaces translated audio + input/output transcriptions out                                                                                                                                                                                                                                                        | Uses `@google/genai` (web). Client-only                                                                  |
| `live-vocab.ts`                | `extractAndStoreLiveVocab()` / `extractAndStoreNoteVocab()` — runs the learner's resolved AI over untrusted live transcripts or uploaded course notes. Live transcripts use `live/extract-vocab.md`; course notes use `live/extract-learning-targets.md` to pull catch-up vocabulary plus grammar targets into the memory graph. Best-effort, never throws.                                                                                                                    | Uses `learning-ai.ts`, `providers/ai.ts`, `knowledge-graph.ts`                                           |
| `audio/pcm.ts`                 | Pure PCM helpers for the Live audio pipeline: `resampleFloat32`, `floatToInt16`/`int16ToFloat32`, `encodeForCapture` (16 kHz), `int16ToBase64`/`base64ToInt16`, `frameLevel` (RMS). The AudioWorklets defer to these                                                                                                                                                                                                                                                           | Pure utility                                                                                             |
| `exam-blueprint.ts`            | Mock-exam FORMAT catalog: `getBlueprint(institution, level)` + `listBlueprints()` (every flagship Goethe/DELE/Cambridge + CEFR_GENERIC at A1..C2, structure only, never exam content), `resolveExamInstitution(targetLang)`, `EXAM_INSTITUTION_LABELS`. Zod-validated                                                                                                                                                                                                          | Pure utility                                                                                             |
| `exam-spec.ts`                 | `resolveExamSpec(curriculumId, level)` — aggregates every curriculum lesson at the exam level into one objective + grammar + vocab set the section generators draw on (exam tests the whole level, unlike a class/practice)                                                                                                                                                                                                                                                    | Uses `prisma.ts`                                                                                         |
| `mock-exam-service.ts`         | `createMockExam()` (synchronous generation reusing the class cores per blueprint section, best-effort per section, NEVER advances level), `getExamForUser()` (answer key stripped until SCORED), `listCourseExams()`. Speaking/writing reuse SpeakingPrompt/WritingPrompt via `examSectionId`                                                                                                                                                                                  | Uses `class-generation.ts`, `class-listening/speaking/writing-generator.ts`, `exam-spec.ts`, `prisma.ts` |
| `mock-exam-scoring.ts`         | `scoreExam()` — blends MC (inline), writing (already graded), and speaking (latest SCORED recording, async) into a blueprint-weighted overall + a mock band (`computeBand`, `weightedOverall` pure), generates feedback (`exams/exam-feedback.md`, best-effort), marks the exam SCORED. Never touches `Course.currentLevel`                                                                                                                                                    | Uses `learning-ai.ts`, `exam-blueprint.ts`, `prisma.ts`                                                  |

## Hooks (`src/lib/hooks/`)

Client-side React hooks (`'use client'`).

| Hook                 | Purpose                                                                                                                                                                                                                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useAudioPlayer`     | HTML5 Audio playback: play/pause, seek, volume, playback rate, episode loading                                                                                                                                                                                                                                              |
| `useAuth`            | Current-user hook (no login): `user` (fetched from `/api/v1/users/me`), `isAuthenticated`, `isLoading`                                                                                                                                                                                                                      |
| `useNotifications`   | Notification polling (30s interval): list, unread count, mark read, refresh                                                                                                                                                                                                                                                 |
| `useRotatingMessage` | Rotating sub-messages for generation progress: cycles through stage-specific pools every 9s, switches early→late after 2min                                                                                                                                                                                                 |
| `useEpisode`         | Episode detail fetcher: loading state, save/unsave                                                                                                                                                                                                                                                                          |
| `useScrollFollow`    | Auto-scroll follow with user-input detection (wheel/touch), scrollability guard, 3s debounce relock                                                                                                                                                                                                                         |
| `useHasMounted`      | Hydration-safe mount guard: returns `false` on server/initial render, `true` after client mount                                                                                                                                                                                                                             |
| `useLiveAudio`       | Live conversation audio: captures the mic as 16 kHz Int16 base64 frames via an AudioWorklet and plays incoming 24 kHz PCM through a jitter-buffered worklet; exposes `start`/`stop`/`enqueue`/`flush`, a mic level, and permission/autoplay/unsupported states (PCM math in `audio/pcm.ts`, worklets in `public/worklets/`) |

## Providers (`src/lib/providers/`)

Modular provider architecture configured through Sidedoor.

| File                   | Interface         | Implementations                                                                                                                                                                                                                                                                 |
| ---------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai.ts`                | `AIProvider`      | Anthropic, OpenAI, Google, supported local agent, Codex, local OpenAI-compatible servers, xAI, DeepSeek, Mistral, Groq, and NVIDIA NIM                                                                                                                                          |
| `ai-registry.ts`       | `AiProviderMeta`  | Declarative AI provider metadata: validation functions for Anthropic + OpenAI keys                                                                                                                                                                                              | —                |
| `local-agent provider` | `AIProvider`      | `LocalAgentProvider`                                                                                                                                                                                                                                                            |
| `tts.ts`               | `TtsProvider`     | Execution-bound TTS factory and explicit provider resolution. Kokoro and Local use saved sidecar URLs.                                                                                                                                                                          |
| `tts-registry.ts`      | `TtsProviderMeta` | Declarative provider metadata: quality tiers, costs, auth validation, capabilities, models. Includes keyless local `kokoro` and generic `local` providers (empty auth fields, filtered out of the BYOK client DTO like `local` in `ai-registry.ts`)                             | —                |
| `tts-voices.ts`        | `ProviderVoice`   | Per-provider voice pools (Cartesia, Hume, Fal/Replicate, MiniMax, Mistral, Kokoro, configurable local sidecars) with curated voices + deterministic hash selection                                                                                                              | —                |
| `tts/*.provider.ts`    | `TtsProvider`     | Per-provider implementations: `elevenlabs`, `openai`, `cartesia`, `hume`, `fal`, `replicate`, `minimax`, `mistral`, `deepgram` (Aura-2), `rime` (Arcana), `playht` (Play3.0-mini, dual-credential), `kokoro` (bundled Kokoro sidecar), `local` (generic local sidecar contract) | Various TTS APIs |
| `stt.ts`               | `SttProvider`     | OpenAI Whisper, Together, Deepgram, AssemblyAI, ElevenLabs Scribe, Cartesia Ink, Groq, Gladia, Speechmatics, and Local Whisper with captured credentials and endpoints                                                                                                          |
| `stt-registry.ts`      | `SttProviderMeta` | Declarative STT provider metadata: models for OpenAI, ElevenLabs                                                                                                                                                                                                                | —                |
| `storage.ts`           | `StorageProvider` | `R2Provider`, `S3Provider`, `LocalProvider` selected from saved Sidedoor configuration                                                                                                                                                                                          |
| `index.ts`             | `Providers`       | Singleton factory for providers that are safe without user runtime choices (`storage`)                                                                                                                                                                                          | —                |

## Patterns

`byok-crypto.ts` derives the owned credential key from the required environment
secret. It imports no provider clients or application state.

`sidedoor/provider-credentials.ts` projects shared credential descriptors, captures
learner generations and checks erasure fences. Request resolution revalidates the
original admission and resolves personal keys or explicit household grants in one
Serializable transaction. Its low-level storage factory is for authorized callers.
Transcription retains its AI or TTS key slot.

`providers/credential-validation.ts` captures one API or service selection and
delegates credential proof to Sidedoor. It supplies personal auxiliary fields
explicitly and preserves cancellation and inconclusive outcomes. Speech contract
versions live in `providers/speech-contracts.ts` with their generation callers.

`sidedoor/credential-settings.ts` saves and removes exact client revisions through
shared owned storage. It revalidates original admission around external probes,
requires explicit unverified saving, exposes retained deletion heads, and
reconciles a lost database commit response against the prepared operation.

`sidedoor/credential-sharing.ts` revokes explicit grants in bounded pages within
private-account conversion and profile deletion transactions. Grant conflicts or
missing initialized state abort the complete operation after credential migration.
Profile erasure also removes owned ciphertext and exact-generation recipient
references before the learner cascade, retaining nonsecret revision controls.

`episode-transcript.ts` captures displayed transcript fields and the episode's
publication identity. Transcript workers use this
projection with the canonical `generateEpisodeTranscript` renderer.

`sidedoor/pairing.ts` binds device issuance to the current shared session and selected learner. Redemption consumes the pairing code, creates the shared credential and application key metadata, and returns the learner projection within the caller's Serializable transaction.

`sidedoor/request-identity.ts` resolves exclusive bearer authentication or the shared browser cookie within a caller-owned transaction. Its discriminated result separates household admission from content access and retains session/device identifiers for mutation revalidation. Supplied invalid bearer credentials never fall back to cookies.

`sidedoor/http.ts` configures the shared access HTTP protocol from the validated application URL and explicit password-origin aliases. `/api/v1/access/[action]` serves password, passkey, recovery and scoped pairing actions without caching responses. Each action enforces its own shared authority.

`sidedoor/keys.ts` revokes canonical device authority and retained API key metadata in one transaction using the original browser or native credential.

`storage-deletion-targets.ts` visits raw storage references in pages of 100 rows, retaining source model, row ID, field names and episode prefixes. Unknown URLs and bundled paths remain available for explicit classification. Durable deletion must await every page in the same Serializable transaction as its snapshot and cascade. Course episode IDs must come from the canonical ownership query. The visitor never deletes files and includes all speaking ownership paths.

`sidedoor/profiles.ts` creates household principals, learner records and avatars atomically through prepared shared operations. Profile edits keep display labels separate from login identifiers. It validates household selection and reads appearance in the same transaction. Browser selection persists in shared session state; native clients carry the validated profile in their request header.

`sidedoor/session-identity.ts` resolves browser admission and selected content from one shared access snapshot. Household admission without selection can reach the picker but has no content user. Administrative authority comes only from an authenticated shared principal. Callers fetch profile details and revalidate mutations within the same transaction.

`sidedoor/operator.ts` implements local migration and environment synchronization through the canonical shared access command runner. The bundled `scripts/access.ts` entrypoint uses only the caller's environment. Deployment stops all writers before invoking migration or synchronization.

`sidedoor/service.ts` configures shared browser sessions, household selection and scoped native pairing using the existing application database. Importing it neither migrates nor creates authority.

`sidedoor/transaction.ts` opens fresh Serializable transactions using the shared bounded retry driver. Callbacks contain database changes and repeatable computation; perform external effects after commit.

`sidedoor/storage-write.ts` adapts profile and single-file writes to the shared
`writeReferenceSet` engine. Sidedoor owns immutable artifact allocation, intent
settlement, atomic reference publication, cancellation checks and commit recovery.
Sotto supplies Prisma transactions, current backend ports and authority checks.
It requires the current instance scope and distinct resource scopes before I/O,
and retains canonical journal checks independently of application admission callbacks.
Its profile adapter commits uploads with instance/profile intents, original request
authority, and durable asset attribution.
It reconciles completion receipts before handling an unknown commit outcome.
Admissions may include additional consumers for the same immutable asset.
The engine captures their replacement claims before I/O and commits the complete
reference group atomically, including historical version references. Recovery
callbacks must verify every application reference in that group.
Retirements preserve references independently of learner rows, including
explicitly unresolved backend attribution. They do not authorize deletion.
Course, episode and worker artifacts require their additional erasure scopes and
durable job admission before they can use this protocol.

`sidedoor/device-identity.ts` resolves native device authority separately from the selected learner. Household devices can select explicit household profiles; authenticated devices stay bound to their principal. Administrative access requires both owner role and delegated owner scope.

`sidedoor/access-store.ts` binds shared access mutations to a caller-owned Serializable transaction, validates the deployment credential, and checks device authority. Shared roles determine authority. Credential activation removes the learner from household selection without deleting their content.

`sidedoor/state.ts` defines the shared access and configuration snapshots. `sidedoor/store.ts` binds that envelope to the caller's Prisma transaction through the shared SQL state adapter. It also binds storage instance control, initialized by local operator setup. Reset must rotate its identity and preserve prior allocations and cleanup journals.

### Shared Access And Storage

`sidedoor/redis-semaphore.ts` adapts one unused ioredis connection to the shared
exact-token capacity lease. Reconnect, offline queuing and command replay stay off.
Connection loss poisons the session; cleanup closes the socket and preserves unknown
token release as a typed shared cleanup failure. TTS and episode status streams use
this adapter. Do not restore the former increment/decrement counter semaphore.

`audio/tts-media.ts` runs TTS concatenation and duration analysis through the shared
process runner. Temporary directories live beneath the supplied execution directory.
Confirmed process cleanup precedes file removal; uncertain cleanup retains the
directory and reports its path through `TtsMediaCleanupError`. Durable callers must
supply their execution workspace. Ordinary duration failures keep the existing
estimate, while cancellation and cleanup uncertainty propagate.

`sidedoor/storage-job-probe.ts` validates a canonical pending job and its original
ownership scopes before and after the shared storage probe. Call it inside the
parent execution lifetime and reuse its returned backend for publication through
`storageWriterForBackend`. Uncertain probe cleanup must retain that lifetime.

`sidedoor/storage-probe.ts` runs onboarding storage checks through the shared probe and execution journals. It captures the selected backend, owns a dedicated backend lock, supplies cancellation to actual storage operations, and revalidates original owner authority after cleanup and lock release. Uncertain operations retain their durable execution guard and must be resolved before another probe can use that backend.

`sidedoor/storage-connection.ts` binds a dedicated node-postgres client to Sidedoor's bounded connection lifecycle. It uses direct PostgreSQL or session pooling for storage advisory locks; transaction pooling is unsupported. Application transactions stay with Prisma. Opening, queries and closure have explicit deadlines, and unconfirmed closure must retain the shared execution guard.

`sidedoor/stitching-artifact.ts` validates immutable stitching ancestry and erasure
proof for PDF and waveform jobs. Each worker adds its exact content projection.
`waveform-artifacts.ts` renders canonical waveform and optional spectrogram bytes
before publication. `waveform-extractor.ts` streams stereo PCM into bounded energy
bins and propagates decoder errors and cancellation.

`sidedoor/storage-inputs.ts` resolves consumer-bound immutable file identities and
revalidates queued identities against registered historical backends. Callers check
application ownership and erasure scopes in the same transaction. Unknown
references require explicit attribution; resolution never guesses the current backend.

`audio/segment-boundaries.ts` contains the stitching worker's cross-correlation
detection and cumulative timing calculation. Callers pass the crossfade used
to produce the audio; detected starts already include that overlap.

`sidedoor/episode-storage.ts` captures current instance, episode, profile and linked
course generations in one transaction, including each course owner's profile.
Validation rereads all associations and rejects tombstoned or changed ownership.
Audio generation captures these scopes before TTS and uses the shared write engine
to commit segment audio, attribution and intent receipts together.

`sidedoor/job-delivery.ts` binds the shared outbox to BullMQ. Durable handler names
equal queue names; handler versions identify payload contracts. Redis receives only
an operation ID and fingerprint. Delivery verifies stored identity and scheduling
options before acknowledging acceptance. Failed jobs and missing completion receipts
surface errors. Reconciliation must scan incomplete jobs after Redis data loss;
workers must validate the database payload and scopes before processing.

`sidedoor/incorporation.ts` captures episode and interaction generation inputs with
original request authority, then commits status changes, a durable job and its
attempt identity in one transaction. The incorporation route uses this admission
and retains durable work after generation. Workers must recheck the attempt identity,
captured inputs and storage scopes. The regeneration worker accepts versioned
references through `sidedoor/incorporation-work.ts`, revalidates author scopes,
and commits the inserted segment and stitching outbox with completion receipts.
Delivery, configuration pinning and the stitching consumer still require
integration before this workflow can ship.

`sidedoor/profile-deletion.ts` captures the requested profile epoch and creation generation, then revalidates canonical household authority in the deletion transaction. It persists raw application references, retired assets and unresolved avatar retirements with a permanent write tombstone before removing authority and cascading learner data. Discovery, usage and feedback records owned by the profile are explicitly removed. The route returns a queued cleanup job. Its unresolved write-protocol manifest prevents storage deletion until every producer participates in the shared fencing protocol. Normal access-store mutations still reject principal removal.

`sidedoor/onboarding.ts` reads completion and resume identity for the explicitly
authenticated learner. Home, dashboard, admin and welcome use that learner's
record. Profile selection does not depend on another learner's onboarding.
Rendering a page never creates implicit owner records.

`r2.ts` exposes captured cleanup and exact-file verification from
`thesidedoor-core/storage`. Its shared write journal and cleanup manifest
provide transaction-scoped erasure primitives for application workflows. Capture
the backend before preparing cleanup. A worker must retain exclusive backend
ownership, drain writers, preserve every pre-cascade reference, and finish a
fresh verification pass before declaring completion. `r2.ts` keeps Sotto's
explicit force requirement for protected episode audio.

`captureStorageBackend` binds buffer writes to the same captured destination.
`storage-captured-local.ts` builds local operations from the shared captured root
identity. `restoreStorageBackend` exposes historical reads and cleanup without
write methods. Saved local descriptors reopen their original inode independently
of the current provider or root. `storage-configuration.ts` resolves named S3
and R2 locations. Object restoration matches exactly one configured endpoint
and bucket before loading that slot's credentials, independently of the active
provider. It preserves the historical alias and S3 version enumeration.
Descriptors must come from validated registry
records, never request input.
Local writes use exclusive file creation; object writes require a conditional PUT.
Call it only from storage orchestration after persisting admission under every
erasure scope. Cleanup tombstones and drains those scopes before deleting;
cleanup workers coordinate backend ownership without locking unrelated writers.
Keys must never be reused or adopted through unfenced reference writes.
Captured object downloads pass the actual S3 SDK body to the shared owned-stream
copy engine. It owns late acquisition, exclusive destination writes and explicit
closure. Stream errors that cannot prove cleanup retain execution uncertainty;
the caller must preserve the workspace until recovery. Real SDK tests exercise
complete, truncated and cancelled HTTP responses.
Cleanup inventories unfinished multipart uploads as well as
objects and versions. Aborting an upload does not resolve an uncertain write
intent. Retain that intent until its external operation is resolved.

`proxy.ts` resolves shared session or device admission through a Serializable
transaction. Route handlers still check content ownership and owner authority.
Password and passkey admission use the shared access handlers at `/access`.

### Redis Connection Rule

BullMQ requires **dedicated Redis connections** per worker/queue. Never share the general Redis client for BullMQ operations. Use `createRedisConnection('name')` for each worker.
Capacity leases also require their dedicated `openSottoSemaphore` session so an
uncertain command cannot be replayed through the general client.

### External Service Initialization

Provider factories require explicit runtime choices. External clients may log missing-key warnings on module load, but generation paths must not silently choose AI/TTS providers.

### Error Handling

All lib functions throw descriptive errors. API routes catch and return proper HTTP status codes. Workers log errors and let BullMQ handle retries.

## Adding a New Lib File

`providers/shared-api.ts` binds captured Sotto API selections to Sidedoor SDK adapters.
It preserves configured endpoints, messages, generation options and nullable usage.
Product moderation and model defaults stay in the caller. Opening retries stop once
text escapes, and application completion callbacks run outside the retry boundary.
Google, local, xAI, DeepSeek, Mistral, Groq and NVIDIA use the compatible bridge.
OpenAI uses shared Chat Completions and Responses adapters. Anthropic uses the shared
Messages adapter, preserving its SDK retries and explicit search restrictions.
Anthropic retains SDK attempt timing without a whole-request deadline. Caller
cancellation still uses bounded cleanup; an SDK retry sleep can outlast that bound
and produce an explicit unconfirmed-cleanup error.

1. Create `src/lib/new-service.ts`
2. Add types to `src/types/` if needed
3. Update this AGENTS.md with the file description
4. If it is an external provider, add its catalog metadata and Sidedoor credential fields

## MANDATORY — Adding a New TTS Provider Voice Pool

**Every new TTS provider with preset voices MUST touch all files below. Missing any causes wrong voice labels, wrong catalog coverage, or rejected voice preview requests.**

For a self-hoster adding a new local TTS model, prefer the no-code path first:
implement the sidecar contract in `docs/05-provider-extension-guide.md` and save
the Local provider, base URL, model, and voice IDs in Sotto. Only add a
native provider when the model cannot fit that HTTP contract.

### Voice pool & registry (backend)

- [ ] `providers/tts-voices.ts` — add `export const NEW_VOICE_POOL: ProviderVoice[]` + add entry to `PROVIDER_VOICE_POOLS` map
- [ ] `providers/tts-registry.ts` — add to `TtsProviderId` union + add full `TtsProviderMeta` entry (languages, models, costs)
- [ ] `providers/tts/new.provider.ts` — create provider class implementing `TtsProvider`
- [ ] `providers/tts.ts` — add async import, construction case, and captured credential resolution
- [ ] `voice-pool.ts` → `findVoiceName()` — add pool to destructured import + `providerPools` array (otherwise UUIDs show in UI)
- [ ] `voice-catalog.ts` → `getVoiceCatalog()` — add import + `case` in switch (otherwise falls to ElevenLabs catalog)
- [ ] `voice-assigner.ts` → `getFallbackVoiceIds()` — add import + `case` in switch (otherwise assigns wrong ElevenLabs voice IDs)

### Validation schemas & API routes

- [ ] `validations.ts` → `byokSchema` — add to `provider` z.enum (otherwise BYOK key save returns 400)
- [ ] `validations.ts` → `voicePreviewSchema` — add to `provider` z.enum (otherwise voice preview returns 400)
- [ ] `api/settings/byok/route.ts` → DELETE uses `byokProviderSchema`; add providers through `byokSchema` so save/delete validation stays aligned

### Display names (shared + UI)

- [ ] `packages/shared/src/provider-display.ts` — add to `TTS_PROVIDER_DISPLAY` + `TTS_MODEL_DISPLAY`

### Expression mapping (if provider supports SSML/tags)

- [ ] `tts-expression-mapper.ts` — add type + direction map entries + `case` in `mapDirectionToExpression` and `convertInlineAudioTags`

### Tests

- [ ] `tests/smoke/connectivity.test.ts` — add provider smoke test block
- [ ] `tests/api/v1/admin-test-model.test.ts` — add to voice pool mock + `getProviderIds` mock
