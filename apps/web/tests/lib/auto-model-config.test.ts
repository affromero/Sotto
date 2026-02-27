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

import { getAutoModelConfig, setAutoModelConfig, resolveAutoModel } from '@/lib/auto-model-config';

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
  updatedAt: new Date(),
  updatedBy: null,
};

// ---- Tests ----

describe('getAutoModelConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns correct structure with free and pro configs', async () => {
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
    });
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

  it('uses singleton id for upsert', async () => {
    await setAutoModelConfig({ free: { aiModel: 'gpt-4o-mini' } }, 'admin-1');

    expect(mockAutoModelConfigUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'singleton' } })
    );
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
});
