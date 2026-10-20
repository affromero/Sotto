import { describe, expect, it } from 'vitest';
import {
  vocabularySupportGuidance,
  vocabularySupportSchema,
} from '../../src/learning/vocabulary-support';

describe('learner vocabulary support', () => {
  it.each([
    ['MEANING_RECALL', 'native-language glosses'],
    ['WORD_RECALL', 'gradually reduce cues'],
    ['LISTENING_RECOGNITION', 'already enabled'],
  ] as const)('guides %s without treating self-report as assessed ability', (choice, guidance) => {
    const context = vocabularySupportGuidance(vocabularySupportSchema.parse(choice));
    expect(context).toContain(guidance);
    expect(context).toContain('Assessment results determine mastery');
    expect(context).toContain('does not establish ability or change answer keys');
  });

  it('leaves unspecified support empty and rejects unsupported categories', () => {
    expect(vocabularySupportGuidance(null)).toBe('');
    expect(vocabularySupportSchema.safeParse('VISUAL_LEARNER').success).toBe(false);
  });

  it('keeps listening support within the selected speech configuration', () => {
    expect(vocabularySupportGuidance('LISTENING_RECOGNITION')).toContain(
      'does not enable or require speech'
    );
  });
});
