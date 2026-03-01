import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoisted mock factories (run before vi.mock() calls) ───────────────────────

const mockRequireAdmin = vi.hoisted(() => vi.fn());
const mockGenerateResponse = vi.hoisted(() => vi.fn());
const mockCreateAIProvider = vi.hoisted(() => vi.fn(() => ({ generateResponse: mockGenerateResponse, streamResponse: vi.fn() })));
const mockGenerateSpeech = vi.hoisted(() => vi.fn());
const mockCreateTtsProviderAsync = vi.hoisted(() =>
  vi.fn(async () => ({
    generateSpeech: mockGenerateSpeech,
    getVoiceId: vi.fn(() => 'test-voice'),
    getModelId: vi.fn(() => 'test-model'),
    providerId: 'elevenlabs',
  }))
);
const mockTranscribe = vi.hoisted(() => vi.fn());
const mockCreateSttProvider = vi.hoisted(() => vi.fn(() => ({ transcribe: mockTranscribe })));
const mockGetAiKey = vi.hoisted(() => vi.fn());
const mockGetByokKey = vi.hoisted(() => vi.fn());
const mockGetByokExtraData = vi.hoisted(() => vi.fn());

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/auth-guards', () => ({ requireAdmin: mockRequireAdmin }));
vi.mock('@/lib/providers/ai', () => ({ createAIProvider: mockCreateAIProvider }));
vi.mock('@/lib/providers/tts', () => ({ createTtsProviderAsync: mockCreateTtsProviderAsync }));
vi.mock('@/lib/providers/stt', () => ({ createSttProvider: mockCreateSttProvider }));
vi.mock('@/lib/byok', () => ({
  getAiKey: mockGetAiKey,
  getByokKey: mockGetByokKey,
  getByokExtraData: mockGetByokExtraData,
}));

vi.mock('@/lib/providers/tts-voices', () => ({
  CARTESIA_VOICE_POOL: [{ id: 'cartesia-test-voice', name: 'Barbershop Man', gender: 'male', character: 'warm' }],
  HUME_VOICE_POOL: [{ id: 'ITO', name: 'Ito', gender: 'female', character: 'warm' }],
  FAL_VOICE_POOL: [{ id: 'Vivian', name: 'Vivian', gender: 'female', character: 'warm' }],
  MINIMAX_VOICE_POOL: [{ id: 'Deep_Voice_Man', name: 'Deep Voice Man', gender: 'male', character: 'authoritative expert' }],
}));

import { POST } from '@/app/api/admin/test-model/route';

// ── Helpers ───────────────────────────────────────────────────────────────────

function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/test-model', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/test-model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdmin.mockResolvedValue('admin-1');
    mockGetAiKey.mockResolvedValue(null);
    mockGetByokKey.mockResolvedValue(null);
    mockGetByokExtraData.mockResolvedValue(null);
    // Clear provider env vars so tests start from a known state
    vi.stubEnv('ELEVENLABS_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('CARTESIA_API_KEY', '');
    vi.stubEnv('HUME_API_KEY', '');
    vi.stubEnv('FAL_KEY', '');
    vi.stubEnv('REPLICATE_API_TOKEN', '');
    vi.stubEnv('KITTENTTS_URL', '');
    vi.stubEnv('GROQ_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ── Auth ────────────────────────────────────────────────────────────────────

  it('returns 403 when not admin', async () => {
    mockRequireAdmin.mockResolvedValue(null);
    const res = await POST(createRequest({ type: 'ai', provider: 'anthropic', model: 'claude-haiku-4-5-20251001' }));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe('Forbidden');
  });

  // ── Input validation ────────────────────────────────────────────────────────

  it('returns 400 for an invalid type', async () => {
    const res = await POST(createRequest({ type: 'invalid', provider: 'anthropic', model: 'claude' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when provider is missing', async () => {
    const res = await POST(createRequest({ type: 'ai', model: 'claude' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when model is missing', async () => {
    const res = await POST(createRequest({ type: 'ai', provider: 'anthropic' }));
    expect(res.status).toBe(400);
  });

  // ── AI testing ──────────────────────────────────────────────────────────────

  describe('AI', () => {
    it('returns success with the completion text', async () => {
      mockGenerateResponse.mockResolvedValue({
        content: 'Hello',
        inputTokens: 5,
        outputTokens: 1,
        model: 'claude-haiku-4-5-20251001',
      });

      const res = await POST(createRequest({ type: 'ai', provider: 'anthropic', model: 'claude-haiku-4-5-20251001' }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.response).toBe('Hello');
      expect(typeof body.latencyMs).toBe('number');
    });

    it('truncates AI response to 60 characters', async () => {
      mockGenerateResponse.mockResolvedValue({ content: 'A'.repeat(100), inputTokens: 5, outputTokens: 20, model: 'claude' });

      const res = await POST(createRequest({ type: 'ai', provider: 'anthropic', model: 'claude' }));
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.response).toHaveLength(60);
    });

    it('passes the requested model to the AI provider', async () => {
      mockGenerateResponse.mockResolvedValue({ content: 'Hi', inputTokens: 1, outputTokens: 1, model: 'claude-opus-4-6' });

      await POST(createRequest({ type: 'ai', provider: 'anthropic', model: 'claude-opus-4-6' }));

      expect(mockGenerateResponse).toHaveBeenCalledWith(
        '',
        [{ role: 'user', content: 'Say hello in one word.' }],
        expect.objectContaining({ model: 'claude-opus-4-6', maxTokens: 20 })
      );
    });

    it('classifies a missing-key error', async () => {
      mockGenerateResponse.mockRejectedValue(new Error('ANTHROPIC_API_KEY is not set'));

      const res = await POST(createRequest({ type: 'ai', provider: 'anthropic', model: 'claude' }));
      const body = await res.json();

      expect(body.success).toBe(false);
      expect(body.error).toBe('Platform API key not configured (check .env)');
    });

    it('classifies a 401 authentication error', async () => {
      mockGenerateResponse.mockRejectedValue(new Error('401 unauthorized'));

      const res = await POST(createRequest({ type: 'ai', provider: 'anthropic', model: 'claude' }));
      const body = await res.json();

      expect(body.success).toBe(false);
      expect(body.error).toBe('Authentication failed — check API key');
    });

    it('classifies a 429 rate-limit error', async () => {
      mockGenerateResponse.mockRejectedValue(new Error('429 rate limit exceeded'));

      const res = await POST(createRequest({ type: 'ai', provider: 'groq', model: 'llama-3.3-70b-versatile' }));
      const body = await res.json();

      expect(body.success).toBe(false);
      expect(body.error).toBe('Rate limited by provider');
    });

    it('classifies a timeout', async () => {
      mockGenerateResponse.mockRejectedValue(new Error('timeout'));

      const res = await POST(createRequest({ type: 'ai', provider: 'anthropic', model: 'claude' }));
      const body = await res.json();

      expect(body.success).toBe(false);
      expect(body.error).toBe('Timed out');
    });

    it('passes through unknown errors verbatim', async () => {
      mockGenerateResponse.mockRejectedValue(new Error('something unexpected happened'));

      const res = await POST(createRequest({ type: 'ai', provider: 'anthropic', model: 'claude' }));
      const body = await res.json();

      expect(body.success).toBe(false);
      expect(body.error).toBe('something unexpected happened');
    });
  });

  // ── TTS testing ─────────────────────────────────────────────────────────────

  describe('TTS', () => {
    it('returns success with a base64 audio data URL', async () => {
      vi.stubEnv('ELEVENLABS_API_KEY', 'xi-test-key');
      mockGenerateSpeech.mockResolvedValue(Buffer.from('fake-mp3-bytes'));

      const res = await POST(createRequest({ type: 'tts', provider: 'elevenlabs', model: 'eleven_v3' }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.audioData).toMatch(/^data:audio\/mpeg;base64,/);
      expect(typeof body.latencyMs).toBe('number');
    });

    it('returns failure when the platform key is missing', async () => {
      // ELEVENLABS_API_KEY stubbed to '' in beforeEach
      const res = await POST(createRequest({ type: 'tts', provider: 'elevenlabs', model: 'eleven_v3' }));
      const body = await res.json();

      expect(res.status).toBe(200); // HTTP 200 — business-level failure in body
      expect(body.success).toBe(false);
      expect(body.error).toBe('Platform API key not configured (check .env)');
    });

    it('returns failure for KittenTTS when KITTENTTS_URL is not set', async () => {
      const res = await POST(createRequest({ type: 'tts', provider: 'kittentts', model: 'kitten-tts-mini-0.8' }));
      const body = await res.json();

      expect(body.success).toBe(false);
      expect(body.error).toBe('Platform API key not configured (check .env)');
    });

    it('classifies an auth error from the TTS provider', async () => {
      vi.stubEnv('CARTESIA_API_KEY', 'bad-key');
      mockGenerateSpeech.mockRejectedValue(new Error('403 forbidden'));

      const res = await POST(createRequest({ type: 'tts', provider: 'cartesia', model: 'sonic-2' }));
      const body = await res.json();

      expect(body.success).toBe(false);
      expect(body.error).toBe('Authentication failed — check API key');
    });
  });

  // ── STT testing ─────────────────────────────────────────────────────────────

  describe('STT', () => {
    it('returns success with the transcription text', async () => {
      vi.stubEnv('KITTENTTS_URL', 'http://localhost:8100');
      mockGenerateSpeech.mockResolvedValue(Buffer.from('fake-audio'));
      vi.stubEnv('OPENAI_API_KEY', 'sk-test-key');
      mockTranscribe.mockResolvedValue({ text: 'Hello world', segments: [], language: 'en' });

      const res = await POST(createRequest({ type: 'stt', provider: 'openai', model: 'whisper-1' }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.transcript).toBe('Hello world');
      expect(typeof body.latencyMs).toBe('number');
    });

    it('returns silence note when transcription is empty', async () => {
      vi.stubEnv('KITTENTTS_URL', 'http://localhost:8100');
      mockGenerateSpeech.mockResolvedValue(Buffer.from('fake-audio'));
      vi.stubEnv('GROQ_API_KEY', 'gsk-test-key');
      mockTranscribe.mockResolvedValue({ text: '', segments: [], language: 'en' });

      const res = await POST(createRequest({ type: 'stt', provider: 'groq', model: 'whisper-large-v3-turbo' }));
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.transcript).toBe('(empty transcript)');
    });

    it('returns failure when the STT key is missing', async () => {
      // OPENAI_API_KEY is '' from beforeEach
      const res = await POST(createRequest({ type: 'stt', provider: 'openai', model: 'whisper-1' }));
      const body = await res.json();

      expect(body.success).toBe(false);
      expect(body.error).toBe('Platform API key not configured (check .env)');
    });

    it('passes the correct key and model to createSttProvider', async () => {
      vi.stubEnv('KITTENTTS_URL', 'http://localhost:8100');
      mockGenerateSpeech.mockResolvedValue(Buffer.from('fake-audio'));
      vi.stubEnv('GROQ_API_KEY', 'groq-key-123');
      mockTranscribe.mockResolvedValue({ text: 'test', segments: [], language: 'en' });

      await POST(createRequest({ type: 'stt', provider: 'groq', model: 'whisper-large-v3-turbo' }));

      expect(mockCreateSttProvider).toHaveBeenCalledWith('groq', 'groq-key-123', 'whisper-large-v3-turbo');
    });

    it('routes ElevenLabs STT to ELEVENLABS_API_KEY', async () => {
      vi.stubEnv('KITTENTTS_URL', 'http://localhost:8100');
      mockGenerateSpeech.mockResolvedValue(Buffer.from('fake-audio'));
      vi.stubEnv('ELEVENLABS_API_KEY', 'xi-stt-key');
      mockTranscribe.mockResolvedValue({ text: 'transcribed', segments: [], language: 'en' });

      await POST(createRequest({ type: 'stt', provider: 'elevenlabs', model: 'scribe_v1' }));

      expect(mockCreateSttProvider).toHaveBeenCalledWith('elevenlabs', 'xi-stt-key', 'scribe_v1');
    });

    it('classifies a network error from the STT provider', async () => {
      vi.stubEnv('KITTENTTS_URL', 'http://localhost:8100');
      mockGenerateSpeech.mockResolvedValue(Buffer.from('fake-audio'));
      vi.stubEnv('OPENAI_API_KEY', 'sk-test-key');
      mockTranscribe.mockRejectedValue(new Error('fetch failed: ECONNREFUSED'));

      const res = await POST(createRequest({ type: 'stt', provider: 'openai', model: 'whisper-1' }));
      const body = await res.json();

      expect(body.success).toBe(false);
      expect(body.error).toMatch(/^Network error:/);
    });
  });

  // ── BYOK key source ──────────────────────────────────────────────────────────

  describe('BYOK key source', () => {
    describe('AI BYOK', () => {
      it('calls generateResponse with apiKeyOverride from BYOK key', async () => {
        mockGetAiKey.mockResolvedValue({ apiKey: 'byok-anthropic-key', provider: 'anthropic' });
        mockGenerateResponse.mockResolvedValue({ content: 'Hello', inputTokens: 5, outputTokens: 1, model: 'claude' });

        const res = await POST(createRequest({ type: 'ai', provider: 'anthropic', model: 'claude', keySource: 'byok' }));
        const body = await res.json();

        expect(body.success).toBe(true);
        expect(mockGetAiKey).toHaveBeenCalledWith('admin-1', 'anthropic');
        expect(mockGenerateResponse).toHaveBeenCalledWith(
          '',
          [{ role: 'user', content: 'Say hello in one word.' }],
          expect.objectContaining({ apiKeyOverride: 'byok-anthropic-key' })
        );
      });

      it('returns failure when BYOK AI key is not found', async () => {
        mockGetAiKey.mockResolvedValue(null);

        const res = await POST(createRequest({ type: 'ai', provider: 'anthropic', model: 'claude', keySource: 'byok' }));
        const body = await res.json();

        expect(body.success).toBe(false);
        expect(body.error).toMatch(/BYOK key not found/);
      });
    });

    describe('TTS BYOK', () => {
      it('uses BYOK key for TTS provider', async () => {
        mockGetByokKey.mockResolvedValue('byok-xi-key');
        mockGenerateSpeech.mockResolvedValue(Buffer.from('audio'));

        const res = await POST(createRequest({ type: 'tts', provider: 'elevenlabs', model: 'eleven_v3', keySource: 'byok' }));
        const body = await res.json();

        expect(body.success).toBe(true);
        expect(mockGetByokKey).toHaveBeenCalledWith('admin-1', 'elevenlabs');
        expect(mockCreateTtsProviderAsync).toHaveBeenCalledWith(
          'elevenlabs',
          'byok-xi-key',
          undefined,
          'eleven_v3'
        );
      });


      it('returns failure when BYOK TTS key is not found', async () => {
        mockGetByokKey.mockResolvedValue(null);

        const res = await POST(createRequest({ type: 'tts', provider: 'elevenlabs', model: 'eleven_v3', keySource: 'byok' }));
        const body = await res.json();

        expect(body.success).toBe(false);
        expect(body.error).toMatch(/BYOK key not found/);
      });
    });

    describe('STT BYOK', () => {
      it('uses AI BYOK key for openai STT', async () => {
        vi.stubEnv('KITTENTTS_URL', 'http://localhost:8100');
        mockGenerateSpeech.mockResolvedValue(Buffer.from('fake-audio'));
        mockGetAiKey.mockResolvedValue({ apiKey: 'byok-openai-key', provider: 'openai' });
        mockTranscribe.mockResolvedValue({ text: 'test', segments: [], language: 'en' });

        await POST(createRequest({ type: 'stt', provider: 'openai', model: 'whisper-1', keySource: 'byok' }));

        expect(mockGetAiKey).toHaveBeenCalledWith('admin-1', 'openai');
        expect(mockCreateSttProvider).toHaveBeenCalledWith('openai', 'byok-openai-key', 'whisper-1');
      });

      it('uses AI BYOK key for groq STT', async () => {
        vi.stubEnv('KITTENTTS_URL', 'http://localhost:8100');
        mockGenerateSpeech.mockResolvedValue(Buffer.from('fake-audio'));
        mockGetAiKey.mockResolvedValue({ apiKey: 'byok-groq-key', provider: 'groq' });
        mockTranscribe.mockResolvedValue({ text: 'test', segments: [], language: 'en' });

        await POST(createRequest({ type: 'stt', provider: 'groq', model: 'whisper-large-v3-turbo', keySource: 'byok' }));

        expect(mockGetAiKey).toHaveBeenCalledWith('admin-1', 'groq');
        expect(mockCreateSttProvider).toHaveBeenCalledWith('groq', 'byok-groq-key', 'whisper-large-v3-turbo');
      });

      it('uses TTS BYOK key for elevenlabs STT', async () => {
        vi.stubEnv('KITTENTTS_URL', 'http://localhost:8100');
        mockGenerateSpeech.mockResolvedValue(Buffer.from('fake-audio'));
        mockGetByokKey.mockResolvedValue('byok-xi-stt-key');
        mockTranscribe.mockResolvedValue({ text: 'test', segments: [], language: 'en' });

        await POST(createRequest({ type: 'stt', provider: 'elevenlabs', model: 'scribe_v1', keySource: 'byok' }));

        expect(mockGetByokKey).toHaveBeenCalledWith('admin-1', 'elevenlabs');
        expect(mockCreateSttProvider).toHaveBeenCalledWith('elevenlabs', 'byok-xi-stt-key', 'scribe_v1');
      });

      it('returns failure when BYOK STT key is not found', async () => {
        mockGetAiKey.mockResolvedValue(null);

        const res = await POST(createRequest({ type: 'stt', provider: 'openai', model: 'whisper-1', keySource: 'byok' }));
        const body = await res.json();

        expect(body.success).toBe(false);
        expect(body.error).toMatch(/BYOK key not found/);
      });
    });

    it('defaults to platform path when keySource is omitted', async () => {
      vi.stubEnv('ELEVENLABS_API_KEY', 'xi-platform-key');
      mockGenerateSpeech.mockResolvedValue(Buffer.from('audio'));

      const res = await POST(createRequest({ type: 'tts', provider: 'elevenlabs', model: 'eleven_v3' }));
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(mockGetByokKey).not.toHaveBeenCalled();
    });
  });
});
