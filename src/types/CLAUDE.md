# src/types/ — TypeScript Type Definitions

Shared types used across the application. These mirror Prisma models but are shaped for the frontend (API responses, component props).

## File Index

| File | Contents |
|------|---------|
| `podcast.ts` | PodcastSummary, PodcastDetail (includes `references`, `pdfUrl`), SegmentData, CreatePodcastRequest |
| `player.ts` | PlayerState, PlayerControls |
| `interaction.ts` | InteractionRequest, InteractionResponse, ResolutionChoice |
| `feed.ts` | FeedResponse, FeedSort, FeedFilters |
| `discovery.ts` | DiscoveryMessage, DiscoveryMetadata, DiscoveryState |
| `notification.ts` | NotificationData, PushSubscriptionData |
| `reference.ts` | ReferenceData (id, number, title, authors, year, url, type, publisher, doi) |

## Rules
- Types here are for **API responses and component props** — not Prisma models
- Prisma types are auto-generated and imported from `@prisma/client`
- Keep types flat — avoid deep nesting
- Use string unions for simple enums in API responses (Prisma enums stay as-is)
