import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoisted mock factories (run before vi.mock() calls) ───────────────────────

const mockRequireAdmin = vi.hoisted(() => vi.fn());
const mockGenerateResponse = vi.hoisted(() => vi.fn());
const mockCreateAIProvider = vi.hoisted(() =>
  vi.fn(() => ({ generateResponse: mockGenerateResponse, streamResponse: vi.fn() }))
);
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
const mockUploadFile = vi.hoisted(() => vi.fn());
const mockDeleteFile = vi.hoisted(() => vi.fn());
const mockSubmitFalLipSync = vi.hoisted(() => vi.fn());
const mockPollFalLipSync = vi.hoisted(() => vi.fn());
const mockGetFalVideoEndpoint = vi.hoisted(() => vi.fn());
const mockGetFalFrameParams = vi.hoisted(() => vi.fn());
const mockIsFalWanModel = vi.hoisted(() => vi.fn());
const mockVideoModelRequiresFirstFrame = vi.hoisted(() => vi.fn());
const mockListAvatars = vi.hoisted(() => vi.fn());

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
  CARTESIA_VOICE_POOL: [
    { id: 'cartesia-test-voice', name: 'Barbershop Man', gender: 'male', character: 'warm' },
  ],
  HUME_VOICE_POOL: [{ id: 'ITO', name: 'Ito', gender: 'female', character: 'warm' }],
  FAL_VOICE_POOL: [{ id: 'Vivian', name: 'Vivian', gender: 'female', character: 'warm' }],
  MINIMAX_VOICE_POOL: [
    {
      id: 'Deep_Voice_Man',
      name: 'Deep Voice Man',
      gender: 'male',
      character: 'authoritative expert',
    },
  ],
  MISTRAL_VOICE_POOL: [
    {
      id: 'casual_male',
      name: 'Casual Male',
      gender: 'male',
      character: 'friendly conversationalist',
    },
  ],
  KOKORO_VOICE_POOL: [
    { id: 'af_heart', name: 'Heart', gender: 'female', character: 'warm narrator' },
  ],
  LOCAL_TTS_VOICE_POOL: [
    { id: 'default', name: 'Default', gender: 'female', character: 'warm narrator' },
  ],
  getTestVoiceId: vi.fn((provider: string) => {
    const map: Record<string, string> = {
      elevenlabs: '21m00Tcm4TlvDq8ikWAM',
      openai: 'alloy',
      cartesia: 'cartesia-test-voice',
      hume: 'ITO',
      fal: 'Vivian',
      replicate: 'Vivian',
      minimax: 'Deep_Voice_Man',
      mistral: 'casual_male',
      kokoro: 'af_heart',
      local: 'default',
    };
    return map[provider] ?? 'alloy';
  }),
}));

// getPlatformTtsKey reads process.env directly — no mock needed.
// Tests control keys via vi.stubEnv() in beforeEach.

vi.mock('@/lib/providers/tts-registry', () => ({
  getProviderIds: vi.fn(() => [
    'elevenlabs',
    'openai',
    'cartesia',
    'hume',
    'fal',
    'replicate',
    'minimax',
    'mistral',
    'kokoro',
    'local',
  ]),
  getProviderMeta: vi.fn(() => ({ defaultModel: 'test-model' })),
}));

vi.mock('@/lib/fal-lip-sync', () => ({
  submitFalLipSync: mockSubmitFalLipSync,
  pollFalLipSync: mockPollFalLipSync,
}));
vi.mock('@/lib/r2', () => ({
  uploadFile: mockUploadFile,
  deleteFile: mockDeleteFile,
}));
vi.mock('@/lib/providers/fal-endpoints', () => ({
  getFalVideoEndpoint: mockGetFalVideoEndpoint,
  getFalFrameParams: mockGetFalFrameParams,
  isFalWanModel: mockIsFalWanModel,
  getFalAvatarEndpoint: vi.fn(() => 'fal-ai/kling-video/ai-avatar/v2/pro'),
  LIP_SYNC_CONFIG: {
    'fal-veed-fabric-1.0': { maxAudioSeconds: 300, outputFormat: 'mp4' },
    'fal-kling-avatar-v2-pro': {
      maxAudioSeconds: 60,
      outputFormat: 'mp4',
      defaultPrompt: 'A person speaking to camera',
    },
  },
}));
vi.mock('@/lib/providers/video-registry', () => ({
  getVideoProviderMeta: vi.fn((id: string) => {
    if (id === 'minimax')
      return {
        platformKeyEnv: 'MINIMAX_API_KEY',
        auth: { validate: vi.fn().mockResolvedValue(true) },
      };
    return { platformKeyEnv: 'FAL_KEY', auth: { validate: vi.fn().mockResolvedValue(true) } };
  }),
  videoModelRequiresFirstFrame: mockVideoModelRequiresFirstFrame,
}));
vi.mock('@/lib/providers/avatar-registry', () => ({
  getAvatarProviderMeta: vi.fn(() => ({
    platformKeyEnv: 'FAL_KEY',
    auth: { validate: vi.fn().mockResolvedValue(true) },
  })),
}));
vi.mock('@/lib/providers/video/minimax.provider', () => ({
  MINIMAX_MODEL_MAP: {
    'minimax-hailuo02-768p': { apiModel: 'MiniMax-Hailuo-02', resolution: '768P' },
    'minimax-hailuo02-512p': {
      apiModel: 'MiniMax-Hailuo-02',
      resolution: '512P',
      requiresFirstFrame: true,
    },
  },
}));
vi.mock('@/lib/heygen', () => ({ listAvatars: mockListAvatars }));
vi.mock('@/lib/providers/image/fal.provider', () => ({
  FalImageProvider: vi.fn().mockImplementation(() => ({
    generateImage: vi.fn().mockResolvedValue(Buffer.from('fake-image')),
  })),
}));

import { POST } from '@/app/api/v1/admin/test-model/route';

// ── Helpers ───────────────────────────────────────────────────────────────────

function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/admin/test-model', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/v1/admin/test-model', () => {
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
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('MINIMAX_API_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ── Auth ────────────────────────────────────────────────────────────────────

  it('returns 403 when not admin', async () => {
    mockRequireAdmin.mockResolvedValue(null);
    const res = await POST(
      createRequest({ type: 'ai', provider: 'anthropic', model: 'claude-haiku-4-5-20251001' })
    );
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe('Forbidden');
  });

  // ── Input validation ────────────────────────────────────────────────────────

  it('returns 400 for an invalid type', async () => {
    const res = await POST(
      createRequest({ type: 'invalid', provider: 'anthropic', model: 'claude' })
    );
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

      const res = await POST(
        createRequest({ type: 'ai', provider: 'anthropic', model: 'claude-haiku-4-5-20251001' })
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.response).toBe('Hello');
      expect(typeof body.latencyMs).toBe('number');
    });

    it('truncates AI response to 60 characters', async () => {
      mockGenerateResponse.mockResolvedValue({
        content: 'A'.repeat(100),
        inputTokens: 5,
        outputTokens: 20,
        model: 'claude',
      });

      const res = await POST(createRequest({ type: 'ai', provider: 'anthropic', model: 'claude' }));
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.response).toHaveLength(60);
    });

    it('passes the requested model to the AI provider', async () => {
      mockGenerateResponse.mockResolvedValue({
        content: 'Hi',
        inputTokens: 1,
        outputTokens: 1,
        model: 'claude-opus-4-6',
      });

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

      const res = await POST(
        createRequest({ type: 'ai', provider: 'anthropic', model: 'claude-haiku-4-5-20251001' })
      );
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

      const res = await POST(
        createRequest({ type: 'tts', provider: 'elevenlabs', model: 'eleven_v3' })
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.audioData).toMatch(/^data:audio\/mpeg;base64,/);
      expect(typeof body.latencyMs).toBe('number');
    });

    it('returns failure when the platform key is missing', async () => {
      // ELEVENLABS_API_KEY stubbed to '' in beforeEach
      const res = await POST(
        createRequest({ type: 'tts', provider: 'elevenlabs', model: 'eleven_v3' })
      );
      const body = await res.json();

      expect(res.status).toBe(200); // HTTP 200 — business-level failure in body
      expect(body.success).toBe(false);
      expect(body.error).toBe('Platform API key not configured (check .env)');
    });

    it('classifies an auth error from the TTS provider', async () => {
      vi.stubEnv('CARTESIA_API_KEY', 'bad-key');
      mockGenerateSpeech.mockRejectedValue(new Error('403 forbidden'));

      const res = await POST(
        createRequest({ type: 'tts', provider: 'cartesia', model: 'sonic-2' })
      );
      const body = await res.json();

      expect(body.success).toBe(false);
      expect(body.error).toBe('Authentication failed — check API key');
    });

    it('treats local TTS as a keyless platform provider', async () => {
      mockGenerateSpeech.mockResolvedValue(Buffer.from('fake-mp3-bytes'));

      const res = await POST(createRequest({ type: 'tts', provider: 'local', model: 'local' }));
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(mockCreateTtsProviderAsync).toHaveBeenCalledWith('local', 'local', undefined, 'local');
    });
  });

  // ── STT testing ─────────────────────────────────────────────────────────────

  describe('STT', () => {
    it('returns success with the transcription text', async () => {
      vi.stubEnv('ELEVENLABS_API_KEY', 'xi-test-tts');
      mockGenerateSpeech.mockResolvedValue(Buffer.from('fake-audio'));
      vi.stubEnv('OPENAI_API_KEY', 'sk-test-key');
      mockTranscribe.mockResolvedValue({ text: 'Hello world', segments: [], language: 'en' });

      const res = await POST(
        createRequest({ type: 'stt', provider: 'openai', model: 'whisper-1' })
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.transcript).toBe('Hello world');
      expect(typeof body.latencyMs).toBe('number');
    });

    it('returns silence note when transcription is empty', async () => {
      vi.stubEnv('ELEVENLABS_API_KEY', 'xi-test-tts');
      mockGenerateSpeech.mockResolvedValue(Buffer.from('fake-audio'));
      vi.stubEnv('OPENAI_API_KEY', 'sk-test-key');
      mockTranscribe.mockResolvedValue({ text: '', segments: [], language: 'en' });

      const res = await POST(
        createRequest({ type: 'stt', provider: 'openai', model: 'whisper-1' })
      );
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.transcript).toBe('(empty transcript)');
    });

    it('returns failure when the STT key is missing', async () => {
      // OPENAI_API_KEY is '' from beforeEach
      const res = await POST(
        createRequest({ type: 'stt', provider: 'openai', model: 'whisper-1' })
      );
      const body = await res.json();

      expect(body.success).toBe(false);
      expect(body.error).toBe('Platform API key not configured (check .env)');
    });

    it('routes ElevenLabs STT to ELEVENLABS_API_KEY', async () => {
      vi.stubEnv('ELEVENLABS_API_KEY', 'xi-test-tts');
      mockGenerateSpeech.mockResolvedValue(Buffer.from('fake-audio'));
      vi.stubEnv('ELEVENLABS_API_KEY', 'xi-stt-key');
      mockTranscribe.mockResolvedValue({ text: 'transcribed', segments: [], language: 'en' });

      await POST(createRequest({ type: 'stt', provider: 'elevenlabs', model: 'scribe_v1' }));

      expect(mockCreateSttProvider).toHaveBeenCalledWith('elevenlabs', 'xi-stt-key', 'scribe_v1');
    });

    it('classifies a network error from the STT provider', async () => {
      vi.stubEnv('ELEVENLABS_API_KEY', 'xi-test-tts');
      mockGenerateSpeech.mockResolvedValue(Buffer.from('fake-audio'));
      vi.stubEnv('OPENAI_API_KEY', 'sk-test-key');
      mockTranscribe.mockRejectedValue(new Error('fetch failed: ECONNREFUSED'));

      const res = await POST(
        createRequest({ type: 'stt', provider: 'openai', model: 'whisper-1' })
      );
      const body = await res.json();

      expect(body.success).toBe(false);
      expect(body.error).toMatch(/^Network error:/);
    });

    it('routes local STT to the local placeholder key', async () => {
      mockGenerateSpeech.mockResolvedValue(Buffer.from('fake-audio'));
      mockTranscribe.mockResolvedValue({ text: 'local transcript', segments: [], language: 'en' });

      const res = await POST(
        createRequest({ type: 'stt', provider: 'local', model: 'whisper-local' })
      );
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(mockCreateSttProvider).toHaveBeenCalledWith('local', 'local', 'whisper-local');
    });
  });

  // ── Video testing ─────────────────────────────────────────────────────────────

  describe('Video', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      fetchSpy = vi.spyOn(global, 'fetch');
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it('generates a Fal video and returns videoUrl', async () => {
      vi.useFakeTimers();
      vi.stubEnv('FAL_KEY', 'fal-test-key');
      mockGetFalVideoEndpoint.mockReturnValue('fal-ai/wan/v2.5/text-to-video');
      mockVideoModelRequiresFirstFrame.mockReturnValue(false);
      mockIsFalWanModel.mockReturnValue(true);

      fetchSpy.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        // Queue submit
        if (urlStr.includes('queue.fal.run') && !urlStr.includes('/requests/')) {
          return new Response(
            JSON.stringify({
              request_id: 'req-123',
              status_url:
                'https://queue.fal.run/fal-ai/wan/v2.5/text-to-video/requests/req-123/status',
              response_url: 'https://queue.fal.run/fal-ai/wan/v2.5/text-to-video/requests/req-123',
            }),
            { status: 200 }
          );
        }
        // Poll status — return COMPLETED
        if (urlStr.includes('/status')) {
          return new Response(JSON.stringify({ status: 'COMPLETED' }), { status: 200 });
        }
        // Result fetch
        if (urlStr.includes('/requests/req-123') && !urlStr.includes('/status')) {
          return new Response(JSON.stringify({ video: { url: 'https://fal.cdn/video.mp4' } }), {
            status: 200,
          });
        }
        return new Response('not found', { status: 404 });
      });

      const promise = POST(
        createRequest({ type: 'video', provider: 'fal', model: 'fal-wan2.5-480p' })
      );
      await vi.advanceTimersByTimeAsync(200_000);
      const res = await promise;
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.videoUrl).toBe('https://fal.cdn/video.mp4');
      expect(body.response).toBe('Video generated');
      vi.useRealTimers();
    });

    it('returns failure when FAL_KEY is missing for video', async () => {
      mockGetFalVideoEndpoint.mockReturnValue('fal-ai/wan/v2.5/text-to-video');

      const res = await POST(
        createRequest({ type: 'video', provider: 'fal', model: 'fal-wan2.5-480p' })
      );
      const body = await res.json();

      expect(body.success).toBe(false);
      expect(body.error).toMatch(/Platform key not configured/);
    });

    it('generates a MiniMax video and returns videoUrl', async () => {
      vi.useFakeTimers();
      vi.stubEnv('MINIMAX_API_KEY', 'mm-test-key');

      fetchSpy.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        // Submit
        if (urlStr.includes('video_generation') && !urlStr.includes('query')) {
          return new Response(
            JSON.stringify({
              task_id: 'task-456',
              base_resp: { status_code: 0, status_msg: 'success' },
            }),
            { status: 200 }
          );
        }
        // Poll status
        if (urlStr.includes('query/video_generation')) {
          return new Response(
            JSON.stringify({
              status: 'Success',
              file_id: 'file-789',
              base_resp: { status_code: 0, status_msg: 'success' },
            }),
            { status: 200 }
          );
        }
        // File retrieve
        if (urlStr.includes('files/retrieve')) {
          return new Response(
            JSON.stringify({
              file: { download_url: 'https://minimax.cdn/video.mp4' },
              base_resp: { status_code: 0, status_msg: 'success' },
            }),
            { status: 200 }
          );
        }
        return new Response('not found', { status: 404 });
      });

      const promise = POST(
        createRequest({ type: 'video', provider: 'minimax', model: 'minimax-hailuo02-768p' })
      );
      await vi.advanceTimersByTimeAsync(200_000);
      const res = await promise;
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.videoUrl).toBe('https://minimax.cdn/video.mp4');
      expect(body.response).toBe('Video generated');
      vi.useRealTimers();
    });

    it('falls back to key validation for unknown video providers', async () => {
      vi.stubEnv('FAL_KEY', 'fal-test-key');
      mockGetFalVideoEndpoint.mockReturnValue(null);

      fetchSpy.mockImplementation(async () => {
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const res = await POST(
        createRequest({ type: 'video', provider: 'fal', model: 'fal-unknown-model' })
      );
      const body = await res.json();

      expect(body.response).toMatch(/API key valid/);
    });
  });

  // ── Avatar testing ───────────────────────────────────────────────────────────

  describe('Avatar', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      fetchSpy = vi.spyOn(global, 'fetch');
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it('generates a lip-sync video for Fal avatar models', async () => {
      vi.stubEnv('FAL_KEY', 'fal-test-key');
      vi.stubEnv('ELEVENLABS_API_KEY', 'xi-test-tts');
      mockGenerateSpeech.mockResolvedValue(Buffer.from('fake-audio'));
      mockUploadFile.mockResolvedValue('https://r2.cdn/admin-tests/test.mp3');
      mockDeleteFile.mockResolvedValue(undefined);
      mockSubmitFalLipSync.mockResolvedValue({
        requestId: 'req-lip',
        statusUrl: 'https://queue.fal.run/status',
        resultUrl: 'https://queue.fal.run/result',
      });
      mockPollFalLipSync.mockResolvedValue({
        videoUrl: 'https://fal.cdn/lip-sync.mp4',
        durationSeconds: 3,
      });

      // Mock the generateFalImageUrl fetch call
      fetchSpy.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('fal.run/fal-ai/flux/schnell')) {
          return new Response(
            JSON.stringify({
              images: [{ url: 'https://fal.cdn/portrait.png' }],
            }),
            { status: 200 }
          );
        }
        return new Response('not found', { status: 404 });
      });

      const res = await POST(
        createRequest({ type: 'avatar', provider: 'fal', model: 'fal-kling-avatar-v2-pro' })
      );
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.videoUrl).toBe('https://fal.cdn/lip-sync.mp4');
      expect(body.response).toContain('Lip-sync');
      expect(mockUploadFile).toHaveBeenCalled();
      expect(mockDeleteFile).toHaveBeenCalled();
    });

    it('falls back to key validation when no TTS is available for avatar test', async () => {
      vi.stubEnv('FAL_KEY', 'fal-test-key');
      // Force all TTS providers to fail so generateTestAudio returns null
      mockGenerateSpeech.mockRejectedValue(new Error('TTS unavailable'));

      // Mock the generateFalImageUrl fetch call
      fetchSpy.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('fal.run/fal-ai/flux/schnell')) {
          return new Response(
            JSON.stringify({
              images: [{ url: 'https://fal.cdn/portrait.png' }],
            }),
            { status: 200 }
          );
        }
        return new Response('not found', { status: 404 });
      });

      const res = await POST(
        createRequest({ type: 'avatar', provider: 'fal', model: 'fal-kling-avatar-v2-pro' })
      );
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.response).toContain('Fal key valid');
    });

    it('returns failure when FAL_KEY is missing for avatar test', async () => {
      const res = await POST(
        createRequest({ type: 'avatar', provider: 'fal', model: 'fal-kling-avatar-v2-pro' })
      );
      const body = await res.json();

      expect(body.success).toBe(false);
      expect(body.error).toMatch(/Platform key not configured/);
    });

    it('lists avatars for HeyGen provider', async () => {
      vi.stubEnv('FAL_KEY', 'heygen-key');
      mockListAvatars.mockResolvedValue([{ id: '1' }, { id: '2' }]);

      // Mock getAvatarProviderMeta to return HEYGEN_API_KEY for heygen
      const res = await POST(
        createRequest({ type: 'avatar', provider: 'heygen', model: 'heygen-default' })
      );
      const body = await res.json();

      // HeyGen uses FAL_KEY in the mock but the important thing is listAvatars is called
      expect(body.success).toBe(true);
      expect(body.avatarCount).toBe(2);
    });
  });

  // ── BYOK key source ──────────────────────────────────────────────────────────

  describe('BYOK key source', () => {
    describe('AI BYOK', () => {
      it('calls generateResponse with apiKeyOverride from BYOK key', async () => {
        mockGetAiKey.mockResolvedValue({ apiKey: 'byok-anthropic-key', provider: 'anthropic' });
        mockGenerateResponse.mockResolvedValue({
          content: 'Hello',
          inputTokens: 5,
          outputTokens: 1,
          model: 'claude',
        });

        const res = await POST(
          createRequest({ type: 'ai', provider: 'anthropic', model: 'claude', keySource: 'byok' })
        );
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

        const res = await POST(
          createRequest({ type: 'ai', provider: 'anthropic', model: 'claude', keySource: 'byok' })
        );
        const body = await res.json();

        expect(body.success).toBe(false);
        expect(body.error).toMatch(/BYOK key not found/);
      });
    });

    describe('TTS BYOK', () => {
      it('uses BYOK key for TTS provider', async () => {
        mockGetByokKey.mockResolvedValue('byok-xi-key');
        mockGenerateSpeech.mockResolvedValue(Buffer.from('audio'));

        const res = await POST(
          createRequest({
            type: 'tts',
            provider: 'elevenlabs',
            model: 'eleven_v3',
            keySource: 'byok',
          })
        );
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

        const res = await POST(
          createRequest({
            type: 'tts',
            provider: 'elevenlabs',
            model: 'eleven_v3',
            keySource: 'byok',
          })
        );
        const body = await res.json();

        expect(body.success).toBe(false);
        expect(body.error).toMatch(/BYOK key not found/);
      });
    });

    describe('STT BYOK', () => {
      it('uses AI BYOK key for openai STT', async () => {
        vi.stubEnv('ELEVENLABS_API_KEY', 'xi-test-tts');
        mockGenerateSpeech.mockResolvedValue(Buffer.from('fake-audio'));
        mockGetAiKey.mockResolvedValue({ apiKey: 'byok-openai-key', provider: 'openai' });
        mockTranscribe.mockResolvedValue({ text: 'test', segments: [], language: 'en' });

        await POST(
          createRequest({ type: 'stt', provider: 'openai', model: 'whisper-1', keySource: 'byok' })
        );

        expect(mockGetAiKey).toHaveBeenCalledWith('admin-1', 'openai');
        expect(mockCreateSttProvider).toHaveBeenCalledWith(
          'openai',
          'byok-openai-key',
          'whisper-1'
        );
      });

      it('uses TTS BYOK key for elevenlabs STT', async () => {
        vi.stubEnv('ELEVENLABS_API_KEY', 'xi-test-tts');
        mockGenerateSpeech.mockResolvedValue(Buffer.from('fake-audio'));
        mockGetByokKey.mockResolvedValue('byok-xi-stt-key');
        mockTranscribe.mockResolvedValue({ text: 'test', segments: [], language: 'en' });

        await POST(
          createRequest({
            type: 'stt',
            provider: 'elevenlabs',
            model: 'scribe_v1',
            keySource: 'byok',
          })
        );

        expect(mockGetByokKey).toHaveBeenCalledWith('admin-1', 'elevenlabs');
        expect(mockCreateSttProvider).toHaveBeenCalledWith(
          'elevenlabs',
          'byok-xi-stt-key',
          'scribe_v1'
        );
      });

      it('returns failure when BYOK STT key is not found', async () => {
        mockGetAiKey.mockResolvedValue(null);

        const res = await POST(
          createRequest({ type: 'stt', provider: 'openai', model: 'whisper-1', keySource: 'byok' })
        );
        const body = await res.json();

        expect(body.success).toBe(false);
        expect(body.error).toMatch(/BYOK key not found/);
      });
    });

    it('defaults to platform path when keySource is omitted', async () => {
      vi.stubEnv('ELEVENLABS_API_KEY', 'xi-platform-key');
      mockGenerateSpeech.mockResolvedValue(Buffer.from('audio'));

      const res = await POST(
        createRequest({ type: 'tts', provider: 'elevenlabs', model: 'eleven_v3' })
      );
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(mockGetByokKey).not.toHaveBeenCalled();
    });
  });
});
