import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/providers/tts-registry', () => ({
  getProviderMeta: vi.fn().mockReturnValue({ defaultModel: 'qwen3-tts-1.7b' }),
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
  getAutoModelConfig: vi.fn().mockResolvedValue({ free: { ttsProvider: 'openai', ttsModel: 'tts-1-hd' }, dailyGenerationLimit: 3, dailyGenerationLimitPro: 5, dailyVideoLimit: 1, dailyVideoLimitPro: 2, aiAllocations: [], ttsAllocations: [] }),
  resolveAutoModel: vi.fn().mockResolvedValue({
    aiProvider: 'anthropic',
    aiModel: 'claude-haiku-4-5-20251001',
    ttsProvider: 'kittentts',
    ttsModel: 'kitten-tts-mini-0.8',
    sttProvider: 'openai',
    sttModel: 'whisper-1',
  }),
}));

import { FalProvider } from '@/lib/providers/tts/fal.provider';

const mockAudioBytes = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);

function mockFetchResponses(apiResponse: unknown, audioBytes: Uint8Array = mockAudioBytes) {
  const fetchMock = vi.fn();

  // First call: Fal API
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => apiResponse,
  });

  // Second call: audio download
  fetchMock.mockResolvedValueOnce({
    ok: true,
    arrayBuffer: async () => audioBytes.buffer,
  });

  global.fetch = fetchMock;
  return fetchMock;
}

describe('FalProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('generates speech with a built-in voice', async () => {
    const fetchMock = mockFetchResponses({
      audio: { url: 'https://fal.run/output/audio.wav', duration: 2.5, sample_rate: 24000 },
    });

    const provider = new FalProvider('fal_sk_test');
    const result = await provider.generateSpeech({ text: 'Hello world', voiceId: 'Vivian' });

    expect(result).toBeInstanceOf(Buffer);

    // Verify API call
    const [apiUrl, apiOpts] = fetchMock.mock.calls[0];
    expect(apiUrl).toBe('https://fal.run/fal-ai/qwen-3-tts/text-to-speech/1.7b');
    expect(apiOpts.headers.Authorization).toBe('Key fal_sk_test');
    const body = JSON.parse(apiOpts.body);
    expect(body.voice).toBe('Vivian');
    expect(body.text).toBe('Hello world');
    expect(body.speaker_voice_embedding_file_url).toBeUndefined();
  });

  it('uses speaker_voice_embedding_file_url for cloned voices', async () => {
    const embeddingUrl = 'https://fal.run/embeddings/clone.safetensors';
    const fetchMock = mockFetchResponses({
      audio: { url: 'https://fal.run/output/audio.wav', duration: 1.0, sample_rate: 24000 },
    });

    const provider = new FalProvider('fal_sk_test');
    await provider.generateSpeech({ text: 'Test', voiceId: embeddingUrl });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.speaker_voice_embedding_file_url).toBe(embeddingUrl);
    expect(body.voice).toBeUndefined();
  });

  it('uses the 0.6b model endpoint when configured', async () => {
    const fetchMock = mockFetchResponses({
      audio: { url: 'https://fal.run/output/audio.wav', duration: 1.0, sample_rate: 24000 },
    });

    const provider = new FalProvider('fal_sk_test', 'qwen3-tts-0.6b');
    await provider.generateSpeech({ text: 'Test', voiceId: 'Dylan' });

    expect(fetchMock.mock.calls[0][0]).toBe('https://fal.run/fal-ai/qwen-3-tts/text-to-speech/0.6b');
  });

  it('throws on API error', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    const provider = new FalProvider('bad_key');
    await expect(provider.generateSpeech({ text: 'Test', voiceId: 'Vivian' })).rejects.toThrow(
      'Fal API error (401): Unauthorized'
    );
  });

  it('throws when no audio URL in response', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ audio: {} }),
    });

    const provider = new FalProvider('fal_sk_test');
    await expect(provider.generateSpeech({ text: 'Test', voiceId: 'Vivian' })).rejects.toThrow(
      'Fal returned no audio URL'
    );
  });

  it('returns correct voice IDs for speakers', () => {
    const provider = new FalProvider('fal_sk_test');
    expect(provider.getVoiceId('HOST', 'pod-1')).toBe('Vivian');
    expect(provider.getVoiceId('EXPERT', 'pod-1')).toBe('Dylan');
  });

});
