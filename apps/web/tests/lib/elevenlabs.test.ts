import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Set env BEFORE any imports ----
vi.stubEnv('ELEVENLABS_API_KEY', 'test-api-key');

// ---- Mocks ----

const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Store original env
const originalEnv = process.env;

// ---- Import under test ----
import {
  selectVoicePair,
  getVoiceId,
  getVoiceProfile,
  generateSpeech,
  generateSoundEffect,
  designVoice,
  getVoices,
  cloneVoice,
  deleteClonedVoice,
  getElevenLabsPerKCharRate,
  getOpenAiPerKCharRate,
  VOICE_POOL,
} from '@/lib/elevenlabs';

// ---- Tests ----

describe('elevenlabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env to original state
    process.env = { ...originalEnv };
    process.env.ELEVENLABS_API_KEY = 'test-api-key';
  });

  describe('voice selection', () => {
    it('selects a voice pair with different voices for host and expert', () => {
      const result = selectVoicePair('podcast-123');

      expect(result.host).toBeDefined();
      expect(result.expert).toBeDefined();
      expect(result.host.id).not.toBe(result.expert.id);
    });

    it('returns consistent voice pair for the same podcast ID', () => {
      const result1 = selectVoicePair('podcast-abc');
      const result2 = selectVoicePair('podcast-abc');

      expect(result1.host.id).toBe(result2.host.id);
      expect(result1.expert.id).toBe(result2.expert.id);
    });

    it('returns different voice pairs for different podcast IDs', () => {
      const result1 = selectVoicePair('podcast-001');
      const result2 = selectVoicePair('podcast-002');

      // At least one voice should be different between the two pairs
      const isDifferent =
        result1.host.id !== result2.host.id || result1.expert.id !== result2.expert.id;

      expect(isDifferent).toBe(true);
    });

    it('prefers different genders for host and expert when possible', () => {
      // Test multiple podcast IDs to check gender diversity preference
      const pairs = Array.from({ length: 10 }, (_, i) => selectVoicePair(`podcast-${i}`));

      const differentGenderCount = pairs.filter(
        (pair) => pair.host.gender !== pair.expert.gender
      ).length;

      // Most pairs should have different genders (at least 70%)
      expect(differentGenderCount).toBeGreaterThanOrEqual(7);
    });
  });

  describe('getVoiceId', () => {
    it('returns host voice ID from voice pool when podcast ID is provided', () => {
      const voiceId = getVoiceId('HOST', 'podcast-123');
      const profile = getVoiceProfile(voiceId);

      expect(voiceId).toBeDefined();
      expect(profile).toBeDefined();
    });

    it('returns expert voice ID from voice pool when podcast ID is provided', () => {
      const voiceId = getVoiceId('EXPERT', 'podcast-123');
      const profile = getVoiceProfile(voiceId);

      expect(voiceId).toBeDefined();
      expect(profile).toBeDefined();
    });

    it('returns different voice IDs for HOST and EXPERT with same podcast ID', () => {
      const hostVoiceId = getVoiceId('HOST', 'podcast-abc');
      const expertVoiceId = getVoiceId('EXPERT', 'podcast-abc');

      expect(hostVoiceId).not.toBe(expertVoiceId);
    });

    it('uses env overrides when both HOST and EXPERT voice IDs are set', () => {
      process.env.ELEVENLABS_HOST_VOICE_ID = 'custom-host-id';
      process.env.ELEVENLABS_EXPERT_VOICE_ID = 'custom-expert-id';

      const hostVoiceId = getVoiceId('HOST', 'podcast-123');
      const expertVoiceId = getVoiceId('EXPERT', 'podcast-123');

      expect(hostVoiceId).toBe('custom-host-id');
      expect(expertVoiceId).toBe('custom-expert-id');
    });

    it('returns fallback voices when no podcast ID is provided', () => {
      const hostVoiceId = getVoiceId('HOST');
      const expertVoiceId = getVoiceId('EXPERT');

      expect(hostVoiceId).toBe(VOICE_POOL[0].id);
      expect(expertVoiceId).toBe(VOICE_POOL[8].id);
    });
  });

  describe('getVoiceProfile', () => {
    it('returns voice profile for valid voice ID', () => {
      const firstVoice = VOICE_POOL[0];
      const profile = getVoiceProfile(firstVoice.id);

      expect(profile).toEqual(firstVoice);
    });

    it('returns undefined for unknown voice ID', () => {
      const profile = getVoiceProfile('unknown-voice-id');

      expect(profile).toBeUndefined();
    });

    it('returns profile with all expected properties', () => {
      const profile = getVoiceProfile(VOICE_POOL[0].id);

      expect(profile).toHaveProperty('id');
      expect(profile).toHaveProperty('name');
      expect(profile).toHaveProperty('gender');
      expect(profile).toHaveProperty('accent');
      expect(profile).toHaveProperty('ageRange');
      expect(profile).toHaveProperty('character');
    });
  });

  describe('generateSpeech', () => {
    it('calls ElevenLabs TTS API with correct parameters', async () => {
      const mockAudioBuffer = Buffer.from('audio data');

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => mockAudioBuffer.buffer,
      });

      const result = await generateSpeech({
        text: 'Hello world',
        voiceId: 'voice-123',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/text-to-speech/voice-123',
        {
          method: 'POST',
          headers: {
            'xi-api-key': 'test-api-key',
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
          },
          body: JSON.stringify({
            text: 'Hello world',
            model_id: 'eleven_multilingual_v2',
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              style: 0.3,
              use_speaker_boost: true,
            },
          }),
        }
      );
      expect(result).toBeInstanceOf(Buffer);
    });

    it('uses custom voice settings when provided', async () => {
      const mockAudioBuffer = Buffer.from('audio data');

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => mockAudioBuffer.buffer,
      });

      await generateSpeech({
        text: 'Custom settings test',
        voiceId: 'voice-456',
        modelId: 'eleven_turbo_v2',
        stability: 0.7,
        similarityBoost: 0.8,
        style: 0.5,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            text: 'Custom settings test',
            model_id: 'eleven_turbo_v2',
            voice_settings: {
              stability: 0.7,
              similarity_boost: 0.8,
              style: 0.5,
              use_speaker_boost: true,
            },
          }),
        })
      );
    });

    it('throws error when API key is not configured', async () => {
      delete process.env.ELEVENLABS_API_KEY;

      await expect(
        generateSpeech({
          text: 'Test',
          voiceId: 'voice-123',
        })
      ).rejects.toThrow('ElevenLabs API key not configured — set ELEVENLABS_API_KEY');
    });

    it('throws error with API error message on failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'Rate limit exceeded',
      });

      await expect(
        generateSpeech({
          text: 'Test',
          voiceId: 'voice-123',
        })
      ).rejects.toThrow('ElevenLabs API error (429): Rate limit exceeded');
    });
  });

  describe('generateSoundEffect', () => {
    it('calls ElevenLabs sound effects API with correct parameters', async () => {
      const mockAudioBuffer = Buffer.from('sound effect data');

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => mockAudioBuffer.buffer,
      });

      const result = await generateSoundEffect({
        prompt: 'gentle rain falling',
      });

      expect(mockFetch).toHaveBeenCalledWith('https://api.elevenlabs.io/v1/sound-generation', {
        method: 'POST',
        headers: {
          'xi-api-key': 'test-api-key',
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text: 'gentle rain falling',
        }),
      });
      expect(result).toBeInstanceOf(Buffer);
    });

    it('includes duration when provided (max 30 seconds)', async () => {
      const mockAudioBuffer = Buffer.from('sound effect data');

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => mockAudioBuffer.buffer,
      });

      await generateSoundEffect({
        prompt: 'ocean waves',
        durationSeconds: 15,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            text: 'ocean waves',
            duration_seconds: 15,
          }),
        })
      );
    });

    it('caps duration at 30 seconds', async () => {
      const mockAudioBuffer = Buffer.from('sound effect data');

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => mockAudioBuffer.buffer,
      });

      await generateSoundEffect({
        prompt: 'long ambient sound',
        durationSeconds: 60,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            text: 'long ambient sound',
            duration_seconds: 30,
          }),
        })
      );
    });

    it('throws error when API returns error status', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Invalid prompt',
      });

      await expect(
        generateSoundEffect({
          prompt: 'invalid',
        })
      ).rejects.toThrow('ElevenLabs Sound Effects API error (400): Invalid prompt');
    });
  });

  describe('designVoice', () => {
    it('creates a new voice from description', async () => {
      const mockAudioBuffer = Buffer.from('preview audio');

      mockFetch.mockResolvedValue({
        ok: true,
        headers: {
          get: (name: string) => (name === 'generated_voice_id' ? 'new-voice-id-123' : null),
        },
        arrayBuffer: async () => mockAudioBuffer.buffer,
      });

      const result = await designVoice({
        description: 'A warm, friendly female voice with a slight British accent',
        sampleText: 'Hello, welcome to the podcast',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/voice-generation/generate-voice',
        {
          method: 'POST',
          headers: {
            'xi-api-key': 'test-api-key',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            voice_description: 'A warm, friendly female voice with a slight British accent',
            text: 'Hello, welcome to the podcast',
          }),
        }
      );
      expect(result.voiceId).toBe('new-voice-id-123');
      expect(result.audioPreview).toBeInstanceOf(Buffer);
    });

    it('throws error on API failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'Insufficient credits',
      });

      await expect(
        designVoice({
          description: 'Test voice',
          sampleText: 'Test',
        })
      ).rejects.toThrow('ElevenLabs Voice Design API error (403): Insufficient credits');
    });
  });

  describe('getVoices', () => {
    it('fetches voice library from API', async () => {
      const mockVoices = [
        { voice_id: 'v1', name: 'Voice One', category: 'premade' },
        { voice_id: 'v2', name: 'Voice Two', category: 'cloned' },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ voices: mockVoices }),
      });

      const result = await getVoices();

      expect(mockFetch).toHaveBeenCalledWith('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': 'test-api-key' },
      });
      expect(result).toEqual(mockVoices);
    });

    it('throws error when API key is missing', async () => {
      delete process.env.ELEVENLABS_API_KEY;

      await expect(getVoices()).rejects.toThrow('ElevenLabs API key not configured');
    });

    it('throws error on API failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
      });

      await expect(getVoices()).rejects.toThrow('ElevenLabs API error (401)');
    });
  });

  describe('cloneVoice', () => {
    it('clones voice from audio samples', async () => {
      const audioFiles = [Buffer.from('audio sample 1'), Buffer.from('audio sample 2')];

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ voice_id: 'cloned-voice-123' }),
      });

      const result = await cloneVoice('My Custom Voice', audioFiles, 'Test voice');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/voices/add',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'xi-api-key': 'test-api-key',
          },
        })
      );
      expect(result.voiceId).toBe('cloned-voice-123');
    });

    it('throws error when API key is missing', async () => {
      delete process.env.ELEVENLABS_API_KEY;

      await expect(cloneVoice('Test', [Buffer.from('audio')], 'desc')).rejects.toThrow(
        'ElevenLabs API key not configured — set ELEVENLABS_API_KEY'
      );
    });

    it('throws error on cloning failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Audio quality too low',
      });

      await expect(cloneVoice('Test', [Buffer.from('audio')])).rejects.toThrow(
        'ElevenLabs Voice Cloning error (400): Audio quality too low'
      );
    });
  });

  describe('deleteClonedVoice', () => {
    it('deletes a cloned voice by ID', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
      });

      await deleteClonedVoice('voice-to-delete');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/voices/voice-to-delete',
        {
          method: 'DELETE',
          headers: { 'xi-api-key': 'test-api-key' },
        }
      );
    });

    it('throws error when API key is missing', async () => {
      delete process.env.ELEVENLABS_API_KEY;

      await expect(deleteClonedVoice('voice-123')).rejects.toThrow(
        'ElevenLabs API key not configured'
      );
    });

    it('throws error on deletion failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Voice not found',
      });

      await expect(deleteClonedVoice('nonexistent-voice')).rejects.toThrow(
        'ElevenLabs voice deletion error (404): Voice not found'
      );
    });
  });

  describe('cost tracking', () => {
    it('returns correct ElevenLabs rate for scale tier (default)', () => {
      const rate = getElevenLabsPerKCharRate();
      expect(rate).toBe(0.17);
    });

    it('returns correct ElevenLabs rate for free tier', () => {
      process.env.ELEVENLABS_TIER = 'free';
      const rate = getElevenLabsPerKCharRate();
      expect(rate).toBe(0.0);
    });

    it('returns correct ElevenLabs rate for starter tier', () => {
      process.env.ELEVENLABS_TIER = 'starter';
      const rate = getElevenLabsPerKCharRate();
      expect(rate).toBe(0.3);
    });

    it('returns correct ElevenLabs rate for creator tier', () => {
      process.env.ELEVENLABS_TIER = 'creator';
      const rate = getElevenLabsPerKCharRate();
      expect(rate).toBe(0.24);
    });

    it('returns default rate for unknown tier', () => {
      process.env.ELEVENLABS_TIER = 'unknown-tier';
      const rate = getElevenLabsPerKCharRate();
      expect(rate).toBe(0.17);
    });

    it('returns correct OpenAI TTS rate', () => {
      const rate = getOpenAiPerKCharRate();
      expect(rate).toBe(0.015);
    });
  });

  describe('voice pool diversity', () => {
    it('ensures voice pool contains multiple genders', () => {
      const maleVoices = VOICE_POOL.filter((v) => v.gender === 'male');
      const femaleVoices = VOICE_POOL.filter((v) => v.gender === 'female');

      expect(maleVoices.length).toBeGreaterThan(0);
      expect(femaleVoices.length).toBeGreaterThan(0);
    });

    it('ensures voice pool contains multiple accents', () => {
      const accents = new Set(VOICE_POOL.map((v) => v.accent));

      expect(accents.size).toBeGreaterThanOrEqual(3);
    });

    it('ensures voice pool contains multiple age ranges', () => {
      const ageRanges = new Set(VOICE_POOL.map((v) => v.ageRange));

      expect(ageRanges.size).toBeGreaterThanOrEqual(2);
    });

    it('ensures every voice has required metadata', () => {
      VOICE_POOL.forEach((voice) => {
        expect(voice.id).toBeTruthy();
        expect(voice.name).toBeTruthy();
        expect(voice.gender).toBeTruthy();
        expect(voice.accent).toBeTruthy();
        expect(voice.ageRange).toBeTruthy();
        expect(voice.character).toBeTruthy();
      });
    });
  });
});
