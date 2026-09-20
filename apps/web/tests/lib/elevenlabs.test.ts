import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createProviderTransport } from 'thesidedoor-core/providers/transport';
import { VOICE_POOL } from '@/lib/voice-pool';

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
import { generateSpeech, generateSoundEffect, getOpenAiPerKCharRate } from '@/lib/elevenlabs';

function speechExecution() {
  return {
    apiKey: process.env.ELEVENLABS_API_KEY ?? '',
    transport: { authenticatedFetch: mockFetch },
  };
}

// ---- Tests ----

describe('elevenlabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env to original state
    process.env = { ...originalEnv };
    process.env.ELEVENLABS_API_KEY = 'test-api-key';
  });

  describe('generateSpeech', () => {
    it('calls ElevenLabs TTS API and returns audio with requestId', async () => {
      const mockAudioBuffer = Buffer.from('audio data');

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => mockAudioBuffer.buffer,
        headers: { get: (name: string) => (name === 'request-id' ? 'req-abc123' : null) },
      });

      const result = await generateSpeech({
        ...speechExecution(),
        text: 'Hello world',
        voiceId: 'voice-123',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/text-to-speech/voice-123'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'xi-api-key': 'test-api-key',
          }),
        }),
        expect.objectContaining({ onDispatch: expect.any(Function) })
      );

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body).toMatchObject({
        text: 'Hello world',
      });

      expect(result.audio).toBeInstanceOf(Buffer);
      expect(result.requestId).toBe('req-abc123');
    });

    it('uses custom voice settings when provided', async () => {
      const mockAudioBuffer = Buffer.from('audio data');

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => mockAudioBuffer.buffer,
        headers: { get: () => null },
      });

      await generateSpeech({
        ...speechExecution(),
        text: 'Custom settings test',
        voiceId: 'voice-456',
        modelId: 'eleven_turbo_v2',
        stability: 0.7,
        similarityBoost: 0.8,
        style: 0.5,
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body).toMatchObject({
        text: 'Custom settings test',
        model_id: 'eleven_turbo_v2',
        voice_settings: expect.objectContaining({
          stability: 0.7,
          similarity_boost: 0.8,
          style: 0.5,
        }),
      });
    });

    it('includes output_format query parameter in URL', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => Buffer.from('audio').buffer,
        headers: { get: () => null },
      });

      await generateSpeech({ ...speechExecution(), text: 'Test', voiceId: 'voice-123' });

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('output_format=mp3_44100_192');
    });

    it('includes use_speaker_boost: true in request body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => Buffer.from('audio').buffer,
        headers: { get: () => null },
      });

      await generateSpeech({ ...speechExecution(), text: 'Test', voiceId: 'voice-123' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.voice_settings.use_speaker_boost).toBe(true);
    });

    it('passes previous_text and next_text for non-v3 models', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => Buffer.from('audio').buffer,
        headers: { get: () => null },
      });

      await generateSpeech({
        ...speechExecution(),
        text: 'Current segment',
        voiceId: 'voice-123',
        modelId: 'eleven_turbo_v2',
        previousText: 'Previous segment text',
        nextText: 'Next segment text',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.previous_text).toBe('Previous segment text');
      expect(body.next_text).toBe('Next segment text');
      expect(body).not.toHaveProperty('previous_request_ids');
    });

    it('skips all continuity params for eleven_v3 (no text context, no request IDs)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => Buffer.from('audio').buffer,
        headers: { get: (name: string) => (name === 'request-id' ? 'req-1' : null) },
      });

      await generateSpeech({
        ...speechExecution(),
        text: 'Current segment',
        voiceId: 'voice-123',
        modelId: 'eleven_v3',
        previousText: 'Previous segment text',
        nextText: 'Next segment text',
        previousRequestIds: ['req-prev-1', 'req-prev-2'],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).not.toHaveProperty('previous_text');
      expect(body).not.toHaveProperty('next_text');
      expect(body).not.toHaveProperty('previous_request_ids');
    });

    it('passes previous_text and next_text for eleven_v3 variants (not in blocklist)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => Buffer.from('audio').buffer,
        headers: { get: () => null },
      });

      await generateSpeech({
        ...speechExecution(),
        text: 'Current segment',
        voiceId: 'voice-123',
        modelId: 'eleven_v3_flash',
        previousText: 'Previous segment text',
        nextText: 'Next segment text',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.previous_text).toBe('Previous segment text');
      expect(body.next_text).toBe('Next segment text');
    });

    it('omits previous_text and next_text when not provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => Buffer.from('audio').buffer,
        headers: { get: () => null },
      });

      await generateSpeech({ ...speechExecution(), text: 'Test', voiceId: 'voice-123' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).not.toHaveProperty('previous_text');
      expect(body).not.toHaveProperty('next_text');
    });

    it('throws error when API key is not configured', async () => {
      delete process.env.ELEVENLABS_API_KEY;

      await expect(
        generateSpeech({ ...speechExecution(), text: 'Test', voiceId: 'voice-123' })
      ).rejects.toThrow('No ElevenLabs credential is saved');
    });

    it('throws error with API error message on failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'Rate limit exceeded',
      });

      await expect(
        generateSpeech({ ...speechExecution(), text: 'Test', voiceId: 'voice-123' })
      ).rejects.toThrow(/ElevenLabs.*429/);
    });
  });

  describe('generateSoundEffect', () => {
    it.each([200, 400, 401, 402, 403, 404, 422, 429, 202, 408, 409, 500, 503])(
      'records only a proven terminal response for HTTP %s',
      async (status) => {
        const audio = Buffer.from('ID3sound effect data');
        const response = new Response(status === 200 ? audio : 'Request did not produce audio', {
          status,
        });
        let settled = false;
        const transport = createProviderTransport({
          rules: [{ method: 'POST', url: 'https://api.elevenlabs.io/v1/sound-generation' }],
          admit: async () => {},
          implementation: async () => response,
        });
        const result = generateSoundEffect({
          prompt: 'rain',
          apiKey: 'captured-key',
          transport,
          onSettled: () => {
            settled = true;
          },
        });
        if (status === 200) await expect(result).resolves.toEqual(audio);
        else await expect(result).rejects.toThrow();
        expect(settled).toBe([200, 400, 401, 402, 403, 404, 422, 429].includes(status));
        expect(response.body?.locked).toBe(false);
      }
    );
    it('does not record a rejection as settled when its response body is truncated', async () => {
      const response = new Response(
        new ReadableStream({
          start(stream) {
            stream.error(new Error('Truncated rejection'));
          },
        }),
        { status: 401 }
      );
      let settled = false;
      const transport = createProviderTransport({
        rules: [{ method: 'POST', url: 'https://api.elevenlabs.io/v1/sound-generation' }],
        admit: async () => {},
        implementation: async () => response,
      });
      await expect(
        generateSoundEffect({
          prompt: 'rain',
          apiKey: 'captured-key',
          transport,
          onSettled: () => {
            settled = true;
          },
        })
      ).rejects.toThrow();
      expect(settled).toBe(false);
    });
    it('calls ElevenLabs sound effects API with correct parameters', async () => {
      const mockAudioBuffer = Buffer.from('ID3sound effect data');

      mockFetch.mockResolvedValue(new Response(mockAudioBuffer));

      const result = await generateSoundEffect({
        ...speechExecution(),
        prompt: 'gentle rain falling',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/sound-generation'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'xi-api-key': 'test-api-key',
          }),
        }),
        undefined
      );

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body).toMatchObject({
        text: 'gentle rain falling',
      });

      expect(result).toEqual(mockAudioBuffer);
    });

    it('includes duration when provided (max 30 seconds)', async () => {
      const mockAudioBuffer = Buffer.from('ID3sound effect data');

      mockFetch.mockResolvedValue(new Response(mockAudioBuffer));

      await generateSoundEffect({
        ...speechExecution(),
        prompt: 'ocean waves',
        durationSeconds: 15,
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body).toMatchObject(expect.objectContaining({ duration_seconds: 15 }));
    });

    it('caps duration at 30 seconds', async () => {
      const mockAudioBuffer = Buffer.from('ID3sound effect data');

      mockFetch.mockResolvedValue(new Response(mockAudioBuffer));

      await generateSoundEffect({
        ...speechExecution(),
        prompt: 'long ambient sound',
        durationSeconds: 60,
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body).toMatchObject(expect.objectContaining({ duration_seconds: 30 }));
    });

    it('throws error when API returns error status', async () => {
      mockFetch.mockResolvedValue(new Response('Invalid prompt', { status: 400 }));

      await expect(
        generateSoundEffect({
          ...speechExecution(),
          prompt: 'invalid',
        })
      ).rejects.toThrow(/ElevenLabs.*400/);
    });
    it('rejects revoked authority before reporting transport invocation', async () => {
      const rejected = new Error('Authority revoked');
      let dispatched = false;
      const transport = createProviderTransport({
        rules: [{ method: 'POST', url: 'https://api.elevenlabs.io/v1/sound-generation' }],
        admit: async () => {
          throw rejected;
        },
        implementation: async () => {
          throw new Error('Unauthorized HTTP request');
        },
      });
      await expect(
        generateSoundEffect({
          prompt: 'rain',
          apiKey: 'captured-key',
          transport,
          onDispatch: () => {
            dispatched = true;
          },
        })
      ).rejects.toBe(rejected);
      expect(dispatched).toBe(false);
    });
    it('awaits response-body cancellation after a dispatched sound request', async () => {
      const controller = new AbortController();
      const reason = new Error('Generation stopped');
      let dispatched = false;
      let canceled = false;
      const response = new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(new Uint8Array([1]));
          },
          pull() {
            controller.abort(reason);
          },
          async cancel() {
            await Promise.resolve();
            canceled = true;
          },
        })
      );
      const transport = createProviderTransport({
        rules: [{ method: 'POST', url: 'https://api.elevenlabs.io/v1/sound-generation' }],
        admit: async () => {},
        implementation: async () => response,
      });
      await expect(
        generateSoundEffect({
          prompt: 'rain',
          apiKey: 'captured-key',
          transport,
          signal: controller.signal,
          onDispatch: () => {
            dispatched = true;
          },
        })
      ).rejects.toBe(reason);
      expect(dispatched).toBe(true);
      expect(canceled).toBe(true);
      expect(response.body?.locked).toBe(false);
    });
  });

  describe('cost tracking', () => {
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
        expect(voice.ids.elevenlabs).toBeDefined();
        expect(voice.name).toBeDefined();
        expect(voice.gender).toBeDefined();
        expect(voice.accent).toBeDefined();
        expect(voice.ageRange).toBeDefined();
        expect(voice.character).toBeDefined();
      });
    });
  });
});
