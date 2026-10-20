# @sotto/shared — Shared Types, Validations & Design Tokens

Prisma-free package consumed by `apps/web/`.

Vocabulary contracts live in `learning/dictionary.ts` and
`learning/vocabulary-study.ts`. `ready_vocabulary` is a separate public practice
variant, with opaque card identifiers and feedback released after responding.
Private study answer snapshots never belong in shared public schemas. Regenerate
all three OpenAPI specs after contract changes and keep native clients explicit
about web continuation for unsupported study modes.

## Structure

```
src/
├── types/
│   ├── enums.ts          # String union equivalents of Prisma enums — includes language-learning enums: CefrLevel, SkillType, ClassStatus, SectionStatus, SpeakingGradeStatus, EdgeType, PracticeKind, PracticeStatus, ExamInstitution, MockExamStatus, PedagogyStyle (language pairs are flexible native→target ISO codes, no enum)
│   ├── episode.ts        # EpisodeSummary, EpisodeDetail, SegmentData, CreateEpisodeRequest, AiModelOption, TtsOption, ScriptTurn, VoiceProfile
│   ├── reference.ts      # ReferenceData (includes contentDomain: string | null), VerificationLayerResult
│   ├── class-document.ts # ClassDocument, ClassDocumentSection, ClassDocumentQuestion, ClassDocumentPrompt — render contract for the web worksheet page
│   ├── discovery.ts      # DiscoveryMessage, DiscoveryMetadata, DiscoveryState, VerificationMode
│   ├── player.ts         # PlayerState, PlayerControls
│   ├── interaction.ts    # InteractionRequest, InteractionResponse
│   ├── notification.ts   # NotificationData, PushSubscriptionData
│   ├── version.ts        # EpisodeVersionSummary, EpisodeVersionDetail
│   ├── analytics.ts      # AnalyticsResponse, AnalyticsSummary
│   └── api-key.ts        # ApiKeyData, ApiKeyCreated
├── brand.ts              # BRAND constant — single source of truth for product tagline and descriptions
├── content-badge.ts      # getContentBadgeLabel(), getEpisodeBadges() — content/AI/TTS/language badge logic
├── provider-display.ts   # AI_PROVIDER_DISPLAY, TTS_PROVIDER_DISPLAY, AI_MODEL_DISPLAY, LANGUAGE_DISPLAY maps + label helpers
├── generation-messages.ts # STAGE_MESSAGES pools + resolveMessage() — rotating sub-messages for pipeline generation stages
├── validations.ts        # Shared Zod schemas — createEpisodeSchema is the canonical schema (web re-exports from here)
├── theme.ts              # Design tokens: colors, spacing, typography, borderRadius
└── index.ts              # Barrel export
```

## Rules

`src/play/` defines browser-safe game commands, personalized round views and
versioned invitation links. Server-private round state and scoring live in the
web library. Native clients consume the same API contracts and allowed actions.
`contracts/play.ts` registers member and claimant-proof operations in the full
OpenAPI contract. Play operations and their components stay outside the TUI
codegen surface. Proofs travel only in `X-Sotto-Play-Proof`; existing-player
admission additionally requires that player's canonical app credential.

- **No Prisma imports** — use string union types from `enums.ts` instead
- **No React imports** — types only, no components or hooks
- **No Node.js APIs** — must stay browser-safe
- **Keep enums in sync** — when Prisma schema adds an enum value, add it to `enums.ts` too

## How web app consumes this

Type files in `apps/web/src/types/` are thin re-exports:

```typescript
// apps/web/src/types/discovery.ts
export type { DiscoveryMessage, DiscoveryMetadata, DiscoveryState } from '@sotto/shared';
```

This means `@/types/*` imports throughout the web app don't change.
Prisma-dependent types (episode.ts, reference.ts) still import from `@prisma/client` directly.
