# @sottofm/feed — Open-Source Feed Ranking Algorithm

Zero-dependency, pure-function feed ranking for the Sotto podcast network.

## Structure

| File | Purpose |
|------|---------|
| `src/types.ts` | All interfaces and type aliases |
| `src/config.ts` | `FeedConfig` interface + `DEFAULT_FEED_CONFIG` |
| `src/signals/relevance.ts` | Tag matching (exact + sibling via parentId), embedding blend |
| `src/signals/collaborative.ts` | Mean completion rate from similar users |
| `src/signals/quality.ts` | Weighted composite: completion, likes, refs, interactions |
| `src/signals/freshness.ts` | 30-day linear decay + cold-start bonus |
| `src/signals/novelty.ts` | Anti-echo-chamber: inverse of relevance |
| `src/signals/index.ts` | `computeAllSignals()` convenience wrapper |
| `src/archetypes.ts` | `classifyArchetype()` + `getArchetypeWeights()` |
| `src/scoring.ts` | `computeWeightedScore(signals, weights)` |
| `src/explain.ts` | `explain()` + `explainDetailed()` |
| `src/diversity.ts` | `applyDiversity()` — creator + tag caps |
| `src/categorize.ts` | `categorizePicks()` — slot assignment |
| `src/index.ts` | Barrel export |

## Commands

```bash
npm test              # vitest run
npm run typecheck     # tsc --noEmit
npm run build         # tsup → dist/ (cjs + esm + dts)
```

## Rules

- Zero runtime dependencies — pure functions only
- All inputs are pre-computed data, never Prisma/DB objects
- Generic `id` field — web adapter maps to `podcastId`
- Every function must be deterministic and testable without mocks
- Standalone tsconfig.json (no `extends` from monorepo root)
