# prisma/ — Database Schema & Seeds

## Schema Overview

The schema is organized into logical sections:

| Section           | Models                                                                                                                                                          | Purpose                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Users & Auth      | User, Account, Session, VerificationToken                                                                                                                       | Authentication + profiles (includes `role`, `handle String? @unique`, `twitterHandle`, `twitterEnabled`, voice prefs)               |
| Social            | Follow                                                                                                                                                          | Follower/following relationships                                                                                                    |
| Podcasts          | Podcast (includes `pdfUrl`, `source`, `sourceTweetId`, `currentVersion`, `remixNote`, `importedAudioKey`, `isHumanContent`, `ttsProvider`, `commentCount`)      | Core content entity (versioning + import + fork fields)                                                                             |
| Discovery         | Discovery, DiscoveryMessage                                                                                                                                     | Chat-based creation flow                                                                                                            |
| Scripts           | Script (includes `verificationAttempts`, `verificationFeedback`)                                                                                                | Generated podcast scripts                                                                                                           |
| Segments          | Segment                                                                                                                                                         | Per-speaker audio chunks                                                                                                            |
| References        | Reference                                                                                                                                                       | Per-podcast `[N]` citations with title, authors, year, URL, type, verificationStatus                                                |
| Interactions      | Interaction (includes `helpful Boolean?`, `segmentOrder Int?`, `visibility`, `upvoteCount`), InteractionVote                                                    | Q&A during playback + public voting + resolution feedback + segment mapping                                                         |
| Comments          | Comment (self-referencing parentId, optional timestamp pin, denormalized replyCount)                                                                            | Threaded comments on podcasts                                                                                                       |
| Social Engagement | Like, Save                                                                                                                                                      | User engagement                                                                                                                     |
| Collections       | Collection, CollectionItem, CollectionFollow                                                                                                                    | Curated podcast playlists with follow/subscribe                                                                                     |
| Activity          | Activity                                                                                                                                                        | Social activity feed events (polymorphic target references)                                                                         |
| Tags & Interests  | Tag, PodcastTag, UserInterest                                                                                                                                   | Content taxonomy + user interest selections (onboarding/manual/behavioral)                                                          |
| Notifications     | Notification, PushSubscription                                                                                                                                  | In-app + push notifications                                                                                                         |
| Jobs              | Job                                                                                                                                                             | BullMQ job tracking                                                                                                                 |
| Voice Clones      | VoiceClone (includes `requestable`)                                                                                                                             | User voice clones (name, ElevenLabs ID, source, requestable flag)                                                                   |
| Voice Requests    | VoiceRequest                                                                                                                                                    | Voice clone sharing requests (requester, owner, clone, status, message)                                                             |
| Voice Allowlist   | VoiceAllowlist                                                                                                                                                  | Pre-approved users for instant voice access (bypasses request flow)                                                                 |
| Reserved Handles  | ReservedHandle                                                                                                                                                  | Reserved handles (handle @unique, reason, createdBy)                                                                                |
| API Keys          | ApiKey                                                                                                                                                          | Developer API keys (hashed, prefix, usage)                                                                                          |
| Teams             | Team, TeamInvite                                                                                                                                                | Team ownership, member management, invites                                                                                          |
| Twitter           | TweetMention                                                                                                                                                    | Tweet-to-podcast tracking (dedup, status, reply thread)                                                                             |
| Analytics         | ApiUsageLog                                                                                                                                                     | Cost tracking                                                                                                                       |
| Feedback          | Feedback                                                                                                                                                        | Early access user feedback                                                                                                          |
| Versioning        | PodcastVersion, PodcastVersionSegment                                                                                                                           | Immutable version snapshots (segments + stitched audio per version)                                                                 |
| BYOK Keys (TTS)   | UserTtsKey                                                                                                                                                      | Multi-provider BYOK keys (AES-256-GCM encrypted): ElevenLabs, OpenAI, PlayHT, Cartesia, Hume                                        |
| BYOK Keys (AI)    | UserAiKey                                                                                                                                                       | AI provider BYOK keys (AES-256-GCM encrypted): Anthropic, OpenAI                                                                    |
| Free Tier Config  | FreeTierConfig                                                                                                                                                  | Singleton row: admin-configurable free tier settings (AI provider/model, TTS provider, generation limit)                              |

## Key Enums

| Enum                 | Values                                                                                                                                                                          | Used By                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `PodcastStatus`      | PENDING → DISCOVERING → EXTRACTING → SCRIPTING → VERIFYING_SCRIPT → VALIDATING_REFERENCES → SCRIPT_READY → GENERATING_AUDIO → STITCHING → READY → UPDATING → FAILED → IMPORTING → TRANSCRIBING | Podcast.status               |
| `Speaker`            | HOST, EXPERT                                                                                                                                                                    | Segment.speaker              |
| `InteractionStatus`  | PENDING → ANSWERING → ANSWERED → RESOLVED → INCORPORATING → INCORPORATED                                                                                                        | Interaction.status           |
| `UserRole`           | USER, CREATOR, ADMIN, SYSTEM                                                                                                                                                    | User.role                    |
| `TeamInviteStatus`   | PENDING, ACCEPTED, EXPIRED, REVOKED                                                                                                                                             | TeamInvite.status            |
| `VoiceCloneSource`   | UPLOAD, RECORD                                                                                                                                                                  | VoiceClone.sourceType        |
| `PodcastVisibility`  | PUBLIC, UNLISTED, PRIVATE                                                                                                                                                       | Podcast.visibility           |
| `PodcastSource`      | WEB, TWITTER, API, IMPORT                                                                                                                                                       | Podcast.source               |
| `TweetMentionStatus` | PENDING, PARSING, GENERATING, READY, REPLIED, FAILED, IGNORED                                                                                                                   | TweetMention.status          |
| `ReferenceType`      | WEB, PAPER, BOOK, ARTICLE, VIDEO, REPORT                                                                                                                                        | Reference.type               |
| `VerificationStatus` | PENDING, VERIFIED, FAILED, REPLACED, REMOVED                                                                                                                                    | Reference.verificationStatus |
| `VoiceRequestStatus` | PENDING, APPROVED, DENIED, REVOKED                                                                                                                                              | VoiceRequest.status          |
| `NotificationType`   | Includes VOICE_REQUEST_*, QUESTION_ON_YOUR_PODCAST, QUESTION_UPVOTED, COMMENT_ON_YOUR_PODCAST, COMMENT_REPLY, SCRIPT_READY (+ others)                                          | Notification.type            |

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
