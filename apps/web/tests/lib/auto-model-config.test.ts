import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/providers/ai-registry', () => ({
  getAiProviderMeta: (id: string) => {
    if (id === 'anthropic')
      return {
        defaultModel: 'claude-sonnet-4-6',
        models: [
          { id: 'claude-haiku-4-5-20251001', tier: 'fast' },
          { id: 'claude-sonnet-4-6', tier: 'balanced' },
        ],
      };
    if (id === 'openai')
      return {
        defaultModel: 'gpt-5',
        models: [
          { id: 'gpt-5-mini', tier: 'fast' },
          { id: 'gpt-5', tier: 'balanced' },
        ],
      };
    return { defaultModel: '', models: [] };
  },
  getProviderForModel: (id: string) => {
    if (id.startsWith('claude')) return 'anthropic';
    if (id.startsWith('gpt')) return 'openai';
    return null;
  },
}));

vi.mock('@/lib/providers/tts-registry', () => ({
  getProviderMeta: (id: string) =>
    id === 'openai'
      ? { defaultModel: 'tts-1-hd', models: [{ id: 'tts-1-hd' }, { id: 'tts-1' }] }
      : { defaultModel: '', models: [] },
}));

vi.mock('@/lib/providers/stt-registry', () => ({
  getSttProviderMeta: (id: string) =>
    id === 'openai'
      ? {
          defaultModel: 'whisper-1',
          models: [{ id: 'whisper-1' }, { id: 'gpt-4o-transcribe' }],
        }
      : { defaultModel: '', models: [] },
}));

import {
  assertModelProviderPairs,
  defaultAutoModelConfig,
  resolveIncludedModels,
  resolveSttIncludedModels,
  resolveTtsIncludedModels,
  type AutoModelConfigData,
} from '@/lib/auto-model-config';

const config: AutoModelConfigData = {
  model: {
    aiProvider: 'anthropic',
    aiModel: 'claude-sonnet-4-6',
    ttsProvider: 'openai',
    ttsModel: 'tts-1-hd',
    sttProvider: 'openai',
    sttModel: 'whisper-1',
  },
  platform: { aiProvider: 'anthropic', aiModel: 'claude-sonnet-4-6' },
  includedModels: null,
  includedTtsModels: null,
  includedSttModels: null,
};

describe('automatic model configuration', () => {
  it('builds canonical defaults from provider catalogs', () => {
    expect(defaultAutoModelConfig()).toEqual(config);
  });

  it('rejects models that do not belong to the selected provider', () => {
    expect(() =>
      assertModelProviderPairs({ model: { aiProvider: 'anthropic', aiModel: 'gpt-5' } })
    ).toThrow(/does not belong to provider "anthropic"/);
    expect(() =>
      assertModelProviderPairs({ model: { sttProvider: 'openai', sttModel: 'unknown' } })
    ).toThrow(/is not a model of provider "openai"/);
  });

  it('derives included models from defaults when lists are unset', () => {
    expect(resolveIncludedModels(config)).toEqual(['claude-sonnet-4-6']);
    expect(resolveTtsIncludedModels(config)).toEqual(['openai:tts-1-hd']);
    expect(resolveSttIncludedModels(config)).toEqual(['openai:whisper-1']);
  });

  it('returns explicit included model lists', () => {
    expect(resolveIncludedModels({ ...config, includedModels: ['gpt-5'] })).toEqual(['gpt-5']);
    expect(resolveTtsIncludedModels({ ...config, includedTtsModels: ['openai:tts-1'] })).toEqual([
      'openai:tts-1',
    ]);
    expect(
      resolveSttIncludedModels({ ...config, includedSttModels: ['openai:gpt-4o-transcribe'] })
    ).toEqual(['openai:gpt-4o-transcribe']);
  });
});
