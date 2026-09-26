# src/workers/ — Background Job Processors

BullMQ workers that process async jobs. Each worker runs in a separate thread with its own Redis connection.

PDF generation accepts canonical v1 stitching children and v2 export requests.
Raw `generate_pdf` payloads are rejected. Both contracts use the same transcript
renderer and attributed publication transaction. Cancellation propagates through
storage writes and completion checks. Export requests retain their own deletion
fences while the generated transcript belongs to the episode owner.

Hosts with an enabled durable worker also reconcile all supported durable queues.
Worker profiles still control execution; downstream jobs can be consumed by another host.
Shutdown aborts and awaits reconciliation before closing workers and Redis. Operator
access/device migrations and storage-instance initialization must precede dispatch.

## Worker Index

| Worker                 | Queue Name             | Concurrency | Input                                                                                                                                                                                                                                                     | Output                                                                                                    |
| ---------------------- | ---------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `content-extraction`   | `content-extraction`   | 2           | URL/text → extracted content                                                                                                                                                                                                                              | Updates Discovery.sourceContent                                                                           |
| `deep-research`        | `deep-research`        | 2           | Extracted content/topic → verified source dossier and evidence cards                                                                                                                                                                                      | Creates ResearchDossier, queues creative planning                                                         |
| `creative-planning`    | `creative-planning`    | 2           | Research dossier → narrative outline and speaker plan                                                                                                                                                                                                     | Creates CreativeOutline, queues script writing                                                            |
| `script-writing`       | `script-writing`       | 2           | Research dossier + outline → evidence-linked script                                                                                                                                                                                                       | Creates Script, queues deterministic compilation                                                          |
| `compile-script`       | `compile-script`       | 2           | Script + dossier → fail-closed evidence mapping and claim-support verification                                                                                                                                                                            | Persists verified numbered references, then pauses or queues audio                                        |
| `audio-generation`     | `audio-generation`     | 15          | Segment text → TTS via `resolveTtsProvider` (BYOK, platform, or configured local sidecar provider) + FFprobe duration. Supports per-segment TTS overrides (`segment.ttsProvider/ttsModel/ttsVoiceId`) when a segment explicitly carries provider settings | Uploads segment audio to R2, writes `segment.duration`, logs cost to `ApiUsageLog`                        |
| `audio-stitching`      | `audio-stitching`      | 1           | All segments → FFmpeg concat + SFX overlay (with `adelay`) + normalization                                                                                                                                                                                | Uploads final episode audio, creates `EpisodeVersion`, computes startTimes, sets READY                    |
| `interaction`          | `interactions`         | 3           | User question + segment-based timestamp lookup → generated answer + segmentOrder computation                                                                                                                                                              | Updates Interaction.answer, status, segmentOrder                                                          |
| `segment-regeneration` | `segment-regeneration` | 2           | Text → TTS via `resolveTtsProvider` (matches episode voice + provider config) → transactional insert → re-stitch                                                                                                                                          | Queues audio-stitching (`skipSfx`), marks INCORPORATED                                                    |
| `notification`         | `notifications`        | 5           | User + message → in-app + push                                                                                                                                                                                                                            | Creates Notification + sends push                                                                         |
| `pdf-generation`       | `pdf-generation`       | 2           | Episode → markdown transcript → R2 upload                                                                                                                                                                                                                 | Sets Episode.pdfUrl                                                                                       |
| `key-validation`       | `key-validation`       | 1           | Scheduled (every 24h) → bounded canonical credential jobs with exact owner and revision                                                                                                                                                                   | Commits proven rejections and durable owner alerts together; outages preserve availability                |
| `pricing-fetch`        | `pricing-fetch`        | 1           | Scheduled (every 24h) → fetch pricing from pricetoken.ai API, save snapshots                                                                                                                                                                              | Creates ModelPricingSnapshot rows, refreshes in-memory pricing map                                        |
| `waveform-generation`  | `waveform-generation`  | 2           | Episode audioUrl → FFmpeg astats (waveform peaks JSON) + showspectrumpic (spectrogram PNG) → R2 upload                                                                                                                                                    | Sets Episode.waveformUrl + spectrogramUrl                                                                 |
| `speaking-grading`     | `speaking-grading`     | 5           | SpeakingRecording → resolve targetLang via the recording's parent (ClassSection, PracticeSession, or ExamSection) → STT transcription with the saved credential → `resolvePronunciationScorer()` → rubric + phoneme scores                                | Updates SpeakingRecording: transcript, overallScore, rubricScores, phonemeScores, feedback, status=SCORED |
| `worksheet-pdf`        | `worksheet-pdf`        | 2           | CourseClass → `buildClassDocument()` → `renderWorksheetHtml()` → Playwright PDF (graceful no-op if Chromium absent) → R2 upload                                                                                                                           | Sets CourseClass.worksheetPdfUrl                                                                          |

## Pipeline Flow

```
content-extraction → deep-research → creative-planning → script-writing → compile-script
                                                                        │
                                            compile or verification fail ├──→ FAILED
                                                                        │
                                                                        └──→ [SCRIPT_READY] or auto-approve
                                                                                         │
                                                               audio-generation (×N) → audio-stitching → READY

Script review (at SCRIPT_READY):
  User edits script → PATCH /api/v1/episodes/[id]/script (save edits)
  User approves    → POST  /api/v1/episodes/[id]/script/approve (creates Segments, queues audio)
  User regenerates → POST  /api/v1/episodes/[id]/script/regenerate (re-queues script-generation)

Incorporation (post-READY):
  incorporate endpoint → segment-regeneration → audio-stitching (skipSfx) → READY
  (ANSWERED → INCORPORATING)  (TTS + insert)    (re-concat + startTimes)   (INCORPORATED)
```

## Centralized Failure Handler

`queue.ts`'s `createWorker()` wires a centralized `'failed'` event handler on every Worker that:

1. Logs worker failures across all queues.
2. For raw pipeline jobs, calls `markEpisodeFailed` and notifies only after a successful transition. Audio-generation failures require the same generation and an unchanged, unpublished segment while the episode remains GENERATING_AUDIO. Delivery errors after segment publication cannot fail the new stitching attempt.
3. Durable jobs own their failure transitions. Initial stitching records duration failures atomically. Its processing-failure settlement transaction is implemented; terminal queue observation and administrator retry still need integration.

## Checkpointing & Idempotency

`durable-stitching-runner.ts` owns historical downloads, audio assembly and atomic
publication of version history, segment timing, episode state and downstream jobs.
Admission readers supply the captured projection, pending-work validation and
attempt proof for committed-result recovery. The incorporation reader retains its
original authority checks. `durable-initial-audio-stitching.ts` handles version 2
jobs admitted by segment generation and HTTP resume. The stitching entry point
accepts canonical versions 1 and 2 and rejects raw queue payloads.
The runner takes caller-owned output identities. Initial publication seals an
outcome snapshot in the same transaction; incorporation retains its existing
publication contract.

Stitching probes storage through `checkSottoJobStorage` inside its shared execution
lifetime. Final publication uses the same captured backend, including when the
configured local root changes after preflight. Pending job identity, original
ownership and erasure scopes are revalidated around probe cleanup.

`audio/stitch-sound-effects.ts` validates scripts before sound generation and owns
cue timing, stock assets and audience reactions. Premium sound generation uses a
captured credential revision, rechecked before requests and final publication.
Premium failures propagate. Committed-result recovery verifies publication proof
without requiring credentials for work that already completed.

`createWorker()` forwards BullMQ cancellation as the processor's second argument
and the lock token as its third. Its native wrapper must retain three explicit
parameters so BullMQ supplies the signal. Both durable stitching versions pass
that signal through admission and the shared runner.

`executeSottoJob` returns cooperatively cancelled durable work to waiting after
cleanup, using the native lock token. It preserves cleanup failures and failed
queue transitions. Shutdown pauses worker admission before cancelling active jobs.

`episode-status.worker.ts` handles durable stitching cache invalidation. It runs
on the light profile, validates parent identity and deletion proof, clears the
episode cache and publishes an operation ID for clients to refetch. It never
publishes the captured status, which may be obsolete when delivered.

`durable-waveform-generation.ts` handles `waveform-generation.v1` stitching
effects. The waveform worker rejects raw payloads and unsupported versions and
forwards the worker cancellation signal. It validates the parent, version interaction and registered source
audio, reads the historical backend, and publishes JSON and PNG with the shared
multi-asset write engine. Publication and job completion share a transaction.
Optional spectrogram generation failure retires the previous image; cancellation,
file reads and upload failures propagate. Both outputs are verified on recovery.
Waveform jobs register a shared execution before downloads and processing. The
execution settles after temporary cleanup, independently of artifact publication.
Cleanup failures remain unresolved even when both artifacts were published.
The worker passes cancellation to storage reads and checks it before publication.
Waveform and stitching use the shared lifecycle's recorded workspace. They do not
recursively remove it themselves. Uncertain reads or processes retain its contents
and block execution settlement; boundary-analysis files live beneath that workspace.

`durable-pdf-generation.ts` handles automatic `pdf-generation.v1` effects and
requested `pdf-generation.v2` exports. It validates each captured request,
current storage scopes, and the shared transcript projection before upload and
publication. Immutable attribution, `pdfUrl` and job completion commit together.
Recovery verifies the exact receipt, URL, and captured inputs.

`durable-notification.ts` handles `notifications.v1` stitching effects. It
validates parent receipts and recipient scopes, then commits one inbox entry
and a sealed shared snapshot of device identities together. Snapshot capture
uses keyset pages of 100 devices in the admission transaction.
`durable-notification-fanout.ts` handles `notifications.v3`, creating at most
100 immutable `notifications.v2` delivery jobs and the next page job in each
transaction. Devices added after admission are excluded. The delivery worker
checks current opt-in and subscription credentials before each device send.
Successful devices receive separate completion receipts; retries do not send
to completed devices. External acceptance before a lost database response can
still repeat a send. Stable notification IDs replace existing browser cards.
Matching scope tombstones and cleanup identities suppress each notification
job independently, including after an external send. Missing data without
deletion proof remains an error. Snapshot and payload erasure, retention, and
durable dispatch orchestration remain required before production dispatch.

`durable-segment-regeneration.ts` handles version 1 incorporation references.
It loads authoritative work from PostgreSQL, checks the current operation and
captured inputs before TTS, then commits immutable audio attribution, segment
insertion and ordering, interaction completion and a stitching outbox together.
Optional voice persistence uses a savepoint; serialization conflicts retry the
whole transaction. Lost commit responses require matching storage receipts,
the inserted segment and the exact downstream job. All queue payloads are
immutable Sidedoor outbox references.

Workers are idempotent — safe to re-run after a failure. Each worker checks for existing output before doing expensive work:

| Worker             | Guard                                       | Skip behavior                                            |
| ------------------ | ------------------------------------------- | -------------------------------------------------------- |
| content-extraction | `discovery.sourceContent` already populated | Skips extraction, chains to deep research                |
| script-writing     | `Script` record exists for episode          | Skips writing, chains to deterministic compilation       |
| audio-generation   | `segment.audioUrl` already set              | Skips TTS, still checks if all segments done → stitching |

When a episode fails, `POST /api/v1/episodes/[id]/generate` uses `determineResumePoint()` from `lib/pipeline-resume.ts` to inspect existing data and resume from the furthest completed step. Pass `?forceRestart=true` to nuke everything and start from scratch.

## Adding a New Worker

1. Create `src/workers/new-thing.worker.ts` with `export async function processNewThing(job: Job<Payload>)`
2. Add payload type to `src/lib/queue.ts`
3. Add queue instance to `src/lib/queue.ts`
4. Register in `src/workers/index.ts`
5. If the worker is **dev-only or experimental**, add it to `EXPERIMENTAL_WORKERS` in `worker-routing.ts` — otherwise it runs by default under the `core` preset
6. Update this AGENTS.md
