# src/types/ — TypeScript Type Definitions

Shared types used across the application. These mirror Prisma models but are shaped for the frontend (API responses, component props).

## File Index

| File              | Contents                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `podcast.ts`      | PodcastSummary, PodcastDetail (includes `references`, `pdfUrl`, `forkedFrom`, `forks`, `remixNote`, `versions`, `ttsProvider`), SegmentData, CreatePodcastRequest |
| `player.ts`       | PlayerState, PlayerControls                                                                                                                                       |
| `interaction.ts`  | InteractionRequest, InteractionResponse, ResolutionChoice                                                                                                         |
| `feed.ts`         | FeedResponse, FeedSort (includes `most_forked`), FeedFilters (includes remixes mode)                                                                              |
| `discovery.ts`    | DiscoveryMessage, DiscoveryMetadata, DiscoveryState                                                                                                               |
| `notification.ts` | NotificationData, PushSubscriptionData                                                                                                                            |
| `reference.ts`    | ReferenceData (id, number, title, authors, year, url, type, publisher, doi)                                                                                       |
| `analytics.ts`    | UsageStats, AnalyticsData, CostBreakdown                                                                                                                          |
| `api-key.ts`      | ApiKeyData, CreateKeyRequest, KeyListResponse                                                                                                                     |
| `team.ts`         | TeamData, TeamInviteData, TeamMember                                                                                                                              |
| `twitter.ts`      | TweetParseResult, TwitterTweet, TwitterMention, TwitterSettingsData, TweetMentionData                                                                             |
| `events.ts`       | EventPayload (discriminated union of 23 event types), EventContext, BehavioralEventInput                                                                          |
| `version.ts`      | PodcastVersionData, PodcastVersionSegmentData                                                                                                                     |
| `import.ts`       | ImportPodcastRequest, ImportProgress, ImportStatus                                                                                                                |
| `pitch.ts`        | PitchVersion, PitchAsset types                                                                                                                                    |
| `next-auth.d.ts`  | NextAuth module augmentation: adds `role: UserRole` to Session.user, User, JWT                                                                                    |

## Rules

- Types here are for **API responses and component props** — not Prisma models
- Prisma types are auto-generated and imported from `@prisma/client`
- Keep types flat — avoid deep nesting
- Use string unions for simple enums in API responses (Prisma enums stay as-is)
