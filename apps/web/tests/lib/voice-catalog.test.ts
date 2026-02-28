import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();

vi.mock('@/lib/redis', () => ({
  cache: {
    get: (...args: unknown[]) => mockCacheGet(...args),
    set: (...args: unknown[]) => mockCacheSet(...args),
  },
  getRedisClient: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Must import after mocks
import { getVoiceCatalog } from '@/lib/voice-catalog';

describe('getVoiceCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCacheGet.mockResolvedValue(null);
    mockCacheSet.mockResolvedValue(undefined);
  });

  describe('fixed-set providers', () => {
    it('returns static OpenAI voices', async () => {
      const catalog = await getVoiceCatalog('openai');

      expect(catalog.length).toBe(11);
      expect(catalog[0]).toMatchObject({ id: 'alloy', name: 'Alloy' });
      expect(catalog.find((v) => v.id === 'nova')).toBeDefined();
    });

    it('returns static Fal voices', async () => {
      const catalog = await getVoiceCatalog('fal');

      expect(catalog.length).toBe(9);
      expect(catalog[0]).toMatchObject({ id: 'Vivian', name: 'Vivian' });
    });

    it('returns same voices for replicate as fal', async () => {
      const fal = await getVoiceCatalog('fal');
      const replicate = await getVoiceCatalog('replicate');

      expect(fal).toEqual(replicate);
    });

    it('returns static KittenTTS voices', async () => {
      const catalog = await getVoiceCatalog('kittentts');

      expect(catalog.length).toBe(8);
      expect(catalog.map((v) => v.id)).toContain('bella');
      expect(catalog.map((v) => v.id)).toContain('hugo');
    });
  });

  describe('dynamic providers — Redis cache hit', () => {
    it('returns cached ElevenLabs catalog without API call', async () => {
      const cached = [{ id: 'v1', name: 'Voice 1', gender: 'female' }];
      mockCacheGet.mockResolvedValue(cached);

      const catalog = await getVoiceCatalog('elevenlabs', 'test-key');

      expect(catalog).toEqual(cached);
      expect(mockCacheGet).toHaveBeenCalledWith('tts:voicecatalog:elevenlabs');
    });

    it('returns cached Cartesia catalog without API call', async () => {
      const cached = [{ id: 'c1', name: 'Cartesia Voice' }];
      mockCacheGet.mockResolvedValue(cached);

      const catalog = await getVoiceCatalog('cartesia', 'test-key');

      expect(catalog).toEqual(cached);
      expect(mockCacheGet).toHaveBeenCalledWith('tts:voicecatalog:cartesia');
    });

    it('returns cached Hume catalog without API call', async () => {
      const cached = [{ id: 'h1', name: 'Hume Voice' }];
      mockCacheGet.mockResolvedValue(cached);

      const catalog = await getVoiceCatalog('hume', 'test-key');

      expect(catalog).toEqual(cached);
      expect(mockCacheGet).toHaveBeenCalledWith('tts:voicecatalog:hume');
    });
  });

  describe('dynamic providers — API fetch', () => {
    it('fetches ElevenLabs voices and caches result', async () => {
      const apiVoices = {
        voices: [
          {
            voice_id: 'el-1',
            name: 'Test Voice',
            category: 'premade',
            labels: { gender: 'female', age: 'young', accent: 'american', description: 'warm' },
          },
          {
            voice_id: 'el-2',
            name: 'Clone Voice',
            category: 'cloned',
            labels: { gender: 'male' },
          },
        ],
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(apiVoices),
      } as Response);

      const catalog = await getVoiceCatalog('elevenlabs', 'test-key');

      // Should filter out cloned voices
      expect(catalog.length).toBe(1);
      expect(catalog[0]).toMatchObject({
        id: 'el-1',
        name: 'Test Voice',
        gender: 'female',
        age: 'young',
        accent: 'american',
      });
      expect(mockCacheSet).toHaveBeenCalledWith('tts:voicecatalog:elevenlabs', catalog, 86400);

      vi.restoreAllMocks();
    });

    it('falls back to static pool on ElevenLabs API failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      const catalog = await getVoiceCatalog('elevenlabs', 'test-key');

      // Should return static VOICE_POOL mapped to ElevenLabs IDs
      expect(catalog.length).toBe(16);
      expect(catalog[0]).toMatchObject({ name: 'Adam' });

      vi.restoreAllMocks();
    });

    it('falls back to static pool when no API key for ElevenLabs', async () => {
      // Temporarily clear env
      const original = process.env.ELEVENLABS_API_KEY;
      delete process.env.ELEVENLABS_API_KEY;

      const catalog = await getVoiceCatalog('elevenlabs');

      expect(catalog.length).toBe(16);
      expect(catalog[0]).toMatchObject({ name: 'Adam' });

      process.env.ELEVENLABS_API_KEY = original;
    });

    it('fetches Cartesia voices and caches result', async () => {
      const apiVoices = [
        { id: 'cart-1', name: 'Cartesia Voice', gender: 'male', description: 'warm' },
      ];

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(apiVoices),
      } as Response);

      const catalog = await getVoiceCatalog('cartesia', 'test-key');

      expect(catalog.length).toBe(1);
      expect(catalog[0]).toMatchObject({ id: 'cart-1', name: 'Cartesia Voice' });
      expect(mockCacheSet).toHaveBeenCalledWith('tts:voicecatalog:cartesia', catalog, 86400);

      vi.restoreAllMocks();
    });

    it('falls back to static pool on Cartesia API failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));

      const catalog = await getVoiceCatalog('cartesia', 'test-key');

      expect(catalog.length).toBe(16); // CARTESIA_VOICE_POOL has 16 voices
      expect(catalog[0]).toMatchObject({ name: 'Clyde' });

      vi.restoreAllMocks();
    });
  });
});
