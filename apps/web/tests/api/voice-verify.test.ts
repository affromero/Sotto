import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---- Mocks ----

const mockAuth = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

const mockPrismaVoiceCloneFindUnique = vi.fn();
const mockPrismaVoiceVerificationChallengeFindFirst = vi.fn();
const mockPrismaVoiceVerificationChallengeUpdate = vi.fn().mockResolvedValue({});
const mockPrismaVoiceCloneUpdate = vi.fn().mockResolvedValue({});
const mockPrismaTransaction = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    voiceClone: {
      findUnique: (...args: unknown[]) => mockPrismaVoiceCloneFindUnique(...args),
      update: (...args: unknown[]) => mockPrismaVoiceCloneUpdate(...args),
    },
    voiceVerificationChallenge: {
      findFirst: (...args: unknown[]) => mockPrismaVoiceVerificationChallengeFindFirst(...args),
      update: (...args: unknown[]) => mockPrismaVoiceVerificationChallengeUpdate(...args),
    },
    $transaction: (...args: unknown[]) => mockPrismaTransaction(...args),
  },
}));

const mockUploadFile = vi.fn().mockResolvedValue('https://r2.example.com/recording.webm');

vi.mock('@/lib/r2', () => ({
  uploadFile: (...args: unknown[]) => mockUploadFile(...args),
}));

const mockAddJob = vi.fn().mockResolvedValue({ id: 'job-1' });

vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: {
    VERIFY_VOICE: 'verify_voice',
  },
  voiceVerificationQueue: { name: 'voice-verification' },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---- Import under test ----

import { GET, POST } from '@/app/api/v1/voices/verify/route';

// ---- Helpers ----

function createGetRequest(params?: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/v1/voices/verify');
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return new NextRequest(url, { method: 'GET' });
}

function createPostRequest(fields: Record<string, string>, includeAudio?: boolean): NextRequest {
  // Stub out the request then override formData() to avoid jsdom/undici FormData interop issues.
  const req = new NextRequest('http://localhost:3000/api/v1/voices/verify', {
    method: 'POST',
  });

  // Build a Map-like FormData stub that the route handler consumes via .get()
  const fakeFormData = {
    _data: new Map<string, string | File>(),
    get(key: string) { return this._data.get(key) ?? null; },
    has(key: string) { return this._data.has(key); },
  };
  for (const [k, v] of Object.entries(fields)) {
    fakeFormData._data.set(k, v);
  }
  if (includeAudio) {
    // The route does: `const audio = formData.get('audio') as File | null`
    // then calls audio.arrayBuffer(). Create a minimal File-like object
    // with explicit arrayBuffer() since jsdom's Blob may not provide it.
    const audioData = new TextEncoder().encode('audio-data');
    const audioFile = {
      name: 'recording.webm',
      type: 'audio/webm',
      size: audioData.byteLength,
      lastModified: Date.now(),
      arrayBuffer: () => Promise.resolve(audioData.buffer),
    };
    fakeFormData._data.set('audio', audioFile as unknown as File);
  }

  // Override formData() on the request instance
  (req as unknown as { formData: () => Promise<typeof fakeFormData> }).formData = () => Promise.resolve(fakeFormData);
  return req;
}

const mockSession = { user: { id: 'user-1' } };

// ---- Tests ----

describe('GET /api/v1/voices/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await GET(createGetRequest({ voiceCloneId: 'clone-1' }));

    expect(response.status).toBe(401);
  });

  it('returns 400 when voiceCloneId is missing', async () => {
    mockAuth.mockResolvedValue(mockSession);

    const response = await GET(createGetRequest());

    expect(response.status).toBe(400);
  });

  it('returns 404 when voice clone does not exist', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrismaVoiceCloneFindUnique.mockResolvedValue(null);

    const response = await GET(createGetRequest({ voiceCloneId: 'clone-missing' }));

    expect(response.status).toBe(404);
  });

  it('returns 403 when user does not own the voice clone', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrismaVoiceCloneFindUnique.mockResolvedValue({
      userId: 'user-other',
      verificationStatus: 'AWAITING_CHALLENGE',
    });

    const response = await GET(createGetRequest({ voiceCloneId: 'clone-1' }));

    expect(response.status).toBe(403);
  });

  it('returns null challenge when status is not AWAITING_CHALLENGE', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrismaVoiceCloneFindUnique.mockResolvedValue({
      userId: 'user-1',
      verificationStatus: 'VERIFIED',
    });

    const response = await GET(createGetRequest({ voiceCloneId: 'clone-1' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ challenge: null });
  });

  it('returns the active challenge when status is AWAITING_CHALLENGE', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrismaVoiceCloneFindUnique.mockResolvedValue({
      userId: 'user-1',
      verificationStatus: 'AWAITING_CHALLENGE',
    });

    const expiresAt = new Date(Date.now() + 600000);
    mockPrismaVoiceVerificationChallengeFindFirst.mockResolvedValue({
      id: 'challenge-1',
      phrase: 'The quick brown fox',
      attemptNumber: 1,
      expiresAt,
    });

    const response = await GET(createGetRequest({ voiceCloneId: 'clone-1' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.challenge).toMatchObject({
      id: 'challenge-1',
      phrase: 'The quick brown fox',
      attemptNumber: 1,
    });
  });
});

describe('POST /api/v1/voices/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrismaTransaction.mockImplementation(async (args: unknown) => {
      if (Array.isArray(args)) return Promise.all(args);
      return args;
    });
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await POST(createPostRequest({ voiceCloneId: 'clone-1' }, true));

    expect(response.status).toBe(401);
  });

  it('returns 400 when voiceCloneId is missing', async () => {
    mockAuth.mockResolvedValue(mockSession);

    const response = await POST(createPostRequest({}, true));

    expect(response.status).toBe(400);
  });

  it('returns 400 when audio file is missing', async () => {
    mockAuth.mockResolvedValue(mockSession);

    const response = await POST(createPostRequest({ voiceCloneId: 'clone-1' }));

    expect(response.status).toBe(400);
  });

  it('returns 403 when user does not own the voice clone', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrismaVoiceCloneFindUnique.mockResolvedValue({
      userId: 'user-other',
      verificationStatus: 'AWAITING_CHALLENGE',
    });

    const response = await POST(createPostRequest({ voiceCloneId: 'clone-1' }, true));

    expect(response.status).toBe(403);
  });

  it('returns 409 when voice is not awaiting challenge', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrismaVoiceCloneFindUnique.mockResolvedValue({
      userId: 'user-1',
      verificationStatus: 'VERIFIED',
    });

    const response = await POST(createPostRequest({ voiceCloneId: 'clone-1' }, true));

    expect(response.status).toBe(409);
  });

  it('returns 410 when challenge has expired', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrismaVoiceCloneFindUnique.mockResolvedValue({
      userId: 'user-1',
      verificationStatus: 'AWAITING_CHALLENGE',
    });
    mockPrismaVoiceVerificationChallengeFindFirst.mockResolvedValue({
      id: 'challenge-1',
      attemptNumber: 1,
      expiresAt: new Date(Date.now() - 60000), // expired 1 minute ago
    });

    const response = await POST(createPostRequest({ voiceCloneId: 'clone-1' }, true));

    expect(response.status).toBe(410);
  });

  it('uploads recording and queues verification on success', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrismaVoiceCloneFindUnique.mockResolvedValue({
      userId: 'user-1',
      verificationStatus: 'AWAITING_CHALLENGE',
    });
    mockPrismaVoiceVerificationChallengeFindFirst.mockResolvedValue({
      id: 'challenge-1',
      attemptNumber: 1,
      expiresAt: new Date(Date.now() + 600000), // 10 minutes from now
    });

    const response = await POST(createPostRequest({ voiceCloneId: 'clone-1' }, true));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ submitted: true });

    // Uploaded recording to R2
    expect(mockUploadFile).toHaveBeenCalledWith(
      'voice-clones/clone-1/challenge-1.webm',
      expect.any(Buffer),
      'audio/webm'
    );

    // Updated challenge and voice clone status via transaction
    expect(mockPrismaTransaction).toHaveBeenCalled();

    // Queued verification job
    expect(mockAddJob).toHaveBeenCalledWith(
      { name: 'voice-verification' },
      'verify_voice',
      expect.objectContaining({
        voiceCloneId: 'clone-1',
        userId: 'user-1',
        action: 'verify_challenge',
        challengeId: 'challenge-1',
      })
    );
  });

  it('returns 409 when no active challenge exists', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPrismaVoiceCloneFindUnique.mockResolvedValue({
      userId: 'user-1',
      verificationStatus: 'AWAITING_CHALLENGE',
    });
    mockPrismaVoiceVerificationChallengeFindFirst.mockResolvedValue(null);

    const response = await POST(createPostRequest({ voiceCloneId: 'clone-1' }, true));

    expect(response.status).toBe(409);
  });
});
