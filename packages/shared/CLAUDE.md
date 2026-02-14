# @sotto/shared — Shared Types, Validations & Design Tokens

Prisma-free package consumed by both `apps/web/` and `apps/mobile/`.

## Structure

```
src/
├── types/
│   ├── enums.ts          # String union equivalents of Prisma enums
│   ├── podcast.ts        # PodcastSummary, PodcastDetail, SegmentData, etc.
│   ├── reference.ts      # ReferenceData, VerificationLayerResult
│   ├── twitter.ts        # TweetParseResult, TwitterTweet, TweetMentionData
│   ├── discovery.ts      # DiscoveryMessage, DiscoveryMetadata, DiscoveryState
│   ├── feed.ts           # FeedResponse, FeedSort, FeedFilters
│   ├── player.ts         # PlayerState, PlayerControls
│   ├── interaction.ts    # InteractionRequest, InteractionResponse
│   ├── notification.ts   # NotificationData, PushSubscriptionData
│   ├── version.ts        # PodcastVersionSummary, PodcastVersionDetail
│   ├── analytics.ts      # AnalyticsResponse, AnalyticsSummary
│   ├── api-key.ts        # ApiKeyData, ApiKeyCreated
│   ├── team.ts           # TeamSummary, TeamMember, TeamInviteData
│   ├── import.ts         # ImportPodcastRequest, ImportProgress
│   ├── events.ts         # EventPayload (23 event types), EventContext
│   └── pitch.ts          # PitchDocument, PitchVersion, PitchManifest
├── validations.ts        # Shared Zod schemas (createPodcast, interaction, feed, etc.)
├── theme.ts              # Design tokens: colors, spacing, typography, borderRadius
└── index.ts              # Barrel export
```

## Rules

- **No Prisma imports** — use string union types from `enums.ts` instead
- **No React imports** — types only, no components or hooks
- **No Node.js APIs** — must work in both web and React Native
- **Keep enums in sync** — when Prisma schema adds an enum value, add it to `enums.ts` too

## How web app consumes this

Type files in `apps/web/src/types/` are thin re-exports:
```typescript
// apps/web/src/types/discovery.ts
export type { DiscoveryMessage, DiscoveryMetadata, DiscoveryState } from '@sotto/shared';
```

This means `@/types/*` imports throughout the web app don't change.
Prisma-dependent types (podcast.ts, reference.ts, twitter.ts) still import from `@prisma/client` directly.
