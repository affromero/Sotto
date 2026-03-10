import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---- Mocks ----

const mockAuthenticateRequest = vi.fn();
const mockRequireAdmin = vi.fn();
const mockCheckMusicGenerationGate = vi.fn();
const mockTryIncrementMusicGeneration = vi.fn();
const mockAddJob = vi.fn();
const mockDeleteFile = vi.fn();
const mockExtractR2Key = vi.fn();

const mockPodcastFindUnique = vi.fn();
const mockPodcastUpdate = vi.fn();
const mockMusicGenFindUnique = vi.fn();
const mockMusicGenCreate = vi.fn();
const mockMusicGenDelete = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
      update: (...args: unknown[]) => mockPodcastUpdate(...args),
    },
    musicGeneration: {
      findUnique: (...args: unknown[]) => mockMusicGenFindUnique(...args),
      create: (...args: unknown[]) => mockMusicGenCreate(...args),
      delete: (...args: unknown[]) => mockMusicGenDelete(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/auth-guards', () => ({
  requireAdmin: () => mockRequireAdmin(),
}));

vi.mock('@/lib/music-gate', () => ({
  checkMusicGenerationGate: (...args: unknown[]) => mockCheckMusicGenerationGate(...args),
  tryIncrementMusicGeneration: (...args: unknown[]) => mockTryIncrementMusicGeneration(...args),
}));

vi.mock('@/lib/validations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/validations')>('@/lib/validations');
  return actual;
});

vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: { GENERATE_MUSIC: 'generate_music' },
  musicGenerationQueue: 'music-gen-queue',
}));

vi.mock('@/lib/r2', () => ({
  deleteFile: (...args: unknown[]) => mockDeleteFile(...args),
  extractR2Key: (...args: unknown[]) => mockExtractR2Key(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/api-response', () => ({
  errorResponse: (error: string, status: number, meta?: Record<string, unknown>) => {
    const body = meta ? { error, ...meta } : { error };
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  },
}));

// ---- Import under test ----

import { POST, GET, DELETE } from '@/app/api/podcasts/[podcastId]/music/route';
import { PATCH } from '@/app/api/podcasts/[podcastId]/music/volume/route';

// ---- Helpers ----

function createPostRequest(body?: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/podcasts/pod-1/music'), {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'Content-Type': 'application/json' } : {},
  });
}

function createGetRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/podcasts/pod-1/music'), {
    method: 'GET',
  });
}

function createDeleteRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/podcasts/pod-1/music'), {
    method: 'DELETE',
  });
}

function createPatchRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/podcasts/pod-1/music/volume'), {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const routeParams = { params: Promise.resolve({ podcastId: 'pod-1' }) };

// ---- Tests: POST /api/podcasts/[id]/music ----

describe('POST /api/podcasts/[id]/music', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockRequireAdmin.mockResolvedValue(null);
    mockCheckMusicGenerationGate.mockResolvedValue({
      allowed: true,
      reason: 'ok',
      dailyUsed: 0,
      dailyLimit: 1,
      dailyRemaining: 1,
      isByokUser: false,
      isProUser: false,
    });
    mockTryIncrementMusicGeneration.mockResolvedValue(true);
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'user-1', status: 'READY' });
    mockMusicGenFindUnique.mockResolvedValue(null);
    mockMusicGenCreate.mockResolvedValue({ id: 'mg-1', podcastId: 'pod-1', status: 'PENDING' });
    mockAddJob.mockResolvedValue({});
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    const res = await POST(createPostRequest(), routeParams);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 404 when podcast not found', async () => {
    mockPodcastFindUnique.mockResolvedValue(null);
    const res = await POST(createPostRequest(), routeParams);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'Podcast not found' });
  });

  it('returns 403 when user is not the owner and not admin', async () => {
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'other-user', status: 'READY' });
    const res = await POST(createPostRequest(), routeParams);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'Forbidden' });
  });

  it('returns 400 when podcast is not READY', async () => {
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'user-1', status: 'SCRIPTING' });
    const res = await POST(createPostRequest(), routeParams);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('READY');
  });

  it('returns 429 when daily music limit is reached', async () => {
    mockCheckMusicGenerationGate.mockResolvedValue({
      allowed: false,
      reason: 'daily_limit_reached',
      dailyUsed: 1,
      dailyLimit: 1,
      dailyRemaining: 0,
      resetInSeconds: 3600,
      isByokUser: false,
      isProUser: false,
    });
    const res = await POST(createPostRequest(), routeParams);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe('daily_limit_reached');
    expect(body.dailyUsed).toBe(1);
    expect(body.resetInSeconds).toBe(3600);
  });

  it('returns 403 when no music provider available', async () => {
    mockCheckMusicGenerationGate.mockResolvedValue({
      allowed: false,
      reason: 'no_music_provider',
      dailyUsed: 0,
      dailyLimit: 1,
      dailyRemaining: 1,
      isByokUser: false,
      isProUser: false,
    });
    const res = await POST(createPostRequest(), routeParams);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('no_music_provider');
  });

  it('queues music generation for a valid request', async () => {
    const res = await POST(createPostRequest(), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.musicGenerationId).toBe('mg-1');
    expect(body.status).toBe('PENDING');

    expect(mockMusicGenCreate).toHaveBeenCalledWith({
      data: {
        podcastId: 'pod-1',
        status: 'PENDING',
        model: null,
      },
    });

    expect(mockAddJob).toHaveBeenCalledWith('music-gen-queue', 'generate_music', {
      podcastId: 'pod-1',
      musicGenerationId: 'mg-1',
      userId: 'user-1',
    });
  });

  it('passes optional model from request body', async () => {
    const res = await POST(createPostRequest({ model: 'suno-v4' }), routeParams);
    expect(res.status).toBe(200);

    expect(mockMusicGenCreate).toHaveBeenCalledWith({
      data: {
        podcastId: 'pod-1',
        status: 'PENDING',
        model: 'suno-v4',
      },
    });
  });

  it('returns existing generation when one is in progress (idempotency)', async () => {
    mockMusicGenFindUnique.mockResolvedValue({
      id: 'mg-existing',
      status: 'GENERATING',
      musicUrl: null,
    });

    const res = await POST(createPostRequest(), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.musicGenerationId).toBe('mg-existing');
    expect(body.status).toBe('GENERATING');

    expect(mockMusicGenCreate).not.toHaveBeenCalled();
    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it('returns existing completed generation (idempotency)', async () => {
    mockMusicGenFindUnique.mockResolvedValue({
      id: 'mg-done',
      status: 'COMPLETED',
      musicUrl: 'https://r2.example.com/music.mp3',
    });

    const res = await POST(createPostRequest(), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.musicGenerationId).toBe('mg-done');
    expect(body.musicUrl).toBe('https://r2.example.com/music.mp3');

    expect(mockMusicGenCreate).not.toHaveBeenCalled();
  });

  it('deletes failed generation and creates a new one', async () => {
    mockMusicGenFindUnique.mockResolvedValue({
      id: 'mg-failed',
      status: 'FAILED',
      musicUrl: null,
    });

    const res = await POST(createPostRequest(), routeParams);
    expect(res.status).toBe(200);

    expect(mockMusicGenDelete).toHaveBeenCalledWith({ where: { id: 'mg-failed' } });
    expect(mockMusicGenCreate).toHaveBeenCalled();
    expect(mockAddJob).toHaveBeenCalled();
  });

  it('returns 429 when atomic increment fails (TOCTOU race)', async () => {
    mockTryIncrementMusicGeneration.mockResolvedValue(false);
    const res = await POST(createPostRequest(), routeParams);
    expect(res.status).toBe(429);
  });

  it('skips daily counter for BYOK users', async () => {
    mockCheckMusicGenerationGate.mockResolvedValue({
      allowed: true,
      reason: 'ok',
      dailyUsed: 0,
      dailyLimit: 1,
      dailyRemaining: Infinity,
      isByokUser: true,
      isProUser: false,
    });

    const res = await POST(createPostRequest(), routeParams);
    expect(res.status).toBe(200);
    expect(mockTryIncrementMusicGeneration).not.toHaveBeenCalled();
  });

  it('skips gate check and daily counter for admin users', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');

    const res = await POST(createPostRequest(), routeParams);
    expect(res.status).toBe(200);
    expect(mockCheckMusicGenerationGate).not.toHaveBeenCalled();
    expect(mockTryIncrementMusicGeneration).not.toHaveBeenCalled();
  });

  it('allows admin to generate music for another user podcast', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'other-user', status: 'READY' });

    const res = await POST(createPostRequest(), routeParams);
    expect(res.status).toBe(200);
  });
});

// ---- Tests: GET /api/podcasts/[id]/music ----

describe('GET /api/podcasts/[id]/music', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockRequireAdmin.mockResolvedValue(null);
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'user-1' });
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    const res = await GET(createGetRequest(), routeParams);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 404 when podcast not found', async () => {
    mockPodcastFindUnique.mockResolvedValue(null);
    const res = await GET(createGetRequest(), routeParams);
    expect(res.status).toBe(404);
  });

  it('returns 403 when user is not the owner and not admin', async () => {
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'other-user' });
    const res = await GET(createGetRequest(), routeParams);
    expect(res.status).toBe(403);
  });

  it('returns { status: null } when no music generation exists', async () => {
    mockMusicGenFindUnique.mockResolvedValue(null);
    const res = await GET(createGetRequest(), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: null });
  });

  it('returns music generation record when it exists', async () => {
    const createdAt = new Date().toISOString();
    mockMusicGenFindUnique.mockResolvedValue({
      id: 'mg-1',
      status: 'COMPLETED',
      musicUrl: 'https://r2.example.com/music.mp3',
      duration: 120.5,
      fileSize: 1024000,
      provider: 'suno',
      model: 'suno-v4',
      failureReason: null,
      createdAt,
    });

    const res = await GET(createGetRequest(), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      musicGenerationId: 'mg-1',
      status: 'COMPLETED',
      musicUrl: 'https://r2.example.com/music.mp3',
      duration: 120.5,
      fileSize: 1024000,
      provider: 'suno',
      model: 'suno-v4',
      failureReason: null,
      createdAt,
    });
  });

  it('returns failure reason when generation failed', async () => {
    mockMusicGenFindUnique.mockResolvedValue({
      id: 'mg-1',
      status: 'FAILED',
      musicUrl: null,
      duration: null,
      fileSize: null,
      provider: 'suno',
      model: 'suno-v4',
      failureReason: 'Provider timeout',
      createdAt: new Date().toISOString(),
    });

    const res = await GET(createGetRequest(), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('FAILED');
    expect(body.failureReason).toBe('Provider timeout');
  });

  it('allows admin to poll status for another user podcast', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'other-user' });
    mockMusicGenFindUnique.mockResolvedValue(null);

    const res = await GET(createGetRequest(), routeParams);
    expect(res.status).toBe(200);
  });
});

// ---- Tests: DELETE /api/podcasts/[id]/music ----

describe('DELETE /api/podcasts/[id]/music', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockRequireAdmin.mockResolvedValue(null);
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'user-1' });
    mockMusicGenFindUnique.mockResolvedValue({
      id: 'mg-1',
      musicUrl: 'https://r2.example.com/music/pod-1.mp3',
    });
    mockExtractR2Key.mockReturnValue('music/pod-1.mp3');
    mockDeleteFile.mockResolvedValue(undefined);
    mockMusicGenDelete.mockResolvedValue({});
    mockPodcastUpdate.mockResolvedValue({});
    mockTransaction.mockImplementation(async (ops: unknown[]) => {
      for (const op of ops as Promise<unknown>[]) {
        await op;
      }
    });
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    const res = await DELETE(createDeleteRequest(), routeParams);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 404 when podcast not found', async () => {
    mockPodcastFindUnique.mockResolvedValue(null);
    const res = await DELETE(createDeleteRequest(), routeParams);
    expect(res.status).toBe(404);
  });

  it('returns 403 when user is not the owner and not admin', async () => {
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'other-user' });
    const res = await DELETE(createDeleteRequest(), routeParams);
    expect(res.status).toBe(403);
  });

  it('returns 404 when no music generation exists', async () => {
    mockMusicGenFindUnique.mockResolvedValue(null);
    const res = await DELETE(createDeleteRequest(), routeParams);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'No music generation found' });
  });

  it('deletes R2 file, music generation record, and clears podcast musicUrl', async () => {
    const res = await DELETE(createDeleteRequest(), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });

    expect(mockExtractR2Key).toHaveBeenCalledWith('https://r2.example.com/music/pod-1.mp3');
    expect(mockDeleteFile).toHaveBeenCalledWith('music/pod-1.mp3');
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it('succeeds even when music generation has no musicUrl', async () => {
    mockMusicGenFindUnique.mockResolvedValue({ id: 'mg-1', musicUrl: null });
    const res = await DELETE(createDeleteRequest(), routeParams);
    expect(res.status).toBe(200);
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it('succeeds even when R2 deletion fails (logs warning)', async () => {
    mockDeleteFile.mockRejectedValue(new Error('R2 timeout'));
    const res = await DELETE(createDeleteRequest(), routeParams);
    expect(res.status).toBe(200);
  });

  it('allows admin to delete music for another user podcast', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'other-user' });

    const res = await DELETE(createDeleteRequest(), routeParams);
    expect(res.status).toBe(200);
  });
});

// ---- Tests: PATCH /api/podcasts/[id]/music/volume ----

describe('PATCH /api/podcasts/[id]/music/volume', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockRequireAdmin.mockResolvedValue(null);
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'user-1' });
    mockPodcastUpdate.mockResolvedValue({});
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    const res = await PATCH(createPatchRequest({ volume: 0.5 }), routeParams);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 404 when podcast not found', async () => {
    mockPodcastFindUnique.mockResolvedValue(null);
    const res = await PATCH(createPatchRequest({ volume: 0.5 }), routeParams);
    expect(res.status).toBe(404);
  });

  it('returns 403 when user is not the owner and not admin', async () => {
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'other-user' });
    const res = await PATCH(createPatchRequest({ volume: 0.5 }), routeParams);
    expect(res.status).toBe(403);
  });

  it('updates volume and returns new value', async () => {
    const res = await PATCH(createPatchRequest({ volume: 0.75 }), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ volume: 0.75 });

    expect(mockPodcastUpdate).toHaveBeenCalledWith({
      where: { id: 'pod-1' },
      data: { musicVolume: 0.75 },
    });
  });

  it('accepts volume of 0 (mute)', async () => {
    const res = await PATCH(createPatchRequest({ volume: 0 }), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ volume: 0 });
  });

  it('accepts volume of 1 (max)', async () => {
    const res = await PATCH(createPatchRequest({ volume: 1 }), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ volume: 1 });
  });

  it('rejects volume below 0', async () => {
    const res = await PATCH(createPatchRequest({ volume: -0.1 }), routeParams);
    expect(res.status).toBe(400);
  });

  it('rejects volume above 1', async () => {
    const res = await PATCH(createPatchRequest({ volume: 1.5 }), routeParams);
    expect(res.status).toBe(400);
  });

  it('rejects missing volume field', async () => {
    const res = await PATCH(createPatchRequest({}), routeParams);
    expect(res.status).toBe(400);
  });

  it('rejects non-numeric volume', async () => {
    const res = await PATCH(createPatchRequest({ volume: 'loud' }), routeParams);
    expect(res.status).toBe(400);
  });

  it('allows admin to update volume for another user podcast', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'other-user' });

    const res = await PATCH(createPatchRequest({ volume: 0.3 }), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ volume: 0.3 });
  });
});
