import { describe, expect, it } from 'vitest';
import { learningAiSetupSelection, selectLearningAi } from '@/lib/learning/ai/selection';
import { getAiProviderMeta } from '@/lib/providers/ai-registry';

describe('learning AI selection', () => {
  const cloudModel = getAiProviderMeta('openai').defaultModel!;
  const saved = { preferredAiProvider: 'openai', preferredAiModel: cloudModel };

  it('captures setup endpoints only for complete local selections', () => {
    const configuration = { aiBaseUrl: 'https://setup.example/v1' };
    expect(learningAiSetupSelection(undefined, configuration)).toBeUndefined();
    expect(learningAiSetupSelection({ aiProvider: 'local' }, configuration)).toBeUndefined();
    expect(
      learningAiSetupSelection({ aiProvider: 'openai', aiModel: cloudModel }, configuration)
    ).toEqual({ provider: 'openai', model: cloudModel });
    expect(
      learningAiSetupSelection({ aiProvider: 'local', aiModel: 'local:seminar' }, configuration)
    ).toEqual({ provider: 'local', model: 'local:seminar', endpoint: configuration.aiBaseUrl });
  });

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
