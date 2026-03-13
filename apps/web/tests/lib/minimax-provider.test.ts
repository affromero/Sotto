import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/providers/tts-registry', () => ({
  getProviderMeta: vi.fn(),
  compareQuality: vi.fn(),
}));

vi.mock('@/lib/providers/tts-voices', () => ({
  MINIMAX_VOICE_POOL: [
    { id: 'Deep_Voice_Man', name: 'Deep Voice Man', gender: 'male', character: 'authoritative expert' },
    { id: 'Wise_Woman', name: 'Wise Woman', gender: 'female', character: 'warm narrator' },
  ],
  selectVoicePairFromPool: vi.fn().mockReturnValue({
    host: { id: 'Deep_Voice_Man' },
    expert: { id: 'Wise_Woman' },
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
  getAutoModelConfig: vi.fn().mockResolvedValue({ free: { ttsProvider: 'openai', ttsModel: 'tts-1-hd' }, dailyGenerationLimit: 3, dailyGenerationLimitPro: 5, dailyVideoLimit: 1, dailyVideoLimitPro: 2, dailyAvatarLimit: 1, dailyAvatarLimitPro: 1, aiAllocations: [], ttsAllocations: [] }),
  resolveAutoModel: vi.fn().mockResolvedValue({
    aiProvider: 'anthropic',
    aiModel: 'claude-haiku-4-5-20251001',
    ttsProvider: 'kittentts',
    ttsModel: 'kitten-tts-mini-0.8',
    sttProvider: 'openai',
    sttModel: 'whisper-1',
  }),
}));

vi.mock('@/lib/tts-expression-mapper', () => ({
  mapDirectionToExpression: vi.fn().mockReturnValue({}),
  convertInlineAudioTags: vi.fn().mockImplementation((text: string) => text),
}));

import { MinimaxProvider } from '@/lib/providers/tts/minimax.provider';

const mockAudioBytes = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);

function mockFetchResponses(apiResponse: unknown, audioBytes: Uint8Array = mockAudioBytes) {
  const fetchMock = vi.fn();

  // First call: MiniMax API via Fal
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

describe('MinimaxProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('generates speech successfully', async () => {
    const fetchMock = mockFetchResponses({
      audio: { url: 'https://fal.run/output/audio.mp3', content_type: 'audio/mpeg', file_name: 'audio.mp3', file_size: 1024 },
    });

    const provider = new MinimaxProvider('fal_sk_test');
    const result = await provider.generateSpeech({ text: 'Hello world', voiceId: 'Deep_Voice_Man' });

    expect(result).toBeInstanceOf(Buffer);

    // Verify API call
    const [apiUrl, apiOpts] = fetchMock.mock.calls[0];
    expect(apiUrl).toBe('https://fal.run/fal-ai/minimax/speech-02-hd');
    expect(apiOpts.headers.Authorization).toBe('Key fal_sk_test');
    const body = JSON.parse(apiOpts.body);
    expect(body.voice_id).toBe('Deep_Voice_Man');
    expect(body.text).toBe('Hello world');
    expect(body.sample_rate).toBe(32000);
    expect(body.format).toBe('mp3');
  });

  it('throws on API error', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    const provider = new MinimaxProvider('bad_key');
    await expect(provider.generateSpeech({ text: 'Test', voiceId: 'Deep_Voice_Man' })).rejects.toThrow(
      'MiniMax API error (401): Unauthorized'
    );
  });

  it('throws when no audio URL in response', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ audio: {} }),
    });

    const provider = new MinimaxProvider('fal_sk_test');
    await expect(provider.generateSpeech({ text: 'Test', voiceId: 'Deep_Voice_Man' })).rejects.toThrow(
      'MiniMax returned no audio URL'
    );
  });

  it('returns correct voice IDs for HOST/EXPERT speakers', () => {
    const provider = new MinimaxProvider('fal_sk_test');
    expect(provider.getVoiceId('HOST', 'pod-1')).toBe('Deep_Voice_Man');
    expect(provider.getVoiceId('EXPERT', 'pod-1')).toBe('Wise_Woman');
  });

  it('uses correct FAL endpoint URL for speech-02-hd model', async () => {
    const fetchMock = mockFetchResponses({
      audio: { url: 'https://fal.run/output/audio.mp3', content_type: 'audio/mpeg', file_name: 'audio.mp3', file_size: 1024 },
    });

    const provider = new MinimaxProvider('fal_sk_test', 'speech-02-hd');
    await provider.generateSpeech({ text: 'Test', voiceId: 'Deep_Voice_Man' });

    expect(fetchMock.mock.calls[0][0]).toBe('https://fal.run/fal-ai/minimax/speech-02-hd');
  });

  it('uses correct FAL endpoint URL for speech-02-turbo model', async () => {
    const fetchMock = mockFetchResponses({
      audio: { url: 'https://fal.run/output/audio.mp3', content_type: 'audio/mpeg', file_name: 'audio.mp3', file_size: 1024 },
    });

    const provider = new MinimaxProvider('fal_sk_test', 'speech-02-turbo');
    await provider.generateSpeech({ text: 'Test', voiceId: 'Deep_Voice_Man' });

    expect(fetchMock.mock.calls[0][0]).toBe('https://fal.run/fal-ai/minimax/speech-02-turbo');
  });
});
