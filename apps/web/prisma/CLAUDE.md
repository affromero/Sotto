# prisma/ — Database Schema & Seeds

## Schema Overview

The schema is organized into logical sections:

| Section           | Models                                                                                                                                                          | Purpose                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Users & Auth      | User, Account, Session, VerificationToken                                                                                                                       | Authentication + profiles (includes `role`, `handle String? @unique`, `twitterHandle`, `twitterEnabled`, voice prefs, `referredById` self-relation for referral tracking)               |
| Podcasts          | Podcast (includes `pdfUrl`, `source`, `currentVersion`, `importedAudioKey`, `isHumanContent`, `ttsProvider`)                                                    | Core private audio entity with versioning, imports, transcripts, generated media, and analytics counters                             |
| Agent Ingestions  | AgentIngestion                                                                                                                                                    | Private idempotency ledger for user-owned agent outputs that become `AGENT` podcasts                                                  |
| Discovery         | Discovery, DiscoveryMessage                                                                                                                                     | Chat-based creation flow                                                                                                            |
| Scripts           | Script (includes `verificationAttempts`, `verificationFeedback`)                                                                                                | Generated podcast scripts                                                                                                           |
| Segments          | Segment (includes nullable `ttsProvider`, `ttsModel`, `ttsVoiceId` for per-segment TTS overrides — used by admin showcase builder)                              | Per-speaker audio chunks                                                                                                            |
| References        | Reference                                                                                                                                                       | Per-podcast `[N]` citations with title, authors, year, URL, type, verificationStatus, contentDomain (ACADEMIC/NEWS/GOVERNMENT/GENERAL) |
| Interactions      | Interaction (includes `helpful Boolean?`, `segmentOrder Int?`, `visibility`)                                                                                     | Q&A during playback + resolution feedback + segment mapping                                                                          |
| Saves             | Save                                                                                                                                                            | Private save/library membership for podcasts                                                                                        |
| Podcast Ratings   | PodcastRating (includes `isCreator`, `completionPercent`)                                                                                                       | Quality ratings (voice, accuracy, flow, overall) per podcast — unique per user+podcast, open to creators + listeners                 |
| Collections       | Collection, CollectionItem                                                                                                                                      | Curated podcast playlists                                                                                                           |
| Tags & Interests  | Tag, PodcastTag, UserInterest                                                                                                                                   | Content taxonomy + user interest selections (onboarding/manual/behavioral)                                                          |
| Notifications     | Notification, PushSubscription                                                                                                                                  | In-app + push notifications                                                                                                         |
| Jobs              | Job                                                                                                                                                             | BullMQ job tracking                                                                                                                 |
| Voice Clones      | VoiceClone (includes `provider`, `externalVoiceId`, `requestable`, `priceInCents`)                                                                              | User voice clones (multi-provider: ElevenLabs voice ID or Fal speaker embedding URL, requestable flag, per-podcast pricing)         |
| Voice Requests    | VoiceRequest                                                                                                                                                    | Voice clone sharing requests (requester, owner, clone, status, message)                                                             |
| Avatar Shares     | AvatarImageShare (AvatarImageShareStatus enum: PENDING/APPROVED/DENIED/REVOKED)                                                                                 | Avatar image sharing requests between users (consent-based, follows VoiceRequest pattern)                                           |
| Voice Allowlist   | VoiceAllowlist                                                                                                                                                  | Pre-approved users for instant voice access (bypasses request flow)                                                                 |
| Voice Purchases   | VoicePurchase                                                                                                                                                   | Per-podcast voice payments (manual capture: authorized → captured/cancelled)                                                        |
| Reserved Handles  | ReservedHandle                                                                                                                                                  | Reserved handles (handle @unique, reason, createdBy)                                                                                |
| API Keys          | ApiKey                                                                                                                                                          | Developer API keys (hashed, prefix, usage)                                                                                          |
| Teams             | Team, TeamInvite                                                                                                                                                | Team ownership, member management, invites                                                                                          |
| Analytics         | ApiUsageLog                                                                                                                                                     | Cost tracking                                                                                                                       |
| Feedback          | Feedback                                                                                                                                                        | Early access user feedback                                                                                                          |
| Versioning        | PodcastVersion, PodcastVersionSegment (includes `ttsVoiceId` for version snapshots)                                                                             | Immutable version snapshots (segments + stitched audio per version)                                                                 |
| BYOK Keys (TTS)   | UserTtsKey                                                                                                                                                      | Multi-provider BYOK keys (AES-256-GCM encrypted): ElevenLabs, OpenAI, Cartesia, Hume, Fal, Replicate                        |
| BYOK Keys (AI)    | UserAiKey                                                                                                                                                       | AI provider BYOK keys (AES-256-GCM encrypted): Anthropic, OpenAI                                                                    |
| Auto Model Config | AutoModelConfig                                                                                                                                                 | Singleton row: per-plan "Auto" model resolution (Free + Pro AI/TTS/STT/Image/Video/Avatar provider+model defaults, included model lists, daily generation/video limits, per-provider AI/TTS allocations) |
| Taste Quiz        | TasteQuizAnswer                                                                                                                                                 | User taste quiz responses (questionId, tagSlugs, yes/no/skip) — unique per user+question                                             |
| Saved Ideas       | SavedIdea                                                                                                                                                       | Quiz-derived podcast ideas saved for later (questionId, tagSlugs, optional linked podcast)                                            |
| Recommendation ML | RecommendationLog, ListeningQueue, UserFeature, PodcastFeature, BehavioralEvent, UserSession, PlaybackSession                                                  | ML feature store: user/podcast features, behavioral events, sessions, recommendation logs, listening queue                            |
| Content Safety    | ModerationAction, Report, ClaimReport, ContentFlag                                                                                                              | Moderation actions, user reports, claim accuracy reports (with ClaimReportStatus enum), auto-flagged content                           |
| Mobile Push       | ExpoPushToken                                                                                                                                                   | Expo push notification tokens (platform: ios/android)                                                                                 |
| Waitlist          | Waitlist                                                                                                                                                        | Early access waitlist signups (email, source, `unsubscribed` flag)                                                                    |
| Invitation Links  | InvitationLink                                                                                                                                                  | Admin-generated single-use invite codes (12-char base64url, 24h expiry, auto-approve waitlist on redemption). Indexes: `[code]`, `[createdBy]` |
| Landing Showcase  | LandingShowcase                                                                                                                                                 | Singleton config for admin-configurable landing page showcase podcast (script excerpt range, audio/video clip times, bot overrides)    |
| R2 Monitoring     | R2UsageSnapshot                                                                                                                                                 | Daily snapshots of R2 bucket usage (storage size, object count, operation counts, cost estimates). Indexes: `[createdAt]`, `[bucket, createdAt]` |
| Video Generation  | VideoGeneration, SegmentVisual, SegmentTransition                                                                                                               | Async video pipeline: one VideoGeneration per podcast (status tracking, final MP4 URL), many SegmentVisuals (per-segment visual type + metadata + asset URL), SegmentTransitions (inter-segment transition clips with type + asset URL) |
| Post-Listen Quizzes | PodcastQuiz, QuizQuestion, QuizAttempt, QuizAnswer                                                                                                            | PodcastQuiz: one per podcast (status: GENERATING/READY/FAILED, aggregate stats). QuizQuestion: 3-5 MCQ per quiz. QuizAttempt: one per user per quiz (unique). QuizAnswer: per-question answers |
| Language Learning   | VocabularyEntry                                                                                                                                                 | Per-podcast vocabulary entries for language learning briefings. Fields: number (1-based [V{N}] marker index), word (target language), translation (English), partOfSpeech, pronunciation (phonetic guide), exampleSentence, difficulty. Unique on `[podcastId, number]`. Cascade-deletes with podcast |

## Key Enums

| Enum                 | Values                                                                                                                                                                          | Used By                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `PodcastStatus`      | PENDING → DISCOVERING → EXTRACTING → SCRIPTING → VERIFYING_SCRIPT → VALIDATING_REFERENCES → SCRIPT_READY → GENERATING_AUDIO → STITCHING → READY → UPDATING → FAILED → IMPORTING → TRANSCRIBING | Podcast.status               |
| `Speaker`            | HOST, EXPERT                                                                                                                                                                    | Segment.speaker              |
| `InteractionStatus`  | PENDING → ANSWERING → ANSWERED → RESOLVED → INCORPORATING → INCORPORATED                                                                                                        | Interaction.status           |
| `UserRole`           | USER, ADMIN, SYSTEM                                                                                                                                                             | User.role                    |
| `TeamInviteStatus`   | PENDING, ACCEPTED, EXPIRED, REVOKED                                                                                                                                             | TeamInvite.status            |
| `VoiceCloneSource`   | UPLOAD, RECORD                                                                                                                                                                  | VoiceClone.sourceType        |
| `PodcastVisibility`  | PUBLIC, UNLISTED, PRIVATE                                                                                                                                                       | Podcast.visibility           |
| `PodcastSource`      | WEB, API, AGENT, IMPORT, ADMIN                                                                                                                                        | Podcast.source               |
| `QuizStatus`         | GENERATING, READY, FAILED                                                                                                                                                       | PodcastQuiz.status           |
| `ReferenceType`      | WEB, PAPER, BOOK, ARTICLE, VIDEO, REPORT                                                                                                                                        | Reference.type               |
| `VerificationStatus` | PENDING, VERIFIED, FAILED, REPLACED, REMOVED                                                                                                                                    | Reference.verificationStatus |
| `VoiceRequestStatus` | PENDING, APPROVED, DENIED, REVOKED                                                                                                                                              | VoiceRequest.status          |
| `AvatarImageShareStatus` | PENDING, APPROVED, DENIED, REVOKED                                                                                                                                           | AvatarImageShare.status      |
| `NotificationType`   | Includes VOICE_REQUEST_*, AVATAR_IMAGE_REQUEST_*, QUESTION_ON_YOUR_PODCAST, SCRIPT_READY, VIDEO_READY (+ others)              | Notification.type            |
| `ReportReason`       | HARASSMENT, HATE_SPEECH, VIOLENCE, SEXUAL_CONTENT, MISINFORMATION, SPAM, IMPERSONATION, COPYRIGHT, VOICE_THEFT, MUSIC_UPLOAD, FALSE_HUMAN_BADGE, FALSE_CLAIM, OTHER             | Report.reason                |
| `ReportStatus`       | PENDING, REVIEWING, RESOLVED, DISMISSED                                                                                                                                         | Report.status                |
| `ClaimReportStatus`  | PENDING, REVIEWING, RESOLVED_VERIFIED, RESOLVED_INACCURATE, DISMISSED                                                                                                          | ClaimReport.status           |
| `VideoStatus`        | PENDING, CLASSIFYING, GENERATING_VISUALS, GENERATING_TRANSITIONS, COMPOSING, READY, FAILED                                                                                     | VideoGeneration.status       |
| `VisualType`         | DATA_CHART, QUOTE, COMPARISON, TIMELINE, DIAGRAM, STOCK_FOOTAGE, AI_ILLUSTRATION, TEXT_CARD                                                                                     | SegmentVisual.visualType     |

## Commands

From repo root (monorepo):

```bash
npx prisma db push --schema=apps/web/prisma/schema.prisma     # Push schema changes (dev)
npx prisma generate --schema=apps/web/prisma/schema.prisma     # Regenerate client
npx prisma studio --schema=apps/web/prisma/schema.prisma       # Visual database browser
```

From `apps/web/` directory:

```bash
npx prisma db push     # Push schema changes (dev)
npx prisma generate    # Regenerate client
npx prisma studio      # Visual database browser
```

## Modifying the Schema

1. Edit `schema.prisma`
2. Run `npx prisma db push` (dev) or `npx prisma migrate dev` (production)
3. Run `npx prisma generate`
4. Update this CLAUDE.md if models/enums changed
5. Update `src/types/` if API response shapes changed
6. If adding/changing enums, also update `packages/shared/src/types/enums.ts` (string union equivalents)
