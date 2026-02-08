# prisma/ — Database Schema & Seeds

## Schema Overview

The schema is organized into logical sections:

| Section | Models | Purpose |
|---------|--------|---------|
| Users & Auth | User, Account, Session, VerificationToken | Authentication + profiles |
| Social | Follow | Follower/following relationships |
| Subscriptions | Subscription, SubscriptionEvent, Team | Stripe billing |
| Podcasts | Podcast (includes `pdfUrl`) | Core content entity |
| Discovery | Discovery, DiscoveryMessage | Chat-based creation flow |
| Scripts | Script | Generated podcast scripts |
| Segments | Segment | Per-speaker audio chunks |
| References | Reference | Per-podcast `[N]` citations with title, authors, year, URL, type, verificationStatus |
| Interactions | Interaction | Q&A during playback |
| Social Engagement | Like, Save | User engagement |
| Tags | Tag, PodcastTag | Content taxonomy |
| Notifications | Notification, PushSubscription | In-app + push notifications |
| Jobs | Job | BullMQ job tracking |
| Analytics | ApiUsageLog | Cost tracking |
| Feedback | Feedback | Early access user feedback |

## Key Enums

| Enum | Values | Used By |
|------|--------|---------|
| `PodcastStatus` | PENDING → DISCOVERING → EXTRACTING → SCRIPTING → VALIDATING_REFERENCES → GENERATING_AUDIO → STITCHING → READY → UPDATING → FAILED | Podcast.status |
| `Speaker` | HOST, EXPERT | Segment.speaker |
| `InteractionStatus` | PENDING → ANSWERING → ANSWERED → RESOLVED → INCORPORATING → INCORPORATED | Interaction.status |
| `SubscriptionTier` | FREE, PRO, TEAM | Subscription.tier |
| `PodcastVisibility` | PUBLIC, UNLISTED, PRIVATE | Podcast.visibility |
| `ReferenceType` | WEB, PAPER, BOOK, ARTICLE, VIDEO, REPORT | Reference.type |
| `VerificationStatus` | PENDING, VERIFIED, FAILED, REPLACED, REMOVED | Reference.verificationStatus |

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
