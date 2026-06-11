import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockAuthenticateRequest = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockGetVoiceCatalog = vi.fn();
const mockGetByokKey = vi.fn();
const mockCreateTtsProviderAsync = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/voice-catalog', () => ({
  getVoiceCatalog: (...args: unknown[]) => mockGetVoiceCatalog(...args),
}));

vi.mock('@/lib/redis', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  cache: { get: vi.fn(), set: vi.fn() },
}));

vi.mock('@/lib/byok', () => ({
  getByokKey: (...args: unknown[]) => mockGetByokKey(...args),
}));

vi.mock('@/lib/providers/tts', () => ({
  createTtsProviderAsync: (...args: unknown[]) => mockCreateTtsProviderAsync(...args),
}));

vi.mock('@/lib/usage-logger', () => ({
  logUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { GET } from '@/app/api/v1/voices/route';
import { POST as POST_PREVIEW } from '@/app/api/v1/voices/preview/route';

function createRequest(url = 'http://localhost:3000/api/v1/voices', options?: RequestInit): NextRequest {
  return new NextRequest(url, options as ConstructorParameters<typeof NextRequest>[1]);
}

const mockSession = {
  user: {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
  },
  expires: '2026-12-31',
};

describe('GET /api/v1/voices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetVoiceCatalog.mockResolvedValue([
      {
        id: 'voice-1',
        name: 'Adam',
        gender: 'male',
        accent: 'american',
        age: 'middle',
        description: 'warm narrator',
      },
      {
        id: 'voice-2',
        name: 'Bella',
        gender: 'female',
        accent: 'american',
        age: 'young',
        description: 'engaging storyteller',
      },
    ]);
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns preset pool voices for authenticated user', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockGetVoiceCatalog).toHaveBeenCalledWith('elevenlabs');
    expect(body).toEqual({
      poolVoices: [
        {
          id: 'voice-1',
          name: 'Adam',
          gender: 'male',
          accent: 'american',
          ageRange: 'middle',
          character: 'warm narrator',
        },
        {
          id: 'voice-2',
          name: 'Bella',
          gender: 'female',
          accent: 'american',
          ageRange: 'young',
          character: 'engaging storyteller',
        },
      ],
    });
  });

  it('returns provider-specific preset voices when provider is set', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockGetVoiceCatalog.mockResolvedValue([
      {
        id: 'cartesia-1',
        name: 'Cartesia Voice',
        gender: 'female',
        accent: 'british',
        age: 'young',
        description: 'clear speaker',
      },
    ]);

    const response = await GET(createRequest('http://localhost:3000/api/v1/voices?provider=cartesia'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockGetVoiceCatalog).toHaveBeenCalledWith('cartesia');
    expect(body.poolVoices).toHaveLength(1);
    expect(body.poolVoices[0]).toMatchObject({
      id: 'cartesia-1',
      name: 'Cartesia Voice',
      ageRange: 'young',
      character: 'clear speaker',
    });
  });

  it('rejects invalid provider param', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });

    const response = await GET(createRequest('http://localhost:3000/api/v1/voices?provider=invalid'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: 'Invalid provider' });
    expect(mockGetVoiceCatalog).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/voices/preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetByokKey.mockResolvedValue('user-elevenlabs-key');
    mockCreateTtsProviderAsync.mockResolvedValue({
      generateSpeech: vi.fn().mockResolvedValue(Buffer.from('fake-audio-data')),
    });
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.CARTESIA_API_KEY;
    delete process.env.HUME_API_KEY;
    delete process.env.FAL_KEY;
    delete process.env.REPLICATE_API_TOKEN;
    delete process.env.MISTRAL_API_KEY;
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await POST_PREVIEW(createRequest('http://localhost:3000/api/v1/voices/preview', {
      method: 'POST',
      body: JSON.stringify({ voiceId: 'voice-1', text: 'Hello world', provider: 'elevenlabs' }),
    }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 429 when rate limit is exceeded', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0 });

    const response = await POST_PREVIEW(createRequest('http://localhost:3000/api/v1/voices/preview', {
      method: 'POST',
      body: JSON.stringify({ voiceId: 'voice-1', text: 'Hello world', provider: 'elevenlabs' }),
    }));
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toMatchObject({ error: 'Rate limit exceeded. Try again in a minute.' });
  });

  it('returns 400 when preview request is invalid', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9 });

    const response = await POST_PREVIEW(createRequest('http://localhost:3000/api/v1/voices/preview', {
      method: 'POST',
      body: JSON.stringify({ voiceId: 'voice-1', text: 'Hello world' }),
    }));

    expect(response.status).toBe(400);
  });

  it('returns 400 when no provider key is available', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9 });
    mockGetByokKey.mockResolvedValue(null);

    const response = await POST_PREVIEW(createRequest('http://localhost:3000/api/v1/voices/preview', {
      method: 'POST',
      body: JSON.stringify({ voiceId: 'voice-1', text: 'Hello world', provider: 'elevenlabs' }),
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('No elevenlabs API key available');
  });

  it('generates preset voice preview audio', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9 });
    const mockAudioBuffer = Buffer.from('fake-audio-data');
    const generateSpeech = vi.fn().mockResolvedValue(mockAudioBuffer);
    mockCreateTtsProviderAsync.mockResolvedValue({ generateSpeech });

    const response = await POST_PREVIEW(createRequest('http://localhost:3000/api/v1/voices/preview', {
      method: 'POST',
      body: JSON.stringify({
        voiceId: 'voice-1',
        text: 'Hello world, this is a preview.',
        provider: 'elevenlabs',
      }),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(response.headers.get('Content-Length')).toBe(mockAudioBuffer.length.toString());
    expect(mockCreateTtsProviderAsync).toHaveBeenCalledWith('elevenlabs', 'user-elevenlabs-key');
    expect(generateSpeech).toHaveBeenCalledWith({
      text: 'Hello world, this is a preview.',
      voiceId: 'voice-1',
    });
  });
});
