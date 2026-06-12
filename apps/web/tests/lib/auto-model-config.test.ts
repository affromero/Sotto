import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAutoModelConfigFindUnique = vi.fn();
const mockAutoModelConfigCreate = vi.fn();
const mockAutoModelConfigUpdate = vi.fn();
const mockAutoModelConfigUpsert = vi.fn();

vi.mock('@/lib/prisma', () => {
  const mockPrisma = {
    autoModelConfig: {
      findUnique: (...args: unknown[]) => mockAutoModelConfigFindUnique(...args),
      create: (...args: unknown[]) => mockAutoModelConfigCreate(...args),
      update: (...args: unknown[]) => mockAutoModelConfigUpdate(...args),
      upsert: (...args: unknown[]) => mockAutoModelConfigUpsert(...args),
    },
  };
  return { prisma: mockPrisma, prismaUnfiltered: mockPrisma };
});

vi.mock('@/lib/providers/ai-registry', () => ({
  getAiProviderMeta: (id: string) => {
    if (id === 'anthropic') {
      return {
        defaultModel: 'claude-sonnet-4-6',
        models: [
          { id: 'claude-haiku-4-5-20251001', tier: 'fast' },
          { id: 'claude-sonnet-4-6', tier: 'balanced' },
        ],
      };
    }
    if (id === 'openai') {
      return {
        defaultModel: 'gpt-5',
        models: [
          { id: 'gpt-5-mini', tier: 'fast' },
          { id: 'gpt-5', tier: 'balanced' },
        ],
      };
    }
    return { defaultModel: '', models: [] };
  },
  getProviderForModel: (id: string) => {
    if (id.startsWith('claude')) return 'anthropic';
    if (id.startsWith('gpt')) return 'openai';
    return null;
  },
}));

vi.mock('@/lib/providers/tts-registry', () => ({
  getProviderMeta: (id: string) => {
    if (id === 'openai') return { defaultModel: 'tts-1-hd' };
    if (id === 'elevenlabs') return { defaultModel: 'eleven_v3' };
    return { defaultModel: '' };
  },
}));

vi.mock('@/lib/providers/stt-registry', () => ({
  getSttProviderMeta: (id: string) => {
    if (id === 'openai') return { defaultModel: 'whisper-1' };
    return { defaultModel: '' };
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  getAutoModelConfig,
  resolveIncludedModels,
  resolveSttIncludedModels,
  resolveTtsIncludedModels,
  setAutoModelConfig,
  type AutoModelConfigData,
} from '@/lib/auto-model-config';

const row = {
  id: 'singleton',
  aiProvider: 'anthropic',
  aiModel: 'claude-sonnet-4-6',
  ttsProvider: 'openai',
  ttsModel: 'tts-1-hd',
  sttProvider: 'openai',
  sttModel: 'whisper-1',
  platformAiProvider: 'anthropic',
  platformAiModel: 'claude-sonnet-4-6',
  includedModels: null,
  includedTtsModels: null,
  includedSttModels: null,
  updatedAt: new Date(),
  updatedBy: null,
};

const config: AutoModelConfigData = {
  model: {
    aiProvider: 'anthropic',
    aiModel: 'claude-sonnet-4-6',
    ttsProvider: 'openai',
    ttsModel: 'tts-1-hd',
    sttProvider: 'openai',
    sttModel: 'whisper-1',
  },
  platform: {
    aiProvider: 'anthropic',
    aiModel: 'claude-sonnet-4-6',
  },
  includedModels: null,
  includedTtsModels: null,
  includedSttModels: null,
};

describe('getAutoModelConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the unified config shape', async () => {
    mockAutoModelConfigFindUnique.mockResolvedValue(row);

    await expect(getAutoModelConfig()).resolves.toEqual(config);
  });

  it('parses included model arrays from database rows', async () => {
    mockAutoModelConfigFindUnique.mockResolvedValue({
      ...row,
      includedModels: ['claude-sonnet-4-6', 'gpt-5'],
      includedTtsModels: ['openai:tts-1-hd'],
      includedSttModels: ['openai:whisper-1'],
    });

    const result = await getAutoModelConfig();

    expect(result.includedModels).toEqual(['claude-sonnet-4-6', 'gpt-5']);
    expect(result.includedTtsModels).toEqual(['openai:tts-1-hd']);
    expect(result.includedSttModels).toEqual(['openai:whisper-1']);
  });

  it('creates the singleton with unified seed fields when missing', async () => {
    mockAutoModelConfigFindUnique.mockResolvedValueOnce(null);
    mockAutoModelConfigCreate.mockResolvedValueOnce(row);

    await getAutoModelConfig();

    expect(mockAutoModelConfigCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'singleton',
        aiProvider: 'anthropic',
        aiModel: 'claude-sonnet-4-6',
        ttsProvider: 'openai',
        ttsModel: 'tts-1-hd',
      }),
    });
  });
});

describe('setAutoModelConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAutoModelConfigUpsert.mockResolvedValue(row);
  });

  it('maps default model updates to unified database fields', async () => {
    await setAutoModelConfig(
      {
        model: { aiProvider: 'openai', aiModel: 'gpt-5', ttsProvider: 'elevenlabs' },
        includedModels: ['gpt-5'],
      },
      'admin-1',
    );

    const call = mockAutoModelConfigUpsert.mock.calls[0][0];
    expect(call.update).toMatchObject({
      updatedBy: 'admin-1',
      aiProvider: 'openai',
      aiModel: 'gpt-5',
      ttsProvider: 'elevenlabs',
      includedModels: ['gpt-5'],
    });
  });

  it('persists included lists for each model category', async () => {
    await setAutoModelConfig(
      {
        includedModels: ['claude-sonnet-4-6'],
        includedTtsModels: ['openai:tts-1-hd'],
        includedSttModels: ['openai:whisper-1'],
      },
      'admin-2',
    );

    const call = mockAutoModelConfigUpsert.mock.calls[0][0];
    expect(call.update).toMatchObject({
      includedModels: ['claude-sonnet-4-6'],
      includedTtsModels: ['openai:tts-1-hd'],
      includedSttModels: ['openai:whisper-1'],
    });
  });
});

describe('included model resolvers', () => {
  it('derive from unified defaults when lists are null', () => {
    expect(resolveIncludedModels(config)).toEqual(['claude-sonnet-4-6']);
    expect(resolveTtsIncludedModels(config)).toEqual(['openai:tts-1-hd']);
    expect(resolveSttIncludedModels(config)).toEqual(['openai:whisper-1']);
  });

  it('return explicit unified lists when configured', () => {
    expect(resolveIncludedModels({ ...config, includedModels: ['gpt-5'] })).toEqual(['gpt-5']);
    expect(resolveTtsIncludedModels({ ...config, includedTtsModels: ['elevenlabs:eleven_v3'] })).toEqual([
      'elevenlabs:eleven_v3',
    ]);
    expect(resolveSttIncludedModels({ ...config, includedSttModels: ['openai:gpt-4o-transcribe'] })).toEqual([
      'openai:gpt-4o-transcribe',
    ]);
  });
});
