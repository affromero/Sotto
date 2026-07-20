# src/workers/ — Background Job Processors

BullMQ workers that process async jobs. Each worker runs in a separate thread with its own Redis connection.

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
| `interaction`          | `interactions`         | 3           | User question + segment-based timestamp lookup → Claude answer + segmentOrder computation                                                                                                                                                                 | Updates Interaction.answer, status, segmentOrder                                                          |
| `segment-regeneration` | `segment-regeneration` | 2           | Text → TTS via `resolveTtsProvider` (matches episode voice + provider config) → transactional insert → re-stitch                                                                                                                                          | Queues audio-stitching (`skipSfx`), marks INCORPORATED                                                    |
| `notification`         | `notifications`        | 5           | User + message → in-app + push                                                                                                                                                                                                                            | Creates Notification + sends push                                                                         |
| `pdf-generation`       | `pdf-generation`       | 2           | Episode → markdown transcript → R2 upload                                                                                                                                                                                                                 | Sets Episode.pdfUrl                                                                                       |
| `key-validation`       | `key-validation`       | 1           | Scheduled (every 24h) → re-validate all BYOK TTS + AI keys against provider APIs                                                                                                                                                                          | Marks invalid keys `isValid=false`, sends KEY_INVALID notification to affected users                      |
| `pricing-fetch`        | `pricing-fetch`        | 1           | Scheduled (every 24h) → fetch pricing from pricetoken.ai API, save snapshots                                                                                                                                                                              | Creates ModelPricingSnapshot rows, refreshes in-memory pricing map                                        |
| `waveform-generation`  | `waveform-generation`  | 2           | Episode audioUrl → FFmpeg astats (waveform peaks JSON) + showspectrumpic (spectrogram PNG) → R2 upload                                                                                                                                                    | Sets Episode.waveformUrl + spectrogramUrl                                                                 |
| `speaking-grading`     | `speaking-grading`     | 5           | SpeakingRecording → resolve targetLang via the recording's parent (ClassSection, PracticeSession, or ExamSection) → STT transcription (BYOK or platform key) → `resolvePronunciationScorer()` → rubric + phoneme scores                                   | Updates SpeakingRecording: transcript, overallScore, rubricScores, phonemeScores, feedback, status=SCORED |
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

1. Catches all terminal job failures across all queues
2. Calls `markEpisodeFailed(episodeId)` which records `failedAtStatus` (the status the episode was in when it failed) and sets status to `FAILED`
3. Queues a notification: "Generation failed."

## Checkpointing & Idempotency

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
6. Update this CLAUDE.md
