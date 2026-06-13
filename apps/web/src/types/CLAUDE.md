# src/types/ — TypeScript Type Definitions

Shared types used across the application. These mirror Prisma models but are shaped for the frontend (API responses, component props).

## File Index

| File              | Contents                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `episode.ts`      | EpisodeSummary, EpisodeDetail (includes `references`, `pdfUrl`, `versions`, `ttsProvider`), SegmentData, CreateEpisodeRequest |
| `player.ts`       | PlayerState, PlayerControls                                                                                                                                       |
| `interaction.ts`  | InteractionRequest, InteractionResponse, ResolutionChoice                                                                                                         |
| `discovery.ts`    | DiscoveryMessage, DiscoveryMetadata, DiscoveryState                                                                                                               |
| `notification.ts` | NotificationData, PushSubscriptionData                                                                                                                            |
| `reference.ts`    | ReferenceData (id, number, title, authors, year, url, type, publisher, doi)                                                                                       |
| `api-key.ts`      | ApiKeyData, CreateKeyRequest, KeyListResponse                                                                                                                     |
| `team.ts`         | TeamData, TeamInviteData, TeamMember                                                                                                                              |
| `version.ts`      | EpisodeVersionData, EpisodeVersionSegmentData                                                                                                                     |

## Shared Package Re-export Pattern

Most type files are thin re-exports from `@sotto/shared` (`packages/shared/`):

```typescript
// discovery.ts
export type { DiscoveryMessage, DiscoveryMetadata, DiscoveryState } from '@sotto/shared';
```

This means `@/types/*` imports throughout the web app don't change.

**Exceptions** — these files still import from `@prisma/client` directly:

- `episode.ts` — uses `EpisodeStatus`, `EpisodeVisibility`, `EpisodeSource`, `Speaker`
- `reference.ts` — uses `ReferenceType`, `VerificationStatus`

## Rules

- Types here are for **API responses and component props** — not Prisma models
- Prisma types are auto-generated and imported from `@prisma/client`
- Keep types flat — avoid deep nesting
- When adding new shared types, define them in `packages/shared/src/types/` and re-export here
