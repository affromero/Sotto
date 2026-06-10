import { describe, expect, it } from 'vitest';
import { classifyArchetype } from '@/lib/private-recommendations';

describe('private recommendation utilities', () => {
  it('classifies interactive listeners without social archetypes', () => {
    expect(
      classifyArchetype({
        avgCompletionRate: 75,
        avgSpeed: 1,
        sessions: [
          { seekCount: 0, interruptCount: 2 },
          { seekCount: 0, interruptCount: 3 },
        ],
      })
    ).toBe('active_learner');
  });

  it('classifies high-completion low-speed listeners as deep_listener', () => {
    expect(
      classifyArchetype({ avgCompletionRate: 95, avgSpeed: 1, sessions: [] })
    ).toBe('deep_listener');
  });
});
