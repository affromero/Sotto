# src/workers/ — Background Job Processors

BullMQ workers that process async jobs. Each worker runs in a separate thread with its own Redis connection.

## Worker Index

| Worker                 | Queue Name             | Concurrency | Input                                                                                                            | Output                                                                                 |
| ---------------------- | ---------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `content-extraction`   | `content-extraction`   | 2           | URL/text → extracted content                                                                                     | Updates Discovery.sourceContent                                                        |
| `script-generation`    | `script-generation`    | 2           | Discovery metadata → 2-voice script with `[N]` citations                                                         | Creates Script + References, routes to script verification                             |
| `script-verification`  | `script-verification`  | 2           | Script + References → claim extraction + sourcing check (≤3 revision loops)                                      | Passes → routes to ref validation or audio; Fails → regenerates script                 |
| `reference-validation` | `reference-validation` | 2           | References + Script → domain-aware verification via `runReferenceVerification()` (ACADEMIC/NEWS/GOVERNMENT/GENERAL scoring) | Verifies/replaces/removes refs, stores `contentDomain`, sets SCRIPT_READY (WEB/IMPORT) or creates Segments + queues audio (TWITTER/API) |
| `audio-generation`     | `audio-generation`     | 15          | Segment text → TTS via `resolveTtsProvider` (BYOK or platform, 8 providers) + FFprobe duration. Supports per-segment TTS overrides (`segment.ttsProvider/ttsModel/ttsVoiceId`) for admin showcase builder — bypasses `resolveTtsProvider` and uses `createTtsProviderAsync` with platform keys directly | Uploads segment audio to R2, writes `segment.duration`, logs cost to `ApiUsageLog`     |
| `audio-stitching`      | `audio-stitching`      | 1           | All segments → FFmpeg concat + SFX overlay (with `adelay`) + normalization                                       | Uploads final podcast audio, creates `PodcastVersion`, computes startTimes, sets READY |
| `interaction`          | `interactions`         | 3           | User question + segment-based timestamp lookup → Claude answer + segmentOrder computation                        | Updates Interaction.answer, status, segmentOrder                                       |
| `segment-regeneration` | `segment-regeneration` | 2           | Text → TTS via `resolveTtsProvider` (matches podcast voice + provider config) → transactional insert → re-stitch | Queues audio-stitching (`skipSfx`), marks INCORPORATED                                 |
| `notification`         | `notifications`        | 5           | User + message → in-app + push                                                                                   | Creates Notification + sends push                                                      |
| `pdf-generation`       | `pdf-generation`       | 2           | Podcast → pdfmake PDF → R2 upload                                                                                | Sets Podcast.pdfUrl                                                                    |
| `twitter-mentions`     | `twitter-mentions`     | 1           | Poll @sottofm mentions → parse intent → create podcast                                                           | Creates TweetMention + Podcast, kicks off pipeline                                     |
| `twitter-reply`        | `twitter-reply`        | 2           | Podcast ready → compose reply → post to Twitter                                                                  | Updates TweetMention.status to REPLIED                                                 |
| `twitter-auto-tweet`   | `twitter-auto-tweet`   | 1           | Podcast ID + trigger → interpolate template → post tweet                                                         | Updates TwitterAutoTweet record (tweetId, status)                                      |
| `twitter-trend-poll`   | `twitter-trend-poll`   | 1           | Poll trending tweets → score + deduplicate → create podcast as @sotto                                            | Creates Podcast + TwitterAutoTweet, kicks off pipeline                                 |
| `audio-import`         | `audio-import`         | 2           | Uploaded audio → FFmpeg normalize → STT transcribe → diarize → create segments + version                         | Transcribes, creates Script + Segments + PodcastVersion, auto-tags, sets READY         |
| `event-ingestion`      | `event-ingestion`      | 5           | Batch of behavioral events → upsert sessions + insert events + update playback aggregates                        | Creates UserSession + BehavioralEvent records, updates PlaybackSession                 |
| `feature-computation`  | `feature-computation`  | 2           | Scope (user/podcast/all) → aggregate sessions + engagement into feature vectors                                  | Upserts UserFeature / PodcastFeature with embeddings, runs hourly or on-demand         |
| `data-export`          | `data-export`          | 1           | Export type + date range + format → stream large result sets to JSONL/CSV                                        | Uploads export file to R2, returns fileUrl                                             |
| `key-validation`       | `key-validation`       | 1           | Scheduled (every 24h) → re-validate all BYOK TTS + AI keys against provider APIs                                | Marks invalid keys `isValid=false`, sends KEY_INVALID notification to affected users   |
| `telegram-bot`         | `telegram-bot`         | 1           | Dual-mode: webhook (prod) or 5s polling (dev). Handler logic in `lib/telegram-handler.ts` | Saves topic/URL as PodcastIdea, sends confirmation reply; notifies user when podcast is ready |
| `telegram-reply`       | `telegram-reply`       | 2           | Podcast ready/failed → send Telegram message with "Listen Now" link                                              | Sends 'Listen Now' notification to any user with telegramEnabled + telegramChatId (not just TELEGRAM-source podcasts) |
| `content-moderation`   | `content-moderation`   | 3           | Content text → OpenAI Moderation API scan                                                                        | Creates ContentFlag records for flagged content                                        |
| `admin-thread-to-podcast` | `admin-thread-to-podcast` | 1      | Tweet URL → fetch thread → parse intent → create podcast as @sotto                                               | Creates Podcast, kicks off pipeline                                                    |
| `email-digest`            | `email-digest`            | 1      | Sunday 10:00 UTC cron → query new podcasts + stats → send weekly digest to subscribed waitlist emails            | Sends digest emails via Resend                                                         |
| `announcement`            | `announcements`           | 1      | Announcement payload (subject + message) → fan-out to all users in batches of 100                                | Creates in-app Notification + push (if pushNotifications=true) + email (if emailNotifications=true) per user |
| `r2-usage`                | `r2-usage`                | 1      | Scheduled (every 24h) → fetch R2 bucket usage + operation counts from Cloudflare API                            | Creates R2UsageSnapshot with storage size, ops counts, and cost estimates               |
| `pricing-fetch`             | `pricing-fetch`             | 1      | Scheduled (every 24h) → fetch pricing from pricetoken.ai API, save snapshots                                    | Creates ModelPricingSnapshot rows, refreshes in-memory pricing map                      |
| `visual-classification`     | `visual-classification`     | 2      | Podcast segments → Claude Haiku batch classification → assign visual types + prompts/metadata per segment       | Creates SegmentVisual records, queues place-enrichment for MAP_OVERLAY, visual-generation for other external assets, or video-composition if all programmatic |
| `place-enrichment`          | `place-enrichment`          | 3      | SegmentVisual places → gazetteer resolution (WHG/GeoNames/Pleiades) with yearHint → merge enriched metadata    | Updates SegmentVisual.metadata with coordinates/historicalContext/confidence, queues visual-generation |
| `visual-generation`         | `visual-generation`         | 5      | SegmentVisual → AI illustration (fal FLUX), stock footage (Pexels), or map image (Mapbox from pre-enriched places) → upload asset to R2. For video-mode segments: always generates first + last frame images (from prompt + endStatePrompt), persists `firstFrameUrl`/`lastFrameUrl`, passes both to video provider. Multi-clip chains use bookend strategy (first frame on clip 0, last frame on final clip). | Updates SegmentVisual.assetUrl + firstFrameUrl + lastFrameUrl + status, queues video-composition when all segments ready |
| `transition-generation`     | `transition-generation`     | 3      | Adjacent segment visuals → generate inter-segment transition clips (fal video) → upload to R2                  | Creates SegmentTransition records with asset URLs, queues video-composition when all done |
| `video-composition`         | `video-composition`         | 1      | All segment visuals + transitions ready → POST to Remotion sidecar → poll for completion → upload MP4 to R2    | Sets VideoGeneration.status=READY, Podcast.videoUrl, queues VIDEO_READY notification    |
| `news-ingest`               | `news-ingest`               | 1      | Scheduled (every 30min) → fetch all RSS feeds → upsert into IngestedArticle → prune >30 days                  | Populates IngestedArticle table for `/api/news` + `fetchNewsletterArticles()` DB reads  |
| `demo-script-generation`    | `demo-script`               | 2      | DemoProject features + description → Claude walkthrough prompt → JSON scenes with browser actions + narration  | Creates DemoScene records, sets project status SCRIPT_READY                              |
| `demo-recording`            | `demo-recording`            | 1      | DemoScene actions → Remotion sidecar /record → Playwright browser automation → graded MP4                     | Uploads recording to R2, sets DemoScene.recordingUrl + recordingStatus=READY             |
| `demo-voiceover`            | `demo-voiceover`            | 5      | DemoScene narration + per-scene TTS config → createTtsProviderAsync → audio buffer                            | Uploads voiceover to R2, sets DemoScene.voiceoverUrl + voiceoverStatus=READY             |
| `demo-visual`               | `demo-visual`               | 3      | DemoScene visualType + visualPrompt → fal FLUX (image), fal video, or Mapbox (map)                            | Uploads visual to R2, sets DemoScene.visualUrl + visualStatus=READY                      |
| `demo-transition`           | `demo-transition`           | 2      | Adjacent scene recordings → FFmpeg xfade crossfade clip                                                        | Uploads transition to R2, sets DemoScene.transitionUrl + transitionStatus=READY           |
| `demo-composition`          | `demo-composition`          | 1      | All scene assets ready → Remotion sidecar /render (compositionId=LaunchVideo) → poll status → download MP4    | Uploads final video to R2, sets DemoProject.videoUrl + status=READY                      |
| `waveform-generation`       | `waveform-generation`       | 2      | Podcast audioUrl → FFmpeg astats (waveform peaks JSON) + showspectrumpic (spectrogram PNG) → R2 upload        | Sets Podcast.waveformUrl + spectrogramUrl                                                |
| `quiz-generation`           | `quiz-generation`           | 2      | Podcast script → LLM generates 3-5 MCQ → PodcastQuiz + QuizQuestion records                                  | Creates PodcastQuiz (status READY), fire-and-forget from audio-stitching + audio-import  |
| `briefing-scheduler`        | `briefing-scheduler`        | 1      | Cron (every 15min) → find eligible users by time+timezone+interests → create BRIEFING podcast per user        | Creates Podcast (source=BRIEFING) + BriefingLog, kicks off pipeline via content-extraction |

## Pipeline Flow

```
content-extraction → script-generation → script-verification ──→ reference-validation → [SCRIPT_READY] → audio-generation (×N) → audio-stitching → notification
                                              ↑       │                                      │                                                          ↕
                                              │  FAIL (≤3)                         WEB/IMPORT: pause      pdf-generation         twitter-reply (if TWITTER)
                                              └───────┘                            for user review         (on-demand)            telegram-reply (if TELEGRAM)
                                                                                   TWITTER/API/TELEGRAM: auto-approve

twitter-mentions (repeatable, every 60s) → polls @sottofm → creates Podcast → kicks off pipeline above
twitter-trend-poll (repeatable, every 2hrs) → searches trending tweets → creates Podcast as @sotto → kicks off pipeline above
admin-thread-to-podcast (on-demand) → fetches thread → creates Podcast as @sotto → kicks off pipeline above
twitter-auto-tweet (on-demand) → interpolates template → posts tweet → updates TwitterAutoTweet record
telegram-bot (webhook in prod, 5s polling in dev) → routes Telegram updates → saves topic/URL as PodcastIdea → sends confirmation reply
telegram-reply (on completion) → sends "Listen Now" notification to any user with telegramEnabled + telegramChatId
email-digest (cron, Sunday 10:00 UTC) → queries new podcasts + stats → sends weekly digest to subscribed waitlist emails
news-ingest (repeatable, every 30min) → fetches all RSS feeds → upserts IngestedArticle → prunes old articles
briefing-scheduler (repeatable, every 15min) → finds eligible users → creates BRIEFING podcast → kicks off pipeline
quiz-generation (fire-and-forget, post-READY) → generates MCQ from script → creates PodcastQuiz

Script review (at SCRIPT_READY):
  User edits script → PATCH /api/podcasts/[id]/script (save edits)
  User approves    → POST  /api/podcasts/[id]/script/approve (creates Segments, queues audio)
  User regenerates → POST  /api/podcasts/[id]/script/regenerate (re-queues script-generation)

Incorporation (post-READY):
  incorporate endpoint → segment-regeneration → audio-stitching (skipSfx) → READY
  (ANSWERED → INCORPORATING)  (TTS + insert)    (re-concat + startTimes)   (INCORPORATED)

Video pipeline (post-READY, PRO/admin only):
  POST /api/podcasts/[id]/video → visual-classification → place-enrichment (MAP_OVERLAY) / visual-generation (×N parallel) → transition-generation (×N-1 parallel) → video-composition → notification
                                   (Claude Haiku)          (fal FLUX / Pexels)              (fal video between segments)       (Remotion sidecar)    (VIDEO_READY)
```

## Standalone Utility Workers

**`content-moderation`** is NOT part of the generation pipeline. It's an async content scanner that runs on-demand — triggered when comments or podcast scripts need moderation review. It calls the OpenAI Moderation API and creates `ContentFlag` records for flagged content. Admins review flags in the moderation dashboard.

## Centralized Failure Handler

`queue.ts`'s `createWorker()` wires a centralized `'failed'` event handler on every Worker that:

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
5. If the worker is **dev-only or experimental**, add it to `EXPERIMENTAL_WORKERS` in `worker-routing.ts` — otherwise it runs by default under the `core` preset
6. Update this CLAUDE.md
