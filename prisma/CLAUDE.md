# prisma/ — Database Schema & Seeds

## Schema Overview

The schema is organized into logical sections:

| Section           | Models                                                                      | Purpose                                                                                                                                                                |
| ----------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Users & Auth      | User, Account, Session, VerificationToken                                   | Authentication + profiles (includes `role`, `handle String? @unique`, `twitterHandle`, `twitterEnabled`, voice prefs)                                                  |
| Social            | Follow                                                                      | Follower/following relationships                                                                                                                                       |
| Subscriptions     | Subscription, SubscriptionEvent, CreditTransaction, Team                    | Stripe billing + credit balance (Float for fractional credits) + audit trail (includes voiceCreatorAddonActive Boolean, voiceCreatorAddonStripeSubscriptionId String?) |
| Podcasts          | Podcast (includes `pdfUrl`, `source`, `sourceTweetId`, `creditCost Float?`) | Core content entity (creditCost tracks actual cost for accurate refunds)                                                                                               |
| Discovery         | Discovery, DiscoveryMessage                                                 | Chat-based creation flow                                                                                                                                               |
| Scripts           | Script (includes `verificationAttempts`, `verificationFeedback`)            | Generated podcast scripts                                                                                                                                              |
| Segments          | Segment                                                                     | Per-speaker audio chunks                                                                                                                                               |
| References        | Reference                                                                   | Per-podcast `[N]` citations with title, authors, year, URL, type, verificationStatus                                                                                   |
| Interactions      | Interaction                                                                 | Q&A during playback                                                                                                                                                    |
| Social Engagement | Like, Save                                                                  | User engagement                                                                                                                                                        |
| Tags & Interests  | Tag, PodcastTag, UserInterest                                               | Content taxonomy + user interest selections (onboarding/manual/behavioral)                                                                                             |
| Notifications     | Notification, PushSubscription                                              | In-app + push notifications                                                                                                                                            |
| Jobs              | Job                                                                         | BullMQ job tracking                                                                                                                                                    |
| Voice Clones      | VoiceClone (includes `requestable`)                                         | User voice clones (name, ElevenLabs ID, source, requestable flag)                                                                                                      |
| Voice Requests    | VoiceRequest                                                                | Voice clone sharing requests (requester, owner, clone, status, message)                                                                                                |
| Voice Allowlist   | VoiceAllowlist                                                              | Pre-approved users for instant voice access (bypasses request flow)                                                                                                    |
| Reserved Handles  | ReservedHandle                                                              | Reserved handles (handle @unique, reason, createdBy)                                                                                                                   |
| API Keys          | ApiKey                                                                      | Developer API keys (hashed, prefix, usage)                                                                                                                             |
| Teams             | Team, TeamInvite                                                            | Team ownership, member management, invites                                                                                                                             |
| Twitter           | TweetMention                                                                | Tweet-to-podcast tracking (dedup, status, reply thread)                                                                                                                |
| Analytics         | ApiUsageLog                                                                 | Cost tracking                                                                                                                                                          |
| Feedback          | Feedback                                                                    | Early access user feedback                                                                                                                                             |

## Key Enums

| Enum                 | Values                                                                                                                                               | Used By                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `PodcastStatus`      | PENDING → DISCOVERING → EXTRACTING → SCRIPTING → VERIFYING_SCRIPT → VALIDATING_REFERENCES → GENERATING_AUDIO → STITCHING → READY → UPDATING → FAILED | Podcast.status               |
| `Speaker`            | HOST, EXPERT                                                                                                                                         | Segment.speaker              |
| `InteractionStatus`  | PENDING → ANSWERING → ANSWERED → RESOLVED → INCORPORATING → INCORPORATED                                                                             | Interaction.status           |
| `SubscriptionTier`   | FREE, STARTER, PRO, STUDIO                                                                                                                           | Subscription.tier            |
| `UserRole`           | USER, CREATOR, ADMIN, SYSTEM                                                                                                                         | User.role                    |
| `TeamInviteStatus`   | PENDING, ACCEPTED, EXPIRED, REVOKED                                                                                                                  | TeamInvite.status            |
| `VoiceCloneSource`   | UPLOAD, RECORD                                                                                                                                       | VoiceClone.sourceType        |
| `PodcastVisibility`  | PUBLIC, UNLISTED, PRIVATE                                                                                                                            | Podcast.visibility           |
| `PodcastSource`      | WEB, TWITTER, API                                                                                                                                    | Podcast.source               |
| `TweetMentionStatus` | PENDING, PARSING, GENERATING, READY, REPLIED, FAILED, IGNORED                                                                                        | TweetMention.status          |
| `ReferenceType`      | WEB, PAPER, BOOK, ARTICLE, VIDEO, REPORT                                                                                                             | Reference.type               |
| `VerificationStatus` | PENDING, VERIFIED, FAILED, REPLACED, REMOVED                                                                                                         | Reference.verificationStatus |
| `VoiceRequestStatus` | PENDING, APPROVED, DENIED, REVOKED                                                                                                                   | VoiceRequest.status          |
| `NotificationType`   | Includes VOICE_REQUEST_RECEIVED, VOICE_REQUEST_APPROVED, VOICE_REQUEST_DENIED (+ others)                                                             | Notification.type            |

## Commands

```bash
npx prisma db push     # Push schema changes (dev)
npx prisma generate    # Regenerate client
npx prisma studio      # Visual database browser
npx prisma db seed     # Run seed.ts
```

## Modifying the Schema

1. Edit `schema.prisma`
2. Run `npx prisma db push` (dev) or `npx prisma migrate dev` (production)
3. Run `npx prisma generate`
4. Update this CLAUDE.md if models/enums changed
5. Update `src/types/` if API response shapes changed
