# src/types/ — TypeScript Type Definitions

Shared types used across the application. These mirror Prisma models but are shaped for the frontend (API responses, component props).

## File Index

| File              | Contents                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `podcast.ts`      | PodcastSummary, PodcastDetail (includes `references`, `pdfUrl`, `versions`, `ttsProvider`), SegmentData, CreatePodcastRequest |
| `player.ts`       | PlayerState, PlayerControls                                                                                                                                       |
| `interaction.ts`  | InteractionRequest, InteractionResponse, ResolutionChoice                                                                                                         |
| `discovery.ts`    | DiscoveryMessage, DiscoveryMetadata, DiscoveryState                                                                                                               |
| `notification.ts` | NotificationData, PushSubscriptionData                                                                                                                            |
| `reference.ts`    | ReferenceData (id, number, title, authors, year, url, type, publisher, doi)                                                                                       |
| `analytics.ts`    | UsageStats, AnalyticsData, CostBreakdown                                                                                                                          |
| `api-key.ts`      | ApiKeyData, CreateKeyRequest, KeyListResponse                                                                                                                     |
| `team.ts`         | TeamData, TeamInviteData, TeamMember                                                                                                                              |
| `events.ts`       | EventPayload (discriminated union of 17 private workspace event types), EventContext, BehavioralEventInput                                                        |
| `version.ts`      | PodcastVersionData, PodcastVersionSegmentData                                                                                                                     |
| `import.ts`       | ImportPodcastRequest, ImportProgress, ImportStatus                                                                                                                |
| `telegram.ts`     | TelegramParseResult, TelegramUpdate, TelegramMessageData, Telegram API payload types                                                                              |
| `pitch.ts`        | PitchVersion, PitchAsset types                                                                                                                                    |
| `next-auth.d.ts`  | NextAuth module augmentation: adds `role: UserRole` to Session.user, User, JWT                                                                                    |

## Shared Package Re-export Pattern

Most type files are thin re-exports from `@sotto/shared` (`packages/shared/`):

```typescript
// discovery.ts
export type { DiscoveryMessage, DiscoveryMetadata, DiscoveryState } from '@sotto/shared';
```

This means `@/types/*` imports throughout the web app don't change.

**Exceptions** — these files still import from `@prisma/client` directly:

- `podcast.ts` — uses `PodcastStatus`, `PodcastVisibility`, `PodcastSource`, `Speaker`
- `reference.ts` — uses `ReferenceType`, `VerificationStatus`
- `telegram.ts` — uses `TelegramMessageStatus`
- `next-auth.d.ts` — uses `UserRole` (NextAuth module augmentation)

## Rules

- Types here are for **API responses and component props** — not Prisma models
- Prisma types are auto-generated and imported from `@prisma/client`
- Keep types flat — avoid deep nesting
- When adding new shared types, define them in `packages/shared/src/types/` and re-export here
