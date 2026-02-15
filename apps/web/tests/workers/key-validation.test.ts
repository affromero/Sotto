import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- Mocks ----

const mockTtsKeyFindMany = vi.fn().mockResolvedValue([]);
const mockTtsKeyUpdate = vi.fn().mockResolvedValue({});
const mockAiKeyFindMany = vi.fn().mockResolvedValue([]);
const mockAiKeyUpdate = vi.fn().mockResolvedValue({});

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userTtsKey: {
      findMany: (...args: unknown[]) => mockTtsKeyFindMany(...args),
      update: (...args: unknown[]) => mockTtsKeyUpdate(...args),
    },
    userAiKey: {
      findMany: (...args: unknown[]) => mockAiKeyFindMany(...args),
      update: (...args: unknown[]) => mockAiKeyUpdate(...args),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockDecryptApiKey = vi.fn((encrypted: string) => `decrypted-${encrypted}`);

vi.mock('@/lib/byok', () => ({
  decryptApiKey: (input: string) => mockDecryptApiKey(input),
}));

const mockValidateProviderCredentials = vi.fn().mockResolvedValue(true);

vi.mock('@/lib/providers/tts-registry', () => ({
  validateProviderCredentials: (...args: unknown[]) => mockValidateProviderCredentials(...args),
}));

const mockValidateAiProviderCredentials = vi.fn().mockResolvedValue(true);

vi.mock('@/lib/providers/ai-registry', () => ({
  validateAiProviderCredentials: (...args: unknown[]) => mockValidateAiProviderCredentials(...args),
}));

const mockNotifQueueAdd = vi.fn().mockResolvedValue({});

vi.mock('@/lib/queue', () => ({
  notificationQueue: { add: (...args: unknown[]) => mockNotifQueueAdd(...args) },
}));

// ---- Import under test ----
import { processKeyValidation } from '@/workers/key-validation.worker';
import type { ValidateKeysPayload } from '@/lib/queue';
import type { Job } from 'bullmq';

// ---- Helpers ----

function createMockJob(): Job<ValidateKeysPayload> {
  return {
    data: {},
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<ValidateKeysPayload>;
}

function makeTtsKey(overrides: Partial<{
  id: string; userId: string; provider: string; encryptedKey: string; extraData: string | null;
}> = {}) {
  return {
    id: overrides.id ?? 'tts-key-1',
    userId: overrides.userId ?? 'user-1',
    provider: overrides.provider ?? 'elevenlabs',
    encryptedKey: overrides.encryptedKey ?? 'enc-tts-key',
    extraData: overrides.extraData ?? null,
  };
}

function makeAiKey(overrides: Partial<{
  id: string; userId: string; provider: string; encryptedKey: string;
}> = {}) {
  return {
    id: overrides.id ?? 'ai-key-1',
    userId: overrides.userId ?? 'user-1',
    provider: overrides.provider ?? 'anthropic',
    encryptedKey: overrides.encryptedKey ?? 'enc-ai-key',
  };
}

// ---- Tests ----

describe('processKeyValidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockTtsKeyFindMany.mockResolvedValue([]);
    mockAiKeyFindMany.mockResolvedValue([]);
    mockValidateProviderCredentials.mockResolvedValue(true);
    mockValidateAiProviderCredentials.mockResolvedValue(true);
    mockDecryptApiKey.mockImplementation((encrypted: string) => `decrypted-${encrypted}`);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does nothing when no keys exist', async () => {
    const job = createMockJob();
    const promise = processKeyValidation(job);
    await vi.runAllTimersAsync();
    await promise;

    expect(mockTtsKeyUpdate).not.toHaveBeenCalled();
    expect(mockAiKeyUpdate).not.toHaveBeenCalled();
    expect(mockNotifQueueAdd).not.toHaveBeenCalled();
  });

  it('keeps valid TTS keys untouched', async () => {
    mockTtsKeyFindMany.mockResolvedValue([makeTtsKey()]);
    mockValidateProviderCredentials.mockResolvedValue(true);

    const job = createMockJob();
    const promise = processKeyValidation(job);
    await vi.runAllTimersAsync();
    await promise;

    expect(mockTtsKeyUpdate).not.toHaveBeenCalled();
    expect(mockNotifQueueAdd).not.toHaveBeenCalled();
  });

  it('invalidates a TTS key that fails validation', async () => {
    mockTtsKeyFindMany.mockResolvedValue([makeTtsKey({ id: 'tts-bad' })]);
    mockValidateProviderCredentials.mockResolvedValue(false);

    const job = createMockJob();
    const promise = processKeyValidation(job);
    await vi.runAllTimersAsync();
    await promise;

    expect(mockTtsKeyUpdate).toHaveBeenCalledWith({
      where: { id: 'tts-bad' },
      data: { isValid: false },
    });
  });

  it('sends KEY_INVALID notification when invalidating a TTS key', async () => {
    mockTtsKeyFindMany.mockResolvedValue([
      makeTtsKey({ userId: 'user-42', provider: 'cartesia' }),
    ]);
    mockValidateProviderCredentials.mockResolvedValue(false);

    const job = createMockJob();
    const promise = processKeyValidation(job);
    await vi.runAllTimersAsync();
    await promise;

    expect(mockNotifQueueAdd).toHaveBeenCalledWith(
      'send_notification',
      expect.objectContaining({
        userId: 'user-42',
        type: 'KEY_INVALID',
        title: 'TTS Key Invalid',
      })
    );
    expect(mockNotifQueueAdd.mock.calls[0][1].message).toContain('cartesia');
  });

  it('keeps valid AI keys untouched', async () => {
    mockAiKeyFindMany.mockResolvedValue([makeAiKey()]);
    mockValidateAiProviderCredentials.mockResolvedValue(true);

    const job = createMockJob();
    const promise = processKeyValidation(job);
    await vi.runAllTimersAsync();
    await promise;

    expect(mockAiKeyUpdate).not.toHaveBeenCalled();
  });

  it('invalidates an AI key that fails validation', async () => {
    mockAiKeyFindMany.mockResolvedValue([makeAiKey({ id: 'ai-bad' })]);
    mockValidateAiProviderCredentials.mockResolvedValue(false);

    const job = createMockJob();
    const promise = processKeyValidation(job);
    await vi.runAllTimersAsync();
    await promise;

    expect(mockAiKeyUpdate).toHaveBeenCalledWith({
      where: { id: 'ai-bad' },
      data: { isValid: false },
    });
  });

  it('sends KEY_INVALID notification when invalidating an AI key', async () => {
    mockAiKeyFindMany.mockResolvedValue([
      makeAiKey({ userId: 'user-99', provider: 'openai' }),
    ]);
    mockValidateAiProviderCredentials.mockResolvedValue(false);

    const job = createMockJob();
    const promise = processKeyValidation(job);
    await vi.runAllTimersAsync();
    await promise;

    expect(mockNotifQueueAdd).toHaveBeenCalledWith(
      'send_notification',
      expect.objectContaining({
        userId: 'user-99',
        type: 'KEY_INVALID',
        title: 'AI Key Invalid',
      })
    );
    expect(mockNotifQueueAdd.mock.calls[0][1].message).toContain('openai');
  });

  it('handles mixed valid and invalid keys across providers', async () => {
    mockTtsKeyFindMany.mockResolvedValue([
      makeTtsKey({ id: 'tts-good', provider: 'elevenlabs' }),
      makeTtsKey({ id: 'tts-bad', provider: 'cartesia' }),
    ]);
    mockAiKeyFindMany.mockResolvedValue([
      makeAiKey({ id: 'ai-good', provider: 'anthropic' }),
      makeAiKey({ id: 'ai-bad', provider: 'openai' }),
    ]);

    // First TTS valid, second invalid; first AI valid, second invalid
    mockValidateProviderCredentials
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    mockValidateAiProviderCredentials
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const job = createMockJob();
    const promise = processKeyValidation(job);
    await vi.runAllTimersAsync();
    await promise;

    expect(mockTtsKeyUpdate).toHaveBeenCalledTimes(1);
    expect(mockTtsKeyUpdate).toHaveBeenCalledWith({
      where: { id: 'tts-bad' },
      data: { isValid: false },
    });
    expect(mockAiKeyUpdate).toHaveBeenCalledTimes(1);
    expect(mockAiKeyUpdate).toHaveBeenCalledWith({
      where: { id: 'ai-bad' },
      data: { isValid: false },
    });
    // 2 notifications: one TTS, one AI
    expect(mockNotifQueueAdd).toHaveBeenCalledTimes(2);
  });

  it('decrypts key before validating TTS provider', async () => {
    mockTtsKeyFindMany.mockResolvedValue([
      makeTtsKey({ encryptedKey: 'sealed-tts-secret' }),
    ]);

    const job = createMockJob();
    const promise = processKeyValidation(job);
    await vi.runAllTimersAsync();
    await promise;

    expect(mockDecryptApiKey).toHaveBeenCalledWith('sealed-tts-secret');
    expect(mockValidateProviderCredentials).toHaveBeenCalledWith(
      'elevenlabs',
      expect.objectContaining({ apiKey: 'decrypted-sealed-tts-secret' })
    );
  });

  it('decrypts key before validating AI provider', async () => {
    mockAiKeyFindMany.mockResolvedValue([
      makeAiKey({ encryptedKey: 'sealed-ai-secret', provider: 'anthropic' }),
    ]);

    const job = createMockJob();
    const promise = processKeyValidation(job);
    await vi.runAllTimersAsync();
    await promise;

    expect(mockDecryptApiKey).toHaveBeenCalledWith('sealed-ai-secret');
    expect(mockValidateAiProviderCredentials).toHaveBeenCalledWith('anthropic', {
      apiKey: 'decrypted-sealed-ai-secret',
    });
  });

  it('passes extraData userId to TTS validation when present', async () => {
    const extraDataEncrypted = 'enc-extra';
    mockDecryptApiKey.mockImplementation((input: string) => {
      if (input === 'enc-extra') return JSON.stringify({ userId: 'el-user-id' });
      return `decrypted-${input}`;
    });

    mockTtsKeyFindMany.mockResolvedValue([
      makeTtsKey({ extraData: extraDataEncrypted }),
    ]);

    const job = createMockJob();
    const promise = processKeyValidation(job);
    await vi.runAllTimersAsync();
    await promise;

    expect(mockValidateProviderCredentials).toHaveBeenCalledWith(
      'elevenlabs',
      expect.objectContaining({ userId: 'el-user-id' })
    );
  });

  it('continues processing when a single key decryption fails', async () => {
    mockTtsKeyFindMany.mockResolvedValue([
      makeTtsKey({ id: 'tts-corrupt', encryptedKey: 'corrupt' }),
      makeTtsKey({ id: 'tts-good', encryptedKey: 'good-key' }),
    ]);
    mockDecryptApiKey
      .mockImplementationOnce(() => { throw new Error('Decryption failed'); })
      .mockImplementation((input: string) => `decrypted-${input}`);
    mockValidateProviderCredentials.mockResolvedValue(true);

    const job = createMockJob();
    const promise = processKeyValidation(job);
    await vi.runAllTimersAsync();
    await promise;

    // First key errored, second was validated normally
    expect(mockValidateProviderCredentials).toHaveBeenCalledTimes(1);
  });

  it('continues processing when provider validation throws', async () => {
    mockAiKeyFindMany.mockResolvedValue([
      makeAiKey({ id: 'ai-error' }),
      makeAiKey({ id: 'ai-ok' }),
    ]);
    mockValidateAiProviderCredentials
      .mockRejectedValueOnce(new Error('Network timeout'))
      .mockResolvedValueOnce(true);

    const job = createMockJob();
    const promise = processKeyValidation(job);
    await vi.runAllTimersAsync();
    await promise;

    // Neither key was invalidated — error means unknown state, not invalid
    expect(mockAiKeyUpdate).not.toHaveBeenCalled();
    // Both were attempted
    expect(mockValidateAiProviderCredentials).toHaveBeenCalledTimes(2);
  });

  it('reports progress during processing', async () => {
    mockTtsKeyFindMany.mockResolvedValue([makeTtsKey()]);
    mockAiKeyFindMany.mockResolvedValue([makeAiKey()]);

    const job = createMockJob();
    const promise = processKeyValidation(job);
    await vi.runAllTimersAsync();
    await promise;

    expect(job.updateProgress).toHaveBeenCalled();
  });

  it('skips extraData when decryption of extra fails', async () => {
    mockDecryptApiKey.mockImplementation((input: string) => {
      if (input === 'bad-extra') throw new Error('Extra decrypt failed');
      return `decrypted-${input}`;
    });
    mockTtsKeyFindMany.mockResolvedValue([
      makeTtsKey({ extraData: 'bad-extra' }),
    ]);

    const job = createMockJob();
    const promise = processKeyValidation(job);
    await vi.runAllTimersAsync();
    await promise;

    // Should still validate, just without userId from extra
    expect(mockValidateProviderCredentials).toHaveBeenCalledWith(
      'elevenlabs',
      { apiKey: 'decrypted-enc-tts-key' }
    );
  });
});
