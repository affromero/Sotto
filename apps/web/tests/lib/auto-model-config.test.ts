import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockAutoModelConfigUpsert = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    autoModelConfig: {
      upsert: (...args: unknown[]) => mockAutoModelConfigUpsert(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

// ---- Import under test ----

import { getAutoModelConfig, setAutoModelConfig, resolveAutoModel, resolveIncludedModels } from '@/lib/auto-model-config';

// ---- Default row ----

const defaultRow = {
  id: 'singleton',
  freeAiProvider: 'groq',
  freeAiModel: 'llama-3.1-8b-instant',
  freeTtsProvider: 'kittentts',
  freeTtsModel: 'kitten-tts-mini-0.8',
  freeSttProvider: 'groq',
  freeSttModel: 'whisper-large-v3-turbo',
  proAiProvider: 'anthropic',
  proAiModel: 'claude-haiku-4-5-20251001',
  proTtsProvider: 'elevenlabs',
  proTtsModel: 'eleven_v3',
  proSttProvider: 'groq',
  proSttModel: 'whisper-large-v3-turbo',
  platformAiProvider: 'anthropic',
  platformAiModel: 'claude-haiku-4-5-20251001',
  freeIncludedModels: null,
  proIncludedModels: null,
  updatedAt: new Date(),
  updatedBy: null,
};

// ---- Tests ----

describe('getAutoModelConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns correct structure with free, pro, and included model fields', async () => {
    mockAutoModelConfigUpsert.mockResolvedValue(defaultRow);

    const result = await getAutoModelConfig();

    expect(result).toEqual({
      free: {
        aiProvider: 'groq',
        aiModel: 'llama-3.1-8b-instant',
        ttsProvider: 'kittentts',
        ttsModel: 'kitten-tts-mini-0.8',
        sttProvider: 'groq',
        sttModel: 'whisper-large-v3-turbo',
      },
      pro: {
        aiProvider: 'anthropic',
        aiModel: 'claude-haiku-4-5-20251001',
        ttsProvider: 'elevenlabs',
        ttsModel: 'eleven_v3',
        sttProvider: 'groq',
        sttModel: 'whisper-large-v3-turbo',
      },
      platform: {
        aiProvider: 'anthropic',
        aiModel: 'claude-haiku-4-5-20251001',
      },
      freeIncludedModels: null,
      proIncludedModels: null,
    });
  });

  it('parses JSON included model arrays from database', async () => {
    mockAutoModelConfigUpsert.mockResolvedValue({
      ...defaultRow,
      freeIncludedModels: ['model-a'],
      proIncludedModels: ['model-a', 'model-b'],
    });

    const result = await getAutoModelConfig();

    expect(result.freeIncludedModels).toEqual(['model-a']);
    expect(result.proIncludedModels).toEqual(['model-a', 'model-b']);
  });

  it('falls back to null for malformed JSON in included models', async () => {
    mockAutoModelConfigUpsert.mockResolvedValue({
      ...defaultRow,
      freeIncludedModels: 'not-an-array',
      proIncludedModels: 123,
    });

    const result = await getAutoModelConfig();

    expect(result.freeIncludedModels).toBeNull();
    expect(result.proIncludedModels).toBeNull();
  });

  it('calls upsert with singleton id and empty update', async () => {
    mockAutoModelConfigUpsert.mockResolvedValue(defaultRow);

    await getAutoModelConfig();

    expect(mockAutoModelConfigUpsert).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      update: {},
      create: { id: 'singleton' },
    });
  });
});

describe('setAutoModelConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAutoModelConfigUpsert.mockResolvedValue(defaultRow);
  });

  it('partial free update writes only provided fields', async () => {
    await setAutoModelConfig({ free: { aiProvider: 'openai', aiModel: 'gpt-4o-mini' } }, 'admin-1');

    expect(mockAutoModelConfigUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          updatedBy: 'admin-1',
          freeAiProvider: 'openai',
          freeAiModel: 'gpt-4o-mini',
        }),
      })
    );
    // Fields not provided are not included
    const call = mockAutoModelConfigUpsert.mock.calls[0][0];
    expect(call.update).not.toHaveProperty('freeTtsProvider');
  });

  it('partial pro update writes only provided fields', async () => {
    await setAutoModelConfig({ pro: { ttsProvider: 'cartesia', ttsModel: 'sonic-2' } }, 'admin-2');

    expect(mockAutoModelConfigUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          updatedBy: 'admin-2',
          proTtsProvider: 'cartesia',
          proTtsModel: 'sonic-2',
        }),
      })
    );
    const call = mockAutoModelConfigUpsert.mock.calls[0][0];
    expect(call.update).not.toHaveProperty('proAiProvider');
  });

  it('can update both free and pro in one call', async () => {
    await setAutoModelConfig(
      {
        free: { aiProvider: 'groq', aiModel: 'llama-3.1-8b-instant' },
        pro: { aiProvider: 'anthropic', aiModel: 'claude-haiku-4-5-20251001' },
      },
      'admin-3'
    );

    const call = mockAutoModelConfigUpsert.mock.calls[0][0];
    expect(call.update).toMatchObject({
      updatedBy: 'admin-3',
      freeAiProvider: 'groq',
      freeAiModel: 'llama-3.1-8b-instant',
      proAiProvider: 'anthropic',
      proAiModel: 'claude-haiku-4-5-20251001',
    });
  });

  it('persists freeIncludedModels and proIncludedModels when provided', async () => {
    await setAutoModelConfig(
      { freeIncludedModels: ['model-a'], proIncludedModels: ['model-a', 'model-b'] },
      'admin-1'
    );

    const call = mockAutoModelConfigUpsert.mock.calls[0][0];
    expect(call.update.freeIncludedModels).toEqual(['model-a']);
    expect(call.update.proIncludedModels).toEqual(['model-a', 'model-b']);
  });

  it('persists null to clear included model overrides', async () => {
    await setAutoModelConfig(
      { freeIncludedModels: null, proIncludedModels: null },
      'admin-1'
    );

    const call = mockAutoModelConfigUpsert.mock.calls[0][0];
    expect(call.update.freeIncludedModels).toBeNull();
    expect(call.update.proIncludedModels).toBeNull();
  });

  it('does not include included model fields when not provided', async () => {
    await setAutoModelConfig({ free: { aiModel: 'gpt-4o-mini' } }, 'admin-1');

    const call = mockAutoModelConfigUpsert.mock.calls[0][0];
    expect(call.update).not.toHaveProperty('freeIncludedModels');
    expect(call.update).not.toHaveProperty('proIncludedModels');
  });

  it('uses singleton id for upsert', async () => {
    await setAutoModelConfig({ free: { aiModel: 'gpt-4o-mini' } }, 'admin-1');

    expect(mockAutoModelConfigUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'singleton' } })
    );
  });
});

describe('resolveIncludedModels', () => {
  const baseConfig: Parameters<typeof resolveIncludedModels>[0] = {
    free: {
      aiProvider: 'groq' as const,
      aiModel: 'llama-3.1-8b-instant',
      ttsProvider: 'kittentts' as const,
      ttsModel: 'kitten-tts-mini-0.8',
      sttProvider: 'groq' as const,
      sttModel: 'whisper-large-v3-turbo',
    },
    pro: {
      aiProvider: 'anthropic' as const,
      aiModel: 'claude-haiku-4-5-20251001',
      ttsProvider: 'elevenlabs' as const,
      ttsModel: 'eleven_v3',
      sttProvider: 'groq' as const,
      sttModel: 'whisper-large-v3-turbo',
    },
    platform: { aiProvider: 'anthropic' as const, aiModel: 'claude-haiku-4-5-20251001' },
    freeIncludedModels: null,
    proIncludedModels: null,
  };

  it('derives from auto defaults when lists are null', () => {
    const result = resolveIncludedModels(baseConfig);

    expect(result.freeModels).toEqual(['llama-3.1-8b-instant']);
    expect(result.proModels).toContain('claude-haiku-4-5-20251001');
    expect(result.proModels).toContain('llama-3.1-8b-instant');
  });

  it('returns explicit lists when set', () => {
    const result = resolveIncludedModels({
      ...baseConfig,
      freeIncludedModels: ['model-a', 'model-b'],
      proIncludedModels: ['model-a', 'model-b', 'model-c'],
    });

    expect(result.freeModels).toEqual(['model-a', 'model-b']);
    expect(result.proModels).toContain('model-a');
    expect(result.proModels).toContain('model-b');
    expect(result.proModels).toContain('model-c');
  });

  it('always includes free models in pro output', () => {
    const result = resolveIncludedModels({
      ...baseConfig,
      freeIncludedModels: ['free-only-model'],
      proIncludedModels: ['pro-model'],
    });

    expect(result.proModels).toContain('free-only-model');
    expect(result.proModels).toContain('pro-model');
  });

  it('deduplicates when free model is already in pro list', () => {
    const result = resolveIncludedModels({
      ...baseConfig,
      freeIncludedModels: ['shared-model'],
      proIncludedModels: ['shared-model', 'pro-model'],
    });

    const sharedCount = result.proModels.filter((m) => m === 'shared-model').length;
    expect(sharedCount).toBe(1);
  });
});

describe('resolveAutoModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAutoModelConfigUpsert.mockResolvedValue(defaultRow);
  });

  it('returns free config for FREE plan', async () => {
    const result = await resolveAutoModel('FREE');

    expect(result).toEqual({
      aiProvider: 'groq',
      aiModel: 'llama-3.1-8b-instant',
      ttsProvider: 'kittentts',
      ttsModel: 'kitten-tts-mini-0.8',
      sttProvider: 'groq',
      sttModel: 'whisper-large-v3-turbo',
    });
  });

  it('returns pro config for PRO plan', async () => {
    const result = await resolveAutoModel('PRO');

    expect(result).toEqual({
      aiProvider: 'anthropic',
      aiModel: 'claude-haiku-4-5-20251001',
      ttsProvider: 'elevenlabs',
      ttsModel: 'eleven_v3',
      sttProvider: 'groq',
      sttModel: 'whisper-large-v3-turbo',
    });
  });

  it('returns platform AI config with free TTS/STT for PLATFORM plan', async () => {
    const result = await resolveAutoModel('PLATFORM');

    expect(result).toEqual({
      aiProvider: 'anthropic',
      aiModel: 'claude-haiku-4-5-20251001',
      ttsProvider: 'kittentts',
      ttsModel: 'kitten-tts-mini-0.8',
      sttProvider: 'groq',
      sttModel: 'whisper-large-v3-turbo',
    });
  });
});
