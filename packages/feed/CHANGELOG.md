# Changelog

## 0.1.0 (2026-03-21)

### Features

- **5-signal scoring model**: relevance, collaborative, quality, freshness, novelty
- **Archetype classification**: deep_listener, skimmer, explorer, completer, social_learner
- **Archetype-weighted scoring**: per-user signal weight adaptation
- **Human-readable explanations**: `explain()` and `explainDetailed()`
- **MMR diversity filtering**: creator cap + primary tag cap
- **Pick categorization**: Continue Learning, Fresh Perspective, From Your People
- **Creator reputation scoring**: TweepCred-inspired 0-100 composite
- **Social proof gating**: 2nd-degree connection check for out-of-network content
- **Feedback fatigue decay**: per-creator skip/dismiss penalty with time decay
- **Quality gate**: hard distribution floor based on creator reputation
- **Dedup penalty**: score reduction for already-seen content
- **Candidate sourcing**: 60/40 in-network/out-of-network split
- **Two-stage pipeline**: light rank (prune) then heavy rank (full scoring)
- **Feed constructor**: `constructFeed()` orchestrates the full pipeline
- **Full test suite**: 105 tests covering all functions and edge cases
