import { describe, expect, it } from 'vitest';
import { playRoundViewSchema, playVisibleTexts } from '../../src';

const common = {
  order: 0,
  learner: 'HOST',
  targetLang: 'de',
  supportLang: 'en',
  level: 'A1',
  prompt: 'English game instructions',
  guidance: 'A language tip',
  phase: 'EXCHANGE',
  role: 'LEARNER',
  instruction: 'Use your target language',
  revealed: false,
  allowedActions: ['MESSAGE', 'HINT', 'SKIP'],
  hints: [{ seat: 'GUEST', text: 'zusammen' }],
  result: null,
};

describe('language selections from personalized rounds', () => {
  it('offers only projected language, excluding mission instructions and objectives', () => {
    const round = playRoundViewSchema.parse({
      ...common,
      mode: 'MISSION',
      ownObjective: 'Make a dinner plan',
      otherObjective: null,
      messages: [{ seat: 'HOST', text: 'Kochen wir zusammen?' }],
      remainingMessages: 5,
      twist: null,
      ownOutcome: null,
      otherOutcome: null,
    });
    expect(playVisibleTexts(round)).toEqual(['zusammen', 'Kochen wir zusammen?']);
  });

  it('omits hidden word cards and accepts the visible clue for a guessing partner', () => {
    const round = playRoundViewSchema.parse({
      ...common,
      mode: 'DESCRIBE',
      phase: 'GUESS',
      role: 'PARTNER',
      allowedActions: ['GUESS', 'SKIP'],
      targetSuggestions: null,
      target: null,
      clue: 'Es wächst am Baum.',
      guess: null,
    });
    expect(playVisibleTexts(round)).toEqual(['zusammen', 'Es wächst am Baum.']);
  });
});
