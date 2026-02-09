import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockVoiceCloneFindMany = vi.fn();
const mockVoiceCloneCount = vi.fn();
const mockVoiceCloneFindUnique = vi.fn();
const mockVoiceCloneCreate = vi.fn();
const mockVoiceCloneDelete = vi.fn();
const mockSubscriptionFindUnique = vi.fn();
const mockCloneVoice = vi.fn();
const mockDeleteClonedVoice = vi.fn();
const mockGenerateSpeech = vi.fn();
const mockCheckRateLimit = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    voiceClone: {
      findMany: (...args: unknown[]) => mockVoiceCloneFindMany(...args),
      count: (...args: unknown[]) => mockVoiceCloneCount(...args),
      findUnique: (...args: unknown[]) => mockVoiceCloneFindUnique(...args),
      create: (...args: unknown[]) => mockVoiceCloneCreate(...args),
      delete: (...args: unknown[]) => mockVoiceCloneDelete(...args),
    },
    subscription: {
      findUnique: (...args: unknown[]) => mockSubscriptionFindUnique(...args),
    },
  },
}));

vi.mock('@/lib/elevenlabs', () => ({
  VOICE_POOL: [
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
  cloneVoice: (...args: unknown[]) => mockCloneVoice(...args),
  deleteClonedVoice: (...args: unknown[]) => mockDeleteClonedVoice(...args),
  generateSpeech: (...args: unknown[]) => mockGenerateSpeech(...args),
}));

vi.mock('@/lib/redis', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { GET } from '@/app/api/voices/route';
import { POST as POST_CLONE, DELETE as DELETE_CLONE } from '@/app/api/voices/clone/route';
import { POST as POST_PREVIEW } from '@/app/api/voices/preview/route';

function createRequest(
  url = 'http://localhost:3000/api/voices',
  options?: RequestInit
): NextRequest {
  return new NextRequest(url, options as any);
}

const mockSession = {
  user: {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
  },
  expires: '2025-12-31',
};

const mockVoiceClone = {
  id: 'clone-1',
  userId: 'user-1',
  name: 'My Voice',
  elevenLabsVoiceId: 'el-voice-1',
  sourceType: 'UPLOAD',
  createdAt: new Date('2025-01-15T10:00:00Z'),
  updatedAt: new Date('2025-01-15T10:00:00Z'),
};

const mockVoiceClone2 = {
  id: 'clone-2',
  userId: 'user-1',
  name: 'Another Voice',
  elevenLabsVoiceId: 'el-voice-2',
  sourceType: 'RECORD',
  createdAt: new Date('2025-01-16T10:00:00Z'),
  updatedAt: new Date('2025-01-16T10:00:00Z'),
};

describe('GET /api/voices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns voice pool, user clones, and credits for authenticated user', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceCloneFindMany.mockResolvedValue([mockVoiceClone]);
    mockSubscriptionFindUnique.mockResolvedValue({
      userId: 'user-1',
      tier: 'PRO',
      status: 'ACTIVE',
      premiumCreditsUsed: 1,
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveProperty('poolVoices');
    expect(body).toHaveProperty('userClones');
    expect(body).toHaveProperty('credits');
    expect(Array.isArray(body.poolVoices)).toBe(true);
    expect(body.poolVoices).toHaveLength(2);
  });

  it('returns user voice clones with correct fields', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceCloneFindMany.mockResolvedValue([
      {
        id: 'clone-1',
        name: 'My Voice',
        elevenLabsVoiceId: 'el-voice-1',
        sourceType: 'UPLOAD',
        createdAt: mockVoiceClone.createdAt,
      },
      {
        id: 'clone-2',
        name: 'Another Voice',
        elevenLabsVoiceId: 'el-voice-2',
        sourceType: 'RECORD',
        createdAt: mockVoiceClone2.createdAt,
      },
    ]);
    mockSubscriptionFindUnique.mockResolvedValue({
      userId: 'user-1',
      tier: 'CREATOR',
      status: 'ACTIVE',
      premiumCreditsUsed: 2,
    });

    const response = await GET();
    const body = await response.json();

    expect(body.userClones).toHaveLength(2);
    expect(body.userClones[0]).toMatchObject({
      id: 'clone-1',
      name: 'My Voice',
      elevenLabsVoiceId: 'el-voice-1',
      sourceType: 'UPLOAD',
    });
  });

  it('returns correct credits for FREE tier', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceCloneFindMany.mockResolvedValue([]);
    mockSubscriptionFindUnique.mockResolvedValue(null);

    const response = await GET();
    const body = await response.json();

    expect(body.credits).toEqual({
      used: 0,
      total: 0,
      remaining: 0,
    });
  });

  it('returns correct credits for PRO tier', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceCloneFindMany.mockResolvedValue([]);
    mockSubscriptionFindUnique.mockResolvedValue({
      userId: 'user-1',
      tier: 'PRO',
      status: 'ACTIVE',
      premiumCreditsUsed: 2,
    });

    const response = await GET();
    const body = await response.json();

    expect(body.credits).toEqual({
      used: 2,
      total: 3,
      remaining: 1,
    });
  });

  it('returns correct credits for CREATOR tier', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceCloneFindMany.mockResolvedValue([]);
    mockSubscriptionFindUnique.mockResolvedValue({
      userId: 'user-1',
      tier: 'CREATOR',
      status: 'ACTIVE',
      premiumCreditsUsed: 4,
    });

    const response = await GET();
    const body = await response.json();

    expect(body.credits).toEqual({
      used: 4,
      total: 10,
      remaining: 6,
    });
  });
});

describe('POST /api/voices/clone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const formData = new FormData();
    formData.append('name', 'Test Voice');
    formData.append('sourceType', 'UPLOAD');

    const request = createRequest('http://localhost:3000/api/voices/clone', {
      method: 'POST',
      body: formData,
    });
    const response = await POST_CLONE(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 403 for FREE tier users (0 voice clones allowed)', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockSubscriptionFindUnique.mockResolvedValue(null);

    const formData = new FormData();
    formData.append('name', 'Test Voice');
    formData.append('sourceType', 'UPLOAD');

    const request = createRequest('http://localhost:3000/api/voices/clone', {
      method: 'POST',
      body: formData,
    });
    const response = await POST_CLONE(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Voice cloning requires a paid subscription' });
  });

  it('returns 403 when PRO tier user reaches clone limit (2)', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockSubscriptionFindUnique.mockResolvedValue({
      userId: 'user-1',
      tier: 'PRO',
      status: 'ACTIVE',
      premiumCreditsUsed: 0,
    });
    mockVoiceCloneCount.mockResolvedValue(2);

    const formData = new FormData();
    formData.append('name', 'Test Voice');
    formData.append('sourceType', 'UPLOAD');

    const request = createRequest('http://localhost:3000/api/voices/clone', {
      method: 'POST',
      body: formData,
    });
    const response = await POST_CLONE(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Maximum of 2 voice clones allowed for your tier' });
  });

  it('returns 403 when CREATOR tier user reaches clone limit (5)', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockSubscriptionFindUnique.mockResolvedValue({
      userId: 'user-1',
      tier: 'CREATOR',
      status: 'ACTIVE',
      premiumCreditsUsed: 0,
    });
    mockVoiceCloneCount.mockResolvedValue(5);

    const formData = new FormData();
    formData.append('name', 'Test Voice');
    formData.append('sourceType', 'UPLOAD');

    const request = createRequest('http://localhost:3000/api/voices/clone', {
      method: 'POST',
      body: formData,
    });
    const response = await POST_CLONE(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Maximum of 5 voice clones allowed for your tier' });
  });

  it('returns 400 when name is missing', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockSubscriptionFindUnique.mockResolvedValue({
      userId: 'user-1',
      tier: 'PRO',
      status: 'ACTIVE',
      premiumCreditsUsed: 0,
    });
    mockVoiceCloneCount.mockResolvedValue(0);

    const formData = new FormData();
    formData.append('sourceType', 'UPLOAD');

    const request = createRequest('http://localhost:3000/api/voices/clone', {
      method: 'POST',
      body: formData,
    });
    const response = await POST_CLONE(request);

    expect(response.status).toBe(400);
  });

  it('returns 400 when sourceType is invalid', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockSubscriptionFindUnique.mockResolvedValue({
      userId: 'user-1',
      tier: 'PRO',
      status: 'ACTIVE',
      premiumCreditsUsed: 0,
    });
    mockVoiceCloneCount.mockResolvedValue(0);

    const formData = new FormData();
    formData.append('name', 'Test Voice');
    formData.append('sourceType', 'INVALID');

    const request = createRequest('http://localhost:3000/api/voices/clone', {
      method: 'POST',
      body: formData,
    });
    const response = await POST_CLONE(request);

    expect(response.status).toBe(400);
  });

  it('returns 400 when audio file is missing', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockSubscriptionFindUnique.mockResolvedValue({
      userId: 'user-1',
      tier: 'PRO',
      status: 'ACTIVE',
      premiumCreditsUsed: 0,
    });
    mockVoiceCloneCount.mockResolvedValue(0);

    const formData = new FormData();
    formData.append('name', 'Test Voice');
    formData.append('sourceType', 'UPLOAD');

    const request = createRequest('http://localhost:3000/api/voices/clone', {
      method: 'POST',
      body: formData,
    });
    const response = await POST_CLONE(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Audio file is required' });
  });

  it('successfully creates voice clone for PRO user', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockSubscriptionFindUnique.mockResolvedValue({
      userId: 'user-1',
      tier: 'PRO',
      status: 'ACTIVE',
      premiumCreditsUsed: 0,
    });
    mockVoiceCloneCount.mockResolvedValue(1);
    mockCloneVoice.mockResolvedValue({ voiceId: 'el-voice-new' });
    mockVoiceCloneCreate.mockResolvedValue({
      id: 'clone-new',
      userId: 'user-1',
      name: 'My Custom Voice',
      elevenLabsVoiceId: 'el-voice-new',
      sourceType: 'UPLOAD',
      createdAt: new Date('2025-01-20T10:00:00Z'),
      updatedAt: new Date('2025-01-20T10:00:00Z'),
    });

    const audioBuffer = Buffer.from('fake-audio-data');
    const mockFile = {
      arrayBuffer: async () => audioBuffer,
      name: 'voice.mp3',
      type: 'audio/mpeg',
    } as any as File;

    const mockFormData = new Map<string, any>([
      ['name', 'My Custom Voice'],
      ['sourceType', 'UPLOAD'],
      ['audio', mockFile],
    ]);

    const request = {
      formData: async () =>
        ({
          get: (key: string) => mockFormData.get(key),
        }) as any,
    } as unknown as NextRequest;

    const response = await POST_CLONE(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.id).toBe('clone-new');
    expect(body.name).toBe('My Custom Voice');
    expect(body.elevenLabsVoiceId).toBe('el-voice-new');
    expect(mockCloneVoice).toHaveBeenCalledWith('My Custom Voice', [expect.any(Buffer)]);
  });

  it('successfully creates voice clone for CREATOR user', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockSubscriptionFindUnique.mockResolvedValue({
      userId: 'user-1',
      tier: 'CREATOR',
      status: 'ACTIVE',
      premiumCreditsUsed: 0,
    });
    mockVoiceCloneCount.mockResolvedValue(3);
    mockCloneVoice.mockResolvedValue({ voiceId: 'el-voice-creator' });
    mockVoiceCloneCreate.mockResolvedValue({
      id: 'clone-creator',
      userId: 'user-1',
      name: 'Creator Voice',
      elevenLabsVoiceId: 'el-voice-creator',
      sourceType: 'RECORD',
      createdAt: new Date('2025-01-20T10:00:00Z'),
      updatedAt: new Date('2025-01-20T10:00:00Z'),
    });

    const audioBuffer = Buffer.from('fake-audio-data');
    const mockFile = {
      arrayBuffer: async () => audioBuffer,
      name: 'voice.mp3',
      type: 'audio/mpeg',
    } as any as File;

    const mockFormData = new Map<string, any>([
      ['name', 'Creator Voice'],
      ['sourceType', 'RECORD'],
      ['audio', mockFile],
    ]);

    const request = {
      formData: async () =>
        ({
          get: (key: string) => mockFormData.get(key),
        }) as any,
    } as unknown as NextRequest;

    const response = await POST_CLONE(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.id).toBe('clone-creator');
    expect(body.sourceType).toBe('RECORD');
  });
});

describe('DELETE /api/voices/clone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/voices/clone', {
      method: 'DELETE',
      body: JSON.stringify({ voiceCloneId: 'clone-1' }),
    });
    const response = await DELETE_CLONE(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 400 when voiceCloneId is missing', async () => {
    mockAuth.mockResolvedValue(mockSession);

    const request = createRequest('http://localhost:3000/api/voices/clone', {
      method: 'DELETE',
      body: JSON.stringify({}),
    });
    const response = await DELETE_CLONE(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'voiceCloneId is required' });
  });

  it('returns 404 when voice clone does not exist', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceCloneFindUnique.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/voices/clone', {
      method: 'DELETE',
      body: JSON.stringify({ voiceCloneId: 'nonexistent' }),
    });
    const response = await DELETE_CLONE(request);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Voice clone not found' });
  });

  it("returns 403 when user tries to delete another user's voice clone", async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceCloneFindUnique.mockResolvedValue({
      id: 'clone-1',
      userId: 'user-2',
      name: 'Other User Voice',
      elevenLabsVoiceId: 'el-voice-1',
      sourceType: 'UPLOAD',
    });

    const request = createRequest('http://localhost:3000/api/voices/clone', {
      method: 'DELETE',
      body: JSON.stringify({ voiceCloneId: 'clone-1' }),
    });
    const response = await DELETE_CLONE(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('successfully deletes voice clone from ElevenLabs and database', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceCloneFindUnique.mockResolvedValue(mockVoiceClone);
    mockDeleteClonedVoice.mockResolvedValue(undefined);
    mockVoiceCloneDelete.mockResolvedValue(mockVoiceClone);

    const request = createRequest('http://localhost:3000/api/voices/clone', {
      method: 'DELETE',
      body: JSON.stringify({ voiceCloneId: 'clone-1' }),
    });
    const response = await DELETE_CLONE(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(mockDeleteClonedVoice).toHaveBeenCalledWith('el-voice-1');
    expect(mockVoiceCloneDelete).toHaveBeenCalledWith({
      where: { id: 'clone-1' },
    });
  });
});

describe('POST /api/voices/preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/voices/preview', {
      method: 'POST',
      body: JSON.stringify({ voiceId: 'voice-1', text: 'Hello world' }),
    });
    const response = await POST_PREVIEW(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 429 when rate limit is exceeded', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0 });

    const request = createRequest('http://localhost:3000/api/voices/preview', {
      method: 'POST',
      body: JSON.stringify({ voiceId: 'voice-1', text: 'Hello world' }),
    });
    const response = await POST_PREVIEW(request);
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toEqual({ error: 'Rate limit exceeded. Try again in a minute.' });
    expect(mockCheckRateLimit).toHaveBeenCalledWith('voice-preview:user-1', 10, 60);
  });

  it('returns 400 when voiceId is missing', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9 });

    const request = createRequest('http://localhost:3000/api/voices/preview', {
      method: 'POST',
      body: JSON.stringify({ text: 'Hello world' }),
    });
    const response = await POST_PREVIEW(request);

    expect(response.status).toBe(400);
  });

  it('returns 400 when text is missing', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9 });

    const request = createRequest('http://localhost:3000/api/voices/preview', {
      method: 'POST',
      body: JSON.stringify({ voiceId: 'voice-1' }),
    });
    const response = await POST_PREVIEW(request);

    expect(response.status).toBe(400);
  });

  it('returns 400 when text exceeds 500 characters', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9 });

    const request = createRequest('http://localhost:3000/api/voices/preview', {
      method: 'POST',
      body: JSON.stringify({ voiceId: 'voice-1', text: 'a'.repeat(501) }),
    });
    const response = await POST_PREVIEW(request);

    expect(response.status).toBe(400);
  });

  it('successfully generates voice preview audio', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9 });
    const mockAudioBuffer = Buffer.from('fake-audio-data');
    mockGenerateSpeech.mockResolvedValue(mockAudioBuffer);

    const request = createRequest('http://localhost:3000/api/voices/preview', {
      method: 'POST',
      body: JSON.stringify({ voiceId: 'voice-1', text: 'Hello world, this is a preview.' }),
    });
    const response = await POST_PREVIEW(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(response.headers.get('Content-Length')).toBe(mockAudioBuffer.length.toString());
    expect(mockGenerateSpeech).toHaveBeenCalledWith({
      text: 'Hello world, this is a preview.',
      voiceId: 'voice-1',
    });
  });

  it('respects rate limit of 10 requests per 60 seconds', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 5 });
    mockGenerateSpeech.mockResolvedValue(Buffer.from('audio'));

    const request = createRequest('http://localhost:3000/api/voices/preview', {
      method: 'POST',
      body: JSON.stringify({ voiceId: 'voice-1', text: 'Test' }),
    });
    await POST_PREVIEW(request);

    expect(mockCheckRateLimit).toHaveBeenCalledWith('voice-preview:user-1', 10, 60);
  });
});
