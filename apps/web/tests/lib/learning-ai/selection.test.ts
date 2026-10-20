import { describe, expect, it } from 'vitest';
import { selectLearningAi } from '@/lib/learning/ai/selection';
import { getAiProviderMeta } from '@/lib/providers/ai-registry';

describe('learning AI selection', () => {
  const cloudModel = getAiProviderMeta('openai').defaultModel!;
  const saved = { preferredAiProvider: 'openai', preferredAiModel: cloudModel };

  it('uses an explicitly reviewed pending endpoint before a saved cloud preference', () => {
    expect(
      selectLearningAi(
        { provider: 'local', model: 'local:reviewed-model', endpoint: 'https://models.example/v1' },
        saved
      )
    ).toEqual({
      provider: 'local',
      model: 'local:reviewed-model',
      endpoint: 'https://models.example/v1',
    });
  });

  it('uses the saved selection when there is no pending choice', () => {
    expect(selectLearningAi(undefined, saved)).toEqual({ provider: 'openai', model: cloudModel });
  });

  it('rejects a mismatched pending choice instead of selecting another provider', () => {
    expect(() => selectLearningAi({ provider: 'anthropic', model: cloudModel }, saved)).toThrow(
      'does not belong'
    );
  });

  it('defers obsolete or missing preferences to the existing default policy', () => {
    expect(selectLearningAi(undefined, { ...saved, preferredAiProvider: 'anthropic' })).toBeNull();
    expect(selectLearningAi(undefined, null)).toBeNull();
  });
});
