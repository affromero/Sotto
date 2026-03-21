import { describe, it, expect } from 'vitest';
import { classifyArchetype, getArchetypeWeights } from '../src/archetypes.js';

describe('classifyArchetype', () => {
  it('classifies deep_listener: high completion, low speed', () => {
    expect(
      classifyArchetype({
        avgCompletionRate: 95,
        avgSpeed: 1.0,
        sessions: [{ seekCount: 0, interruptCount: 0 }],
      })
    ).toBe('deep_listener');
  });

  it('classifies skimmer: low completion, high speed, many seeks', () => {
    expect(
      classifyArchetype({
        avgCompletionRate: 30,
        avgSpeed: 1.5,
        sessions: [{ seekCount: 5, interruptCount: 0 }],
      })
    ).toBe('skimmer');
  });

  it('classifies completer: high completion, few interactions', () => {
    expect(
      classifyArchetype({
        avgCompletionRate: 95,
        avgSpeed: 1.5,
        sessions: [{ seekCount: 0, interruptCount: 0 }],
      })
    ).toBe('completer');
  });

  it('classifies social_learner: many interactions', () => {
    expect(
      classifyArchetype({
        avgCompletionRate: 70,
        avgSpeed: 1.0,
        sessions: [{ seekCount: 0, interruptCount: 3 }],
      })
    ).toBe('social_learner');
  });

  it('defaults to explorer', () => {
    expect(
      classifyArchetype({
        avgCompletionRate: 60,
        avgSpeed: 1.0,
        sessions: [{ seekCount: 1, interruptCount: 0 }],
      })
    ).toBe('explorer');
  });

  it('handles empty sessions', () => {
    expect(
      classifyArchetype({
        avgCompletionRate: 60,
        avgSpeed: 1.0,
        sessions: [],
      })
    ).toBe('explorer');
  });
});

describe('getArchetypeWeights', () => {
  const allArchetypes = ['deep_listener', 'skimmer', 'explorer', 'completer', 'social_learner'];

  for (const archetype of allArchetypes) {
    it(`returns weights summing to 1.0 for ${archetype}`, () => {
      const weights = getArchetypeWeights(archetype);
      const sum = Object.values(weights).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0);
    });
  }

  it('returns default weights for unknown archetype', () => {
    const weights = getArchetypeWeights('unknown');
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0);
    expect(weights.relevance).toBe(0.3);
  });

  it('deep_listener emphasizes relevance', () => {
    const weights = getArchetypeWeights('deep_listener');
    expect(weights.relevance).toBeGreaterThan(weights.novelty);
    expect(weights.relevance).toBeGreaterThan(weights.freshness);
  });

  it('explorer emphasizes novelty', () => {
    const weights = getArchetypeWeights('explorer');
    expect(weights.novelty).toBeGreaterThan(weights.relevance);
  });
});
