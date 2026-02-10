# src/workers/ — Background Job Processors

BullMQ workers that process async jobs. Each worker runs in a separate thread with its own Redis connection.

## Worker Index

| Worker                 | Queue Name             | Concurrency | Input                                                                        | Output                                                                 |
| ---------------------- | ---------------------- | ----------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `content-extraction`   | `content-extraction`   | 2           | URL/text → extracted content                                                 | Updates Discovery.sourceContent                                        |
| `script-generation`    | `script-generation`    | 2           | Discovery metadata → 2-voice script with `[N]` citations                     | Creates Script + References, routes to script verification             |
| `script-verification`  | `script-verification`  | 2           | Script + References → claim extraction + sourcing check (≤3 revision loops)  | Passes → routes to ref validation or audio; Fails → regenerates script |
| `reference-validation` | `reference-validation` | 2           | References + Script → source quality filter + 4-layer verification           | Verifies/replaces/removes refs, creates Segments, queues audio         |
| `audio-generation`     | `audio-generation`     | 5           | Segment text → TTS (premium or standard) + FFprobe duration                  | Uploads segment audio to R2, writes `segment.duration`                 |
| `audio-stitching`      | `audio-stitching`      | 1           | All segments → FFmpeg concat + SFX overlay (with `adelay`) + normalization   | Uploads final podcast audio, computes startTimes, sets READY           |
| `interaction`          | `interactions`         | 3           | User question + segment-based timestamp lookup → Claude answer               | Updates Interaction.answer                                             |
| `segment-regeneration` | `segment-regeneration` | 2           | Text → TTS (matches podcast voice config) → transactional insert → re-stitch | Queues audio-stitching (`skipSfx`), marks INCORPORATED                 |
| `notification`         | `notifications`        | 5           | User + message → in-app + push                                               | Creates Notification + sends push                                      |
| `pdf-generation`       | `pdf-generation`       | 2           | Podcast → pdfmake PDF → R2 upload                                            | Sets Podcast.pdfUrl                                                    |
| `twitter-mentions`     | `twitter-mentions`     | 1           | Poll @sottofm mentions → parse intent → create podcast                       | Creates TweetMention + Podcast, kicks off pipeline                     |
| `twitter-reply`        | `twitter-reply`        | 2           | Podcast ready → compose reply → post to Twitter                              | Updates TweetMention.status to REPLIED                                 |

## Pipeline Flow

```
content-extraction → script-generation → script-verification ──→ reference-validation → audio-generation (×N) → audio-stitching → notification
                                              ↑       │                                                                              ↕
                                              │  FAIL (≤3)                                                    pdf-generation         twitter-reply
                                              └───────┘                                                       (on-demand)            (if TWITTER)

twitter-mentions (repeatable, every 60s) → polls @sottofm → creates Podcast → kicks off pipeline above

Incorporation (post-READY):
  incorporate endpoint → segment-regeneration → audio-stitching (skipSfx) → READY
  (ANSWERED → INCORPORATING)  (TTS + insert)    (re-concat + startTimes)   (INCORPORATED)
```

## Centralized Failure Handler

`queue.ts` includes a centralized `setupQueueEvents()` handler that:

1. Catches all terminal job failures across all queues
2. Marks the associated podcast as `FAILED`
3. **Automatically refunds credits** (1 base + premium voice surcharge if applicable) via `refundCredits()`
4. Queues a notification: "Generation failed. Credit refunded."

## Adding a New Worker

1. Create `src/workers/new-thing.worker.ts` with `export async function processNewThing(job: Job<Payload>)`
2. Add payload type to `src/lib/queue.ts`
3. Add queue instance to `src/lib/queue.ts`
4. Register in `src/workers/index.ts`
5. Update this CLAUDE.md
