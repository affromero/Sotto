# src/workers/ — Background Job Processors

BullMQ workers that process async jobs. Each worker runs in a separate thread with its own Redis connection.

## Worker Index

| Worker                 | Queue Name             | Concurrency | Input                                                                                                            | Output                                                                                 |
| ---------------------- | ---------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `content-extraction`   | `content-extraction`   | 2           | URL/text → extracted content                                                                                     | Updates Discovery.sourceContent                                                        |
| `script-generation`    | `script-generation`    | 2           | Discovery metadata → 2-voice script with `[N]` citations                                                         | Creates Script + References, routes to script verification                             |
| `script-verification`  | `script-verification`  | 2           | Script + References → claim extraction + sourcing check (≤3 revision loops)                                      | Passes → routes to ref validation or audio; Fails → regenerates script                 |
| `reference-validation` | `reference-validation` | 2           | References + Script → source quality filter + 4-layer verification                                               | Verifies/replaces/removes refs, sets SCRIPT_READY (WEB/IMPORT) or creates Segments + queues audio (TWITTER/API) |
| `audio-generation`     | `audio-generation`     | 5           | Segment text → TTS via `resolveTtsProvider` (BYOK or platform, 5 providers) + FFprobe duration                   | Uploads segment audio to R2, writes `segment.duration`, logs cost to `ApiUsageLog`     |
| `audio-stitching`      | `audio-stitching`      | 1           | All segments → FFmpeg concat + SFX overlay (with `adelay`) + normalization                                       | Uploads final podcast audio, creates `PodcastVersion`, computes startTimes, sets READY |
| `interaction`          | `interactions`         | 3           | User question + segment-based timestamp lookup → Claude answer + segmentOrder computation                        | Updates Interaction.answer, status, segmentOrder                                       |
| `segment-regeneration` | `segment-regeneration` | 2           | Text → TTS via `resolveTtsProvider` (matches podcast voice + provider config) → transactional insert → re-stitch | Queues audio-stitching (`skipSfx`), marks INCORPORATED                                 |
| `notification`         | `notifications`        | 5           | User + message → in-app + push                                                                                   | Creates Notification + sends push                                                      |
| `pdf-generation`       | `pdf-generation`       | 2           | Podcast → pdfmake PDF → R2 upload                                                                                | Sets Podcast.pdfUrl                                                                    |
| `twitter-mentions`     | `twitter-mentions`     | 1           | Poll @sottofm mentions → parse intent → create podcast                                                           | Creates TweetMention + Podcast, kicks off pipeline                                     |
| `twitter-reply`        | `twitter-reply`        | 2           | Podcast ready → compose reply → post to Twitter                                                                  | Updates TweetMention.status to REPLIED                                                 |

## Pipeline Flow

```
content-extraction → script-generation → script-verification ──→ reference-validation → [SCRIPT_READY] → audio-generation (×N) → audio-stitching → notification
                                              ↑       │                                      │                                                          ↕
                                              │  FAIL (≤3)                         WEB/IMPORT: pause      pdf-generation         twitter-reply
                                              └───────┘                            for user review         (on-demand)            (if TWITTER)
                                                                                   TWITTER/API: auto-approve

twitter-mentions (repeatable, every 60s) → polls @sottofm → creates Podcast → kicks off pipeline above

Script review (at SCRIPT_READY):
  User edits script → PATCH /api/podcasts/[id]/script (save edits)
  User approves    → POST  /api/podcasts/[id]/script/approve (creates Segments, queues audio)
  User regenerates → POST  /api/podcasts/[id]/script/regenerate (re-queues script-generation)

Incorporation (post-READY):
  incorporate endpoint → segment-regeneration → audio-stitching (skipSfx) → READY
  (ANSWERED → INCORPORATING)  (TTS + insert)    (re-concat + startTimes)   (INCORPORATED)
```

## Centralized Failure Handler

`queue.ts` includes a centralized `setupQueueEvents()` handler that:

1. Catches all terminal job failures across all queues
2. Calls `markPodcastFailed(podcastId)` which records `failedAtStatus` (the status the podcast was in when it failed) and sets status to `FAILED`
3. Queues a notification: "Generation failed."

## Checkpointing & Idempotency

Workers are idempotent — safe to re-run after a failure. Each worker checks for existing output before doing expensive work:

| Worker               | Guard                                        | Skip behavior                                            |
| -------------------- | -------------------------------------------- | -------------------------------------------------------- |
| content-extraction   | `discovery.sourceContent` already populated  | Skips extraction, chains to script-generation            |
| script-generation    | `Script` record exists for podcast           | Skips generation, chains to script-verification          |
| audio-generation     | `segment.audioUrl` already set               | Skips TTS, still checks if all segments done → stitching |
| audio-import         | `PodcastVersion` exists with audioUrl        | Skips entire import, sets READY                          |
| audio-import         | `Script` already exists (mid-import retry)   | Skips script creation (prevents @@unique violation)      |

When a podcast fails, `POST /api/podcasts/[id]/generate` uses `determineResumePoint()` from `lib/pipeline-resume.ts` to inspect existing data and resume from the furthest completed step. Pass `?forceRestart=true` to nuke everything and start from scratch.

## Adding a New Worker

1. Create `src/workers/new-thing.worker.ts` with `export async function processNewThing(job: Job<Payload>)`
2. Add payload type to `src/lib/queue.ts`
3. Add queue instance to `src/lib/queue.ts`
4. Register in `src/workers/index.ts`
5. Update this CLAUDE.md
