# @sottofm/feed

[![CI](https://github.com/SottoFM/feed/actions/workflows/ci.yml/badge.svg)](https://github.com/SottoFM/feed/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@sottofm/feed)](https://www.npmjs.com/package/@sottofm/feed)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

The open-source feed ranking algorithm behind [Sotto](https://sotto.fm).

## Why Open Source?

We believe feed algorithms should be transparent. When Twitter open-sourced their recommendation algorithm in 2023, it raised the bar for algorithmic accountability. We're doing the same for podcast discovery.

Every function in this package is pure, deterministic, and testable without mocks. You can read the code, understand why a podcast was recommended, and propose improvements.

## How It Works

Sotto's feed ranking uses a **5-signal scoring model** adapted to each user's listening archetype, followed by diversity filtering and categorization. This package contains all the pure math and logic -- no database queries, no API calls, zero runtime dependencies.

## Quick Start

```bash
npm install @sottofm/feed
```

```typescript
import {
  computeRelevance,
  computeQuality,
  computeFreshness,
  computeWeightedScore,
  getArchetypeWeights,
  explain,
  applyDiversity,
  constructFeed,
} from '@sottofm/feed';

// Score a single candidate
const relevance = computeRelevance({
  embeddingSimilarity: 0.85,
  interestMatches: [{ tagId: 'ai', weight: 0.9 }],
  podcastTagIds: ['ai', 'ml'],
  tagParentMap: new Map([['ai', 'tech'], ['ml', 'tech']]),
});

// Or use the full pipeline
const feed = constructFeed({
  candidates: [...],
  weights: getArchetypeWeights('explorer'),
  context: { followedCreatorIds, interestTagIds, ... },
  fatigueEntries: [],
});
```

## The Ranking Pipeline

```
Sourcing (60/40 in/out-of-network)
  |
  v
Light Rank (relevance + freshness -> prune to 2x budget)
  |
  v
Heavy Rank (full 5-signal scoring with archetype weights)
  |
  v
Quality Gate (exclude low-reputation creators)
  |
  v
Social Proof (out-of-network needs mutual engagers)
  |
  v
Author Diversity Penalty (score-halving on repeated creator)
  |
  v
Fatigue (per user x creator decay from skips/dismissals)
  |
  v
Dedup (penalty for already-seen content)
  |
  v
Diversity (creator + tag caps)
  |
  v
Categorize (Continue Learning / Fresh Perspective / From Your People)
```

## Signals

Each candidate is scored on 5 signals, each normalized to 0-1:

| Signal | What it measures | Formula |
|--------|-----------------|---------|
| **Relevance** | Topic match to user interests | Embedding similarity x 0.5 + interest tag match x 0.5 (exact = full weight, sibling = 0.4x) |
| **Collaborative** | How similar users engaged | Mean completion rate of other users who listened (>50%) |
| **Quality** | Content quality indicators | Completion x 0.4 + likes x 0.3 + verified refs x 0.2 + interactions x 0.1 |
| **Freshness** | Recency + cold start | 30-day linear decay + 0.2 bonus if < 10 listeners |
| **Novelty** | Anti-echo-chamber | Inverse of relevance (when user has topic affinity), else 0.5 |

## Archetypes

Users are classified into behavioral archetypes that adjust signal weights:

| Archetype | Classification Rule | Emphasis |
|-----------|-------------------|----------|
| **Deep Listener** | >90% completion, <=1.25x speed | Relevance (0.35), Quality (0.3) |
| **Skimmer** | <50% completion, >1.25x speed, >2 seeks | Quality (0.3), Freshness (0.25) |
| **Explorer** | Default | Novelty (0.3), Freshness (0.25) |
| **Completer** | >90% completion, few interactions | Relevance (0.3), Collaborative (0.25) |
| **Social Learner** | >1 interaction per session | Collaborative (0.35), Quality (0.25) |

## Twitter-Inspired Features

| Feature | Function | Analog |
|---------|----------|--------|
| Creator Reputation | `computeCreatorReputation()` | TweepCred (0-100 composite score) |
| Social Proof Gate | `applySocialProofGate()` | 2nd-degree connection check |
| Feedback Fatigue | `computeFatigueMultiplier()` | Skip/dismiss decay over 14 days |
| Quality Gate | `applyQualityGate()` | Hard distribution floor (reputation >= 10) |
| Dedup Penalty | `applyDedupPenalty()` | Already-seen score reduction (50%) |
| Candidate Sourcing | `sourceCandidates()` | 60/40 in-network/out-of-network split |
| Two-Stage Pipeline | `lightRank()` + `heavyRank()` | Cheap prune then full scoring |
| Feed Constructor | `constructFeed()` | Home Mixer orchestrator |

## Configuration

All thresholds are configurable via `FeedConfig`:

```typescript
import { DEFAULT_FEED_CONFIG } from '@sottofm/feed';

// Defaults:
{
  confidenceThreshold: 0.45,  // Minimum score to show
  maxPicks: 7,                // Max items in feed
  maxPerCreator: 1,           // Creator diversity cap
  maxPerPrimaryTag: 2,        // Tag diversity cap
  continueLearningSlots: 3,   // Category slot sizes
  freshPerspectiveSlots: 2,
  fromYourPeopleSlots: 2,
  freshnessDecayDays: 30,
  coldStartListenerThreshold: 10,
  coldStartBonus: 0.2,
  siblingMatchWeight: 0.4,
}
```

## API Reference

### Signals

- `computeRelevance(input: RelevanceInput): number`
- `computeCollaborative(input: CollaborativeInput): number`
- `computeQuality(input: QualityInput): number`
- `computeFreshness(input: FreshnessInput): number`
- `computeNovelty(input: NoveltyInput): number`
- `computeAllSignals(input: AllSignalsInput): RecommendationSignals`

### Scoring & Explanation

- `computeWeightedScore(signals, weights): number`
- `explain(signals): string`
- `explainDetailed(signals): Array<{ signal, value, label }>`

### Archetypes

- `classifyArchetype(input: ArchetypeInput): Archetype`
- `getArchetypeWeights(archetype: string): SignalWeights`

### Diversity & Categorization

- `applyDiversity(scored, candidates, config): ScoredCandidate[]`
- `categorizePicks(picks, candidates, context, config): PickCategory[]`

### Twitter-Inspired

- `computeCreatorReputation(input): number`
- `applySocialProofGate(socialProof, config?): boolean`
- `computeFatigueMultiplier(entries, creatorId, config?, now?): number`
- `applyQualityGate(reputation, config?): boolean`
- `applyDedupPenalty(score, alreadySeen, config?): number`
- `sourceCandidates(candidates, isInNetwork, budget, config?): SourcingResult`
- `lightRank(candidates, budget): Array<{ id, score }>`
- `heavyRank(candidates, weights): ScoredCandidate[]`
- `constructFeed(input): RankedFeed`

## Development

```bash
npm install
npm test          # Run all tests
npm run typecheck # TypeScript strict mode
npm run build     # Build CJS + ESM + types
```

## Prior Art

- [Twitter's Recommendation Algorithm](https://blog.twitter.com/engineering/en_us/topics/open-source/2023/twitter-recommendation-algorithm) (2023)
- [YouTube's Deep Neural Networks for Recommendations](https://research.google/pubs/pub45530/) (2016)

## License

MIT
