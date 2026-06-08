# @sotto/shared — Shared Types, Validations & Design Tokens

Prisma-free package consumed by both `apps/web/` and `apps/mobile/`.

## Structure

```
src/
├── types/
│   ├── enums.ts          # String union equivalents of Prisma enums — includes language-learning enums: CefrLevel, SkillType, ClassStatus, SectionStatus, SpeakingGradeStatus, EdgeType (language pairs are flexible native→target ISO codes, no enum)
│   ├── podcast.ts        # PodcastSummary, PodcastDetail, SegmentData, CreatePodcastRequest, AiModelOption, TtsOption, ScriptTurn, VoiceProfile
│   ├── reference.ts      # ReferenceData (includes contentDomain: string | null), VerificationLayerResult
│   ├── class-document.ts # ClassDocument, ClassDocumentSection, ClassDocumentQuestion, ClassDocumentPrompt — render contract for web worksheet page and mobile PencilKit ClassWorksheet
│   ├── discovery.ts      # DiscoveryMessage, DiscoveryMetadata, DiscoveryState, InspireSection, NewsTimeRange, INSPIRE_SECTION_LABELS, NEWS_TIME_RANGE_LABELS
│   ├── player.ts         # PlayerState, PlayerControls
│   ├── interaction.ts    # InteractionRequest, InteractionResponse
│   ├── notification.ts   # NotificationData, PushSubscriptionData
│   ├── version.ts        # PodcastVersionSummary, PodcastVersionDetail
│   ├── analytics.ts      # AnalyticsResponse, AnalyticsSummary
│   ├── api-key.ts        # ApiKeyData, ApiKeyCreated
│   ├── import.ts         # ImportPodcastRequest, ImportProgress
│   ├── events.ts         # EventPayload (17 private workspace event types), EventContext
│   └── pitch.ts          # PitchDocument, PitchVersion, PitchManifest
├── brand.ts              # BRAND constant — single source of truth for product tagline, descriptions, and pitch copy
├── content-badge.ts      # getContentBadgeLabel(), getPodcastBadges() — content/AI/TTS/language badge logic
├── provider-display.ts   # AI_PROVIDER_DISPLAY, TTS_PROVIDER_DISPLAY, AI_MODEL_DISPLAY, LANGUAGE_DISPLAY maps + label helpers
├── generation-messages.ts # STAGE_MESSAGES pools + resolveMessage() — rotating sub-messages for pipeline generation stages
├── validations.ts        # Shared Zod schemas — createPodcastSchema is the canonical schema (web re-exports from here)
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
Prisma-dependent types (podcast.ts, reference.ts) still import from `@prisma/client` directly.
