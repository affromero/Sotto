import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/providers/tts-registry', () => ({
  getProviderMeta: vi.fn().mockReturnValue({ defaultModel: 'qwen3-tts' }),
  compareQuality: vi.fn(),
}));

vi.mock('@/lib/providers/tts-voices', () => ({
  FAL_VOICE_POOL: [
    { id: 'Vivian', name: 'Vivian', gender: 'female', character: 'warm narrator' },
    { id: 'Dylan', name: 'Dylan', gender: 'male', character: 'confident presenter' },
  ],
  selectVoicePairFromPool: vi.fn().mockReturnValue({
    host: { id: 'Vivian' },
    expert: { id: 'Dylan' },
  }),
}));

vi.mock('@/lib/voice-pool', () => ({
  VOICE_POOL: [],
  selectVoicePair: vi.fn(),
  resolveVoiceId: vi.fn(),
  findByVoiceId: vi.fn(),
  scoreToneMatch: vi.fn().mockReturnValue(0),
}));

vi.mock('@/lib/byok', () => ({
  getByokKey: vi.fn(),
  getByokExtraData: vi.fn(),
  listByokProviders: vi.fn().mockResolvedValue([]),
  hasByokKey: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/lib/auto-model-config', () => ({
  getAutoModelConfig: vi.fn().mockResolvedValue({ free: { ttsProvider: 'openai', ttsModel: 'tts-1-hd' }, dailyGenerationLimit: 3, dailyVideoLimit: 1, dailyVideoLimitPro: 2, aiAllocations: [], ttsAllocations: [] }),
  resolveAutoModel: vi.fn().mockResolvedValue({
    aiProvider: 'anthropic',
    aiModel: 'claude-haiku-4-5-20251001',
    ttsProvider: 'kittentts',
    ttsModel: 'kitten-tts-mini-0.8',
    sttProvider: 'openai',
    sttModel: 'whisper-1',
  }),
}));

import { ReplicateProvider } from '@/lib/providers/tts/replicate.provider';

const mockAudioBytes = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);

describe('ReplicateProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it('generates speech in sync mode (Prefer: wait)', async () => {
    const fetchMock = vi.fn();

    // First call: prediction API (sync, returns succeeded)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'pred-1',
        status: 'succeeded',
        output: 'https://replicate.delivery/audio.wav',
        error: null,
      }),
    });

    // Second call: download audio
    fetchMock.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => mockAudioBytes.buffer,
    });

    global.fetch = fetchMock;

    const provider = new ReplicateProvider('r8_testtoken');
    const result = await provider.generateSpeech({ text: 'Hello', voiceId: 'Dylan' });

    expect(result).toBeInstanceOf(Buffer);

    // Verify API call structure
    const [apiUrl, apiOpts] = fetchMock.mock.calls[0];
    expect(apiUrl).toBe('https://api.replicate.com/v1/models/qwen/qwen3-tts/predictions');
    expect(apiOpts.headers.Authorization).toBe('Bearer r8_testtoken');
    expect(apiOpts.headers.Prefer).toBe('wait');
    const body = JSON.parse(apiOpts.body);
    expect(body.input.text).toBe('Hello');
    expect(body.input.voice).toBe('Dylan');
  });

  it('polls for result when initial response is processing', async () => {
    const fetchMock = vi.fn();

    // First call: prediction API (returns processing)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'pred-2',
        status: 'processing',
        output: null,
        error: null,
      }),
    });

    // Second call: poll (still processing)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'pred-2',
        status: 'processing',
        output: null,
        error: null,
      }),
    });

    // Third call: poll (succeeded)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'pred-2',
        status: 'succeeded',
        output: 'https://replicate.delivery/audio.wav',
        error: null,
      }),
    });

    // Fourth call: download audio
    fetchMock.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => mockAudioBytes.buffer,
    });

    global.fetch = fetchMock;

    const provider = new ReplicateProvider('r8_testtoken');
    const result = await provider.generateSpeech({ text: 'Test', voiceId: 'Vivian' });

    expect(result).toBeInstanceOf(Buffer);
    // Should have polled twice then downloaded
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // Verify poll URL
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.replicate.com/v1/predictions/pred-2');
  });

  it('throws when prediction fails after polling', async () => {
    const fetchMock = vi.fn();

    // First call: prediction API (returns processing)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'pred-3',
        status: 'processing',
        output: null,
        error: null,
      }),
    });

    // Second call: poll (returns failed)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'pred-3',
        status: 'failed',
        output: null,
        error: 'Model crashed',
      }),
    });

    global.fetch = fetchMock;

    const provider = new ReplicateProvider('r8_testtoken');
    await expect(provider.generateSpeech({ text: 'Test', voiceId: 'Dylan' })).rejects.toThrow(
      'Replicate prediction failed: Model crashed'
    );
  });

  it('throws on API error', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Invalid token',
    });

    const provider = new ReplicateProvider('bad_token');
    await expect(provider.generateSpeech({ text: 'Test', voiceId: 'Dylan' })).rejects.toThrow(
      'Replicate API error (401): Invalid token'
    );
  });

  it('throws when no audio output URL', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'pred-4',
        status: 'succeeded',
        output: null,
        error: null,
      }),
    });

    const provider = new ReplicateProvider('r8_testtoken');
    await expect(provider.generateSpeech({ text: 'Test', voiceId: 'Vivian' })).rejects.toThrow(
      'Replicate returned no audio output'
    );
  });

  it('returns correct voice IDs for speakers', () => {
    const provider = new ReplicateProvider('r8_testtoken');
    expect(provider.getVoiceId('HOST', 'pod-1')).toBe('Vivian');
    expect(provider.getVoiceId('EXPERT', 'pod-1')).toBe('Dylan');
  });

});
