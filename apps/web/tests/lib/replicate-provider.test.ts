import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/providers/tts-registry', () => ({
  getProviderMeta: vi.fn().mockReturnValue({ defaultModel: 'inworld-tts-1.5-max' }),
  compareQuality: vi.fn(),
}));

vi.mock('@/lib/providers/tts-voices', () => ({
  FAL_VOICE_POOL: [
    { id: 'Vivian', name: 'Vivian', gender: 'female', character: 'warm narrator' },
    { id: 'Dylan', name: 'Dylan', gender: 'male', character: 'confident presenter' },
  ],
  INWORLD_VOICE_POOL: [
    { id: 'Ashley', name: 'Ashley', gender: 'female', character: 'warm narrator' },
    { id: 'Dennis', name: 'Dennis', gender: 'male', character: 'polished professional' },
    { id: 'Alex', name: 'Alex', gender: 'male', character: 'energetic presenter' },
    { id: 'Darlene', name: 'Darlene', gender: 'female', character: 'soothing storyteller' },
  ],
  selectVoicePairFromPool: vi.fn().mockImplementation((pool: Array<{ id: string }>) => {
    // Return first two voices from whichever pool is passed
    return { host: pool[0], expert: pool[1] };
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
  getAutoModelConfig: vi.fn().mockResolvedValue({
    model: {
      aiProvider: 'anthropic',
      aiModel: 'claude-haiku-4-5-20251001',
      ttsProvider: 'openai',
      ttsModel: 'tts-1-hd',
      sttProvider: 'openai',
      sttModel: 'whisper-1',
    },
  }),
}));

vi.mock('@/lib/tts-expression-mapper', () => ({
  mapDirectionToExpression: vi.fn().mockReturnValue({}),
}));

import { ReplicateProvider } from '@/lib/providers/tts/replicate.provider';
import { mapDirectionToExpression } from '@/lib/tts-expression-mapper';

const mockAudioBytes = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);

describe('ReplicateProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(mapDirectionToExpression).mockReturnValue({});
  });

  describe('Inworld models (default)', () => {
    it('uses inworld API endpoint and voice_id field', async () => {
      const fetchMock = vi.fn();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'pred-1',
          status: 'succeeded',
          output: 'https://replicate.delivery/audio.mp3',
          error: null,
        }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => mockAudioBytes.buffer,
      });

      global.fetch = fetchMock;

      const provider = new ReplicateProvider('r8_testtoken');
      const result = await provider.generateSpeech({ text: 'Hello', voiceId: 'Ashley' });

      expect(result).toBeInstanceOf(Buffer);

      const [apiUrl, apiOpts] = fetchMock.mock.calls[0];
      expect(apiUrl).toBe('https://api.replicate.com/v1/models/inworld/tts-1.5-max/predictions');
      expect(apiOpts.headers.Authorization).toBe('Bearer r8_testtoken');
      expect(apiOpts.headers.Prefer).toBe('wait');
      const body = JSON.parse(apiOpts.body);
      expect(body.input.voice_id).toBe('Ashley');
      expect(body.input.audio_format).toBe('mp3');
      expect(body.input.voice).toBeUndefined();
    });

    it('uses inworld-tts-1.5-mini endpoint when specified', async () => {
      const fetchMock = vi.fn();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'pred-mini',
          status: 'succeeded',
          output: 'https://replicate.delivery/audio.mp3',
          error: null,
        }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => mockAudioBytes.buffer,
      });

      global.fetch = fetchMock;

      const provider = new ReplicateProvider('r8_testtoken', 'inworld-tts-1.5-mini');
      await provider.generateSpeech({ text: 'Hello', voiceId: 'Dennis' });

      const [apiUrl] = fetchMock.mock.calls[0];
      expect(apiUrl).toBe('https://api.replicate.com/v1/models/inworld/tts-1.5-mini/predictions');
    });

    it('prepends emotion tag when expression mapper returns one', async () => {
      vi.mocked(mapDirectionToExpression).mockReturnValue({
        replicate: { emotionTag: '[happy]' },
      });

      const fetchMock = vi.fn();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'pred-expr',
          status: 'succeeded',
          output: 'https://replicate.delivery/audio.mp3',
          error: null,
        }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => mockAudioBytes.buffer,
      });

      global.fetch = fetchMock;

      const provider = new ReplicateProvider('r8_testtoken');
      await provider.generateSpeech({
        text: 'Great news!',
        voiceId: 'Ashley',
        direction: 'energetic',
        speaker: 'HOST',
      });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.input.text).toBe('[happy]Great news!');
    });

    it('truncates text to 2000 chars for Inworld models', async () => {
      const fetchMock = vi.fn();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'pred-long',
          status: 'succeeded',
          output: 'https://replicate.delivery/audio.mp3',
          error: null,
        }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => mockAudioBytes.buffer,
      });

      global.fetch = fetchMock;

      const longText = 'A'.repeat(2500);
      const provider = new ReplicateProvider('r8_testtoken');
      await provider.generateSpeech({ text: longText, voiceId: 'Ashley' });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.input.text.length).toBe(2000);
    });

    it('returns Inworld voice IDs for speakers', () => {
      const provider = new ReplicateProvider('r8_testtoken');
      expect(provider.getVoiceId('HOST', 'pod-1')).toBe('Ashley');
      expect(provider.getVoiceId('EXPERT', 'pod-1')).toBe('Dennis');
    });
  });

  describe('Qwen3-TTS model (legacy)', () => {
    it('uses qwen3-tts endpoint and speaker field', async () => {
      const fetchMock = vi.fn();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'pred-qwen',
          status: 'succeeded',
          output: 'https://replicate.delivery/audio.wav',
          error: null,
        }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => mockAudioBytes.buffer,
      });

      global.fetch = fetchMock;

      const provider = new ReplicateProvider('r8_testtoken', 'qwen3-tts');
      await provider.generateSpeech({ text: 'Hello', voiceId: 'Dylan' });

      const [apiUrl] = fetchMock.mock.calls[0];
      expect(apiUrl).toBe('https://api.replicate.com/v1/models/qwen/qwen3-tts/predictions');
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.input.speaker).toBe('Dylan');
      expect(body.input.mode).toBe('custom_voice');
      expect(body.input.language).toBe('auto');
      expect(body.input.voice_id).toBeUndefined();
      expect(body.input.audio_format).toBeUndefined();
    });

    it('returns Qwen3 voice IDs for speakers', () => {
      const provider = new ReplicateProvider('r8_testtoken', 'qwen3-tts');
      expect(provider.getVoiceId('HOST', 'pod-1')).toBe('Vivian');
      expect(provider.getVoiceId('EXPERT', 'pod-1')).toBe('Dylan');
    });
  });

  describe('shared behavior', () => {
    it('polls for result when initial response is processing', async () => {
      const fetchMock = vi.fn();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'pred-2',
          status: 'processing',
          output: null,
          error: null,
        }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'pred-2',
          status: 'processing',
          output: null,
          error: null,
        }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'pred-2',
          status: 'succeeded',
          output: 'https://replicate.delivery/audio.mp3',
          error: null,
        }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => mockAudioBytes.buffer,
      });

      global.fetch = fetchMock;

      const provider = new ReplicateProvider('r8_testtoken');
      const result = await provider.generateSpeech({ text: 'Test', voiceId: 'Ashley' });

      expect(result).toBeInstanceOf(Buffer);
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(fetchMock.mock.calls[1][0]).toBe('https://api.replicate.com/v1/predictions/pred-2');
    });

    it('throws when prediction fails after polling', async () => {
      const fetchMock = vi.fn();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'pred-3',
          status: 'processing',
          output: null,
          error: null,
        }),
      });

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
      await expect(provider.generateSpeech({ text: 'Test', voiceId: 'Ashley' })).rejects.toThrow(
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
      await expect(provider.generateSpeech({ text: 'Test', voiceId: 'Ashley' })).rejects.toThrow(
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
      await expect(provider.generateSpeech({ text: 'Test', voiceId: 'Ashley' })).rejects.toThrow(
        'Replicate returned no audio output'
      );
    });
  });
});
