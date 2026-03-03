import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockAutoModelConfigUpsert = vi.fn();
const mockAutoModelConfigUpdate = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    autoModelConfig: {
      upsert: (...args: unknown[]) => mockAutoModelConfigUpsert(...args),
      update: (...args: unknown[]) => mockAutoModelConfigUpdate(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@/lib/providers/ai-registry', () => ({
  getAiProviderMeta: (id: string) => {
    if (id === 'anthropic') return { defaultModel: 'claude-haiku-4-5-20251001', models: [{ id: 'claude-haiku-4-5-20251001', tier: 'fast' }, { id: 'claude-sonnet-4-6', tier: 'balanced' }] };
    if (id === 'openai') return { defaultModel: 'gpt-5', models: [{ id: 'gpt-5-mini', tier: 'fast' }, { id: 'gpt-5', tier: 'balanced' }] };
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
    if (id === 'kittentts') return { defaultModel: 'kitten-tts-mini-0.8' };
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

// ---- Import under test ----

import { getAutoModelConfig, setAutoModelConfig, resolveAutoModel, resolveIncludedModels, resolveTtsIncludedModels, resolveSttIncludedModels } from '@/lib/auto-model-config';

// ---- Default row ----

const defaultRow = {
  id: 'singleton',
  freeAiProvider: 'anthropic',
  freeAiModel: 'claude-haiku-4-5-20251001',
  freeTtsProvider: 'kittentts',
  freeTtsModel: 'kitten-tts-mini-0.8',
  freeSttProvider: 'openai',
  freeSttModel: 'whisper-1',
  proAiProvider: 'anthropic',
  proAiModel: 'claude-haiku-4-5-20251001',
  proTtsProvider: 'elevenlabs',
  proTtsModel: 'eleven_v3',
  proSttProvider: 'openai',
  proSttModel: 'whisper-1',
  platformAiProvider: 'anthropic',
  platformAiModel: 'claude-haiku-4-5-20251001',
  freeIncludedModels: null,
  proIncludedModels: null,
  freeIncludedTtsModels: null,
  proIncludedTtsModels: null,
  freeIncludedSttModels: null,
  proIncludedSttModels: null,
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
        aiProvider: 'anthropic',
        aiModel: 'claude-haiku-4-5-20251001',
        ttsProvider: 'kittentts',
        ttsModel: 'kitten-tts-mini-0.8',
        sttProvider: 'openai',
        sttModel: 'whisper-1',
      },
      pro: {
        aiProvider: 'anthropic',
        aiModel: 'claude-haiku-4-5-20251001',
        ttsProvider: 'elevenlabs',
        ttsModel: 'eleven_v3',
        sttProvider: 'openai',
        sttModel: 'whisper-1',
      },
      platform: {
        aiProvider: 'anthropic',
        aiModel: 'claude-haiku-4-5-20251001',
      },
      freeIncludedModels: null,
      proIncludedModels: null,
      freeIncludedTtsModels: null,
      proIncludedTtsModels: null,
      freeIncludedSttModels: null,
      proIncludedSttModels: null,
    });
  });

  it('parses JSON included model arrays from database', async () => {
    mockAutoModelConfigUpsert.mockResolvedValue({
      ...defaultRow,
      freeIncludedModels: ['model-a'],
      proIncludedModels: ['model-a', 'model-b'],
      freeIncludedTtsModels: ['elevenlabs:eleven_v3'],
      proIncludedTtsModels: ['elevenlabs:eleven_v3', 'openai:tts-1-hd'],
      freeIncludedSttModels: ['openai:whisper-1'],
      proIncludedSttModels: ['openai:whisper-1'],
    });

    const result = await getAutoModelConfig();

    expect(result.freeIncludedModels).toEqual(['model-a']);
    expect(result.proIncludedModels).toEqual(['model-a', 'model-b']);
    expect(result.freeIncludedTtsModels).toEqual(['elevenlabs:eleven_v3']);
    expect(result.proIncludedTtsModels).toEqual(['elevenlabs:eleven_v3', 'openai:tts-1-hd']);
    expect(result.freeIncludedSttModels).toEqual(['openai:whisper-1']);
    expect(result.proIncludedSttModels).toEqual(['openai:whisper-1']);
  });

  it('falls back to null for malformed JSON in included models', async () => {
    mockAutoModelConfigUpsert.mockResolvedValue({
      ...defaultRow,
      freeIncludedModels: 'not-an-array',
      proIncludedModels: 123,
      freeIncludedTtsModels: 'bad',
      proIncludedTtsModels: 42,
      freeIncludedSttModels: {},
      proIncludedSttModels: true,
    });

    const result = await getAutoModelConfig();

    expect(result.freeIncludedModels).toBeNull();
    expect(result.proIncludedModels).toBeNull();
    expect(result.freeIncludedTtsModels).toBeNull();
    expect(result.proIncludedTtsModels).toBeNull();
    expect(result.freeIncludedSttModels).toBeNull();
    expect(result.proIncludedSttModels).toBeNull();
  });

  it('calls upsert with singleton id, empty update, and registry-derived seeds', async () => {
    mockAutoModelConfigUpsert.mockResolvedValue(defaultRow);

    await getAutoModelConfig();

    expect(mockAutoModelConfigUpsert).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      update: {},
      create: expect.objectContaining({
        id: 'singleton',
        freeAiProvider: 'anthropic',
        freeAiModel: 'claude-haiku-4-5-20251001',
        platformAiProvider: 'anthropic',
        platformAiModel: 'claude-haiku-4-5-20251001',
      }),
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
        free: { aiProvider: 'anthropic', aiModel: 'claude-haiku-4-5-20251001' },
        pro: { aiProvider: 'anthropic', aiModel: 'claude-haiku-4-5-20251001' },
      },
      'admin-3'
    );

    const call = mockAutoModelConfigUpsert.mock.calls[0][0];
    expect(call.update).toMatchObject({
      updatedBy: 'admin-3',
      freeAiProvider: 'anthropic',
      freeAiModel: 'claude-haiku-4-5-20251001',
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

  it('persists TTS and STT included models when provided', async () => {
    await setAutoModelConfig(
      {
        freeIncludedTtsModels: ['elevenlabs:eleven_v3'],
        proIncludedTtsModels: ['elevenlabs:eleven_v3', 'openai:tts-1-hd'],
        freeIncludedSttModels: ['openai:whisper-1'],
        proIncludedSttModels: ['openai:whisper-1'],
      },
      'admin-1'
    );

    const call = mockAutoModelConfigUpsert.mock.calls[0][0];
    expect(call.update.freeIncludedTtsModels).toEqual(['elevenlabs:eleven_v3']);
    expect(call.update.proIncludedTtsModels).toEqual(['elevenlabs:eleven_v3', 'openai:tts-1-hd']);
    expect(call.update.freeIncludedSttModels).toEqual(['openai:whisper-1']);
    expect(call.update.proIncludedSttModels).toEqual(['openai:whisper-1']);
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

  it('persists null to clear TTS and STT included model overrides', async () => {
    await setAutoModelConfig(
      {
        freeIncludedTtsModels: null,
        proIncludedTtsModels: null,
        freeIncludedSttModels: null,
        proIncludedSttModels: null,
      },
      'admin-1'
    );

    const call = mockAutoModelConfigUpsert.mock.calls[0][0];
    expect(call.update.freeIncludedTtsModels).toBeNull();
    expect(call.update.proIncludedTtsModels).toBeNull();
    expect(call.update.freeIncludedSttModels).toBeNull();
    expect(call.update.proIncludedSttModels).toBeNull();
  });

  it('does not include included model fields when not provided', async () => {
    await setAutoModelConfig({ free: { aiModel: 'gpt-4o-mini' } }, 'admin-1');

    const call = mockAutoModelConfigUpsert.mock.calls[0][0];
    expect(call.update).not.toHaveProperty('freeIncludedModels');
    expect(call.update).not.toHaveProperty('proIncludedModels');
    expect(call.update).not.toHaveProperty('freeIncludedTtsModels');
    expect(call.update).not.toHaveProperty('proIncludedTtsModels');
    expect(call.update).not.toHaveProperty('freeIncludedSttModels');
    expect(call.update).not.toHaveProperty('proIncludedSttModels');
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
      aiProvider: 'anthropic' as const,
      aiModel: 'claude-haiku-4-5-20251001',
      ttsProvider: 'kittentts' as const,
      ttsModel: 'kitten-tts-mini-0.8',
      sttProvider: 'openai' as const,
      sttModel: 'whisper-1',
    },
    pro: {
      aiProvider: 'anthropic' as const,
      aiModel: 'claude-haiku-4-5-20251001',
      ttsProvider: 'elevenlabs' as const,
      ttsModel: 'eleven_v3',
      sttProvider: 'openai' as const,
      sttModel: 'whisper-1',
    },
    platform: { aiProvider: 'anthropic' as const, aiModel: 'claude-haiku-4-5-20251001' },
    freeIncludedModels: null,
    proIncludedModels: null,
    freeIncludedTtsModels: null,
    proIncludedTtsModels: null,
    freeIncludedSttModels: null,
    proIncludedSttModels: null,
  };

  it('derives from auto defaults when lists are null', () => {
    const result = resolveIncludedModels(baseConfig);

    expect(result.freeModels).toEqual(['claude-haiku-4-5-20251001']);
    expect(result.proModels).toContain('claude-haiku-4-5-20251001');
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

describe('resolveTtsIncludedModels', () => {
  const baseConfig: Parameters<typeof resolveTtsIncludedModels>[0] = {
    free: {
      aiProvider: 'anthropic' as const,
      aiModel: 'claude-haiku-4-5-20251001',
      ttsProvider: 'kittentts' as const,
      ttsModel: 'kitten-tts-mini-0.8',
      sttProvider: 'openai' as const,
      sttModel: 'whisper-1',
    },
    pro: {
      aiProvider: 'anthropic' as const,
      aiModel: 'claude-haiku-4-5-20251001',
      ttsProvider: 'elevenlabs' as const,
      ttsModel: 'eleven_v3',
      sttProvider: 'openai' as const,
      sttModel: 'whisper-1',
    },
    platform: { aiProvider: 'anthropic' as const, aiModel: 'claude-haiku-4-5-20251001' },
    freeIncludedModels: null,
    proIncludedModels: null,
    freeIncludedTtsModels: null,
    proIncludedTtsModels: null,
    freeIncludedSttModels: null,
    proIncludedSttModels: null,
  };

  it('derives from auto defaults when lists are null', () => {
    const result = resolveTtsIncludedModels(baseConfig);

    expect(result.freeTtsModels).toEqual(['kittentts:kitten-tts-mini-0.8']);
    expect(result.proTtsModels).toContain('elevenlabs:eleven_v3');
    expect(result.proTtsModels).toContain('kittentts:kitten-tts-mini-0.8');
  });

  it('returns explicit lists when set', () => {
    const result = resolveTtsIncludedModels({
      ...baseConfig,
      freeIncludedTtsModels: ['kittentts:kitten-tts-mini-0.8'],
      proIncludedTtsModels: ['kittentts:kitten-tts-mini-0.8', 'elevenlabs:eleven_v3', 'openai:tts-1-hd'],
    });

    expect(result.freeTtsModels).toEqual(['kittentts:kitten-tts-mini-0.8']);
    expect(result.proTtsModels).toContain('elevenlabs:eleven_v3');
    expect(result.proTtsModels).toContain('openai:tts-1-hd');
  });

  it('always includes free TTS models in pro output', () => {
    const result = resolveTtsIncludedModels({
      ...baseConfig,
      freeIncludedTtsModels: ['kittentts:kitten-tts-mini-0.8'],
      proIncludedTtsModels: ['elevenlabs:eleven_v3'],
    });

    expect(result.proTtsModels).toContain('kittentts:kitten-tts-mini-0.8');
    expect(result.proTtsModels).toContain('elevenlabs:eleven_v3');
  });

  it('deduplicates when free model is already in pro list', () => {
    const result = resolveTtsIncludedModels({
      ...baseConfig,
      freeIncludedTtsModels: ['elevenlabs:eleven_v3'],
      proIncludedTtsModels: ['elevenlabs:eleven_v3', 'openai:tts-1-hd'],
    });

    const count = result.proTtsModels.filter((m) => m === 'elevenlabs:eleven_v3').length;
    expect(count).toBe(1);
  });
});

describe('resolveSttIncludedModels', () => {
  const baseConfig: Parameters<typeof resolveSttIncludedModels>[0] = {
    free: {
      aiProvider: 'anthropic' as const,
      aiModel: 'claude-haiku-4-5-20251001',
      ttsProvider: 'kittentts' as const,
      ttsModel: 'kitten-tts-mini-0.8',
      sttProvider: 'openai' as const,
      sttModel: 'whisper-1',
    },
    pro: {
      aiProvider: 'anthropic' as const,
      aiModel: 'claude-haiku-4-5-20251001',
      ttsProvider: 'elevenlabs' as const,
      ttsModel: 'eleven_v3',
      sttProvider: 'openai' as const,
      sttModel: 'whisper-1',
    },
    platform: { aiProvider: 'anthropic' as const, aiModel: 'claude-haiku-4-5-20251001' },
    freeIncludedModels: null,
    proIncludedModels: null,
    freeIncludedTtsModels: null,
    proIncludedTtsModels: null,
    freeIncludedSttModels: null,
    proIncludedSttModels: null,
  };

  it('derives from auto defaults when lists are null', () => {
    const result = resolveSttIncludedModels(baseConfig);

    expect(result.freeSttModels).toEqual(['openai:whisper-1']);
    expect(result.proSttModels).toContain('openai:whisper-1');
  });

  it('returns explicit lists when set', () => {
    const result = resolveSttIncludedModels({
      ...baseConfig,
      freeIncludedSttModels: ['openai:whisper-1'],
      proIncludedSttModels: ['openai:whisper-1', 'openai:whisper-1'],
    });

    expect(result.freeSttModels).toEqual(['openai:whisper-1']);
    expect(result.proSttModels).toContain('openai:whisper-1');
  });

  it('always includes free STT models in pro output', () => {
    const result = resolveSttIncludedModels({
      ...baseConfig,
      freeIncludedSttModels: ['openai:whisper-1'],
      proIncludedSttModels: ['openai:whisper-1'],
    });

    expect(result.proSttModels).toContain('openai:whisper-1');
    expect(result.proSttModels).toContain('openai:whisper-1');
  });

  it('deduplicates when free model is already in pro list', () => {
    const result = resolveSttIncludedModels({
      ...baseConfig,
      freeIncludedSttModels: ['openai:whisper-1'],
      proIncludedSttModels: ['openai:whisper-1', 'openai:whisper-1'],
    });

    const count = result.proSttModels.filter((m) => m === 'openai:whisper-1').length;
    expect(count).toBe(1);
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
      aiProvider: 'anthropic',
      aiModel: 'claude-haiku-4-5-20251001',
      ttsProvider: 'kittentts',
      ttsModel: 'kitten-tts-mini-0.8',
      sttProvider: 'openai',
      sttModel: 'whisper-1',
    });
  });

  it('returns pro config for PRO plan', async () => {
    const result = await resolveAutoModel('PRO');

    expect(result).toEqual({
      aiProvider: 'anthropic',
      aiModel: 'claude-haiku-4-5-20251001',
      ttsProvider: 'elevenlabs',
      ttsModel: 'eleven_v3',
      sttProvider: 'openai',
      sttModel: 'whisper-1',
    });
  });

  it('returns platform AI config with free TTS/STT for PLATFORM plan', async () => {
    const result = await resolveAutoModel('PLATFORM');

    expect(result).toEqual({
      aiProvider: 'anthropic',
      aiModel: 'claude-haiku-4-5-20251001',
      ttsProvider: 'kittentts',
      ttsModel: 'kitten-tts-mini-0.8',
      sttProvider: 'openai',
      sttModel: 'whisper-1',
    });
  });
});
