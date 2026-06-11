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
const mockMusicGenFindFirst = vi.fn();
const mockMusicGenFindMany = vi.fn();
const mockMusicGenCreate = vi.fn();
const mockMusicGenDelete = vi.fn();
const mockMusicGenDeleteMany = vi.fn();
const mockMusicGenUpdate = vi.fn();
const mockMusicGenUpdateMany = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
      update: (...args: unknown[]) => mockPodcastUpdate(...args),
    },
    musicGeneration: {
      findFirst: (...args: unknown[]) => mockMusicGenFindFirst(...args),
      findMany: (...args: unknown[]) => mockMusicGenFindMany(...args),
      create: (...args: unknown[]) => mockMusicGenCreate(...args),
      delete: (...args: unknown[]) => mockMusicGenDelete(...args),
      deleteMany: (...args: unknown[]) => mockMusicGenDeleteMany(...args),
      update: (...args: unknown[]) => mockMusicGenUpdate(...args),
      updateMany: (...args: unknown[]) => mockMusicGenUpdateMany(...args),
    },
    userTtsKey: {
      findMany: vi.fn().mockResolvedValue([]),
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
import { PATCH as PATCH_VOLUME } from '@/app/api/podcasts/[podcastId]/music/volume/route';
import { PATCH as PATCH_SELECT } from '@/app/api/podcasts/[podcastId]/music/select/route';

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

function createDeleteRequest(generationId?: string): NextRequest {
  const url = generationId
    ? `http://localhost:3000/api/podcasts/pod-1/music?generationId=${generationId}`
    : 'http://localhost:3000/api/podcasts/pod-1/music';
  return new NextRequest(new URL(url), { method: 'DELETE' });
}

function createPatchVolumeRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/podcasts/pod-1/music/volume'), {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function createSelectRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/podcasts/pod-1/music/select'), {
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
    });
    mockTryIncrementMusicGeneration.mockResolvedValue(true);
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'user-1', status: 'READY' });
    mockMusicGenFindFirst.mockResolvedValue(null);
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

  it('returns 403 when no music provider available', async () => {
    mockCheckMusicGenerationGate.mockResolvedValue({
      allowed: false,
      reason: 'no_music_provider',
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

  it('returns in-progress generation instead of creating a new one', async () => {
    mockMusicGenFindFirst.mockResolvedValue({
      id: 'mg-existing',
      status: 'GENERATING',
    });

    const res = await POST(createPostRequest(), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.musicGenerationId).toBe('mg-existing');
    expect(body.status).toBe('GENERATING');

    expect(mockMusicGenCreate).not.toHaveBeenCalled();
    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it('allows new generation when previous ones exist but none in progress', async () => {
    // findFirst for in-progress returns null (no PENDING/GENERATING)
    mockMusicGenFindFirst.mockResolvedValue(null);

    const res = await POST(createPostRequest(), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.musicGenerationId).toBe('mg-1');
    expect(mockMusicGenCreate).toHaveBeenCalled();
    expect(mockAddJob).toHaveBeenCalled();
  });

  it('starts generation for configured BYOK providers', async () => {
    mockCheckMusicGenerationGate.mockResolvedValue({
      allowed: true,
      reason: 'ok',
      hasByokKey: true,
    });

    const res = await POST(createPostRequest(), routeParams);
    expect(res.status).toBe(200);
    expect(mockTryIncrementMusicGeneration).not.toHaveBeenCalled();
  });

  it('skips the user gate for admin users', async () => {
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
    mockMusicGenFindMany.mockResolvedValue([]);
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

  it('returns empty generations array when none exist', async () => {
    mockMusicGenFindMany.mockResolvedValue([]);
    const res = await GET(createGetRequest(), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.generations).toEqual([]);
    expect(body.availableModels).toBeDefined();
  });

  it('returns all generations for the podcast', async () => {
    const createdAt = new Date().toISOString();
    mockMusicGenFindMany.mockResolvedValue([
      {
        id: 'mg-1',
        status: 'READY',
        musicUrl: 'https://r2.example.com/music1.mp3',
        duration: 120,
        fileSize: 1024000,
        provider: 'suno',
        model: 'suno-v5',
        failureReason: null,
        selected: true,
        createdAt,
      },
      {
        id: 'mg-2',
        status: 'READY',
        musicUrl: 'https://r2.example.com/music2.mp3',
        duration: 115,
        fileSize: 980000,
        provider: 'suno',
        model: 'suno-v4',
        failureReason: null,
        selected: false,
        createdAt,
      },
    ]);

    const res = await GET(createGetRequest(), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.generations).toHaveLength(2);
    expect(body.generations[0].id).toBe('mg-1');
    expect(body.generations[0].selected).toBe(true);
    expect(body.generations[1].selected).toBe(false);
  });

  it('returns failure reason for failed generations', async () => {
    mockMusicGenFindMany.mockResolvedValue([
      {
        id: 'mg-1',
        status: 'FAILED',
        musicUrl: null,
        duration: null,
        fileSize: null,
        provider: 'suno',
        model: 'suno-v4',
        failureReason: 'Provider timeout',
        selected: false,
        createdAt: new Date().toISOString(),
      },
    ]);

    const res = await GET(createGetRequest(), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.generations[0].status).toBe('FAILED');
    expect(body.generations[0].failureReason).toBe('Provider timeout');
  });

  it('allows admin to poll status for another user podcast', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'other-user' });
    mockMusicGenFindMany.mockResolvedValue([]);

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
    mockMusicGenFindFirst.mockResolvedValue({
      id: 'mg-1',
      musicUrl: 'https://r2.example.com/music/pod-1.mp3',
      selected: true,
    });
    mockMusicGenFindMany.mockResolvedValue([
      { id: 'mg-1', musicUrl: 'https://r2.example.com/music/pod-1.mp3' },
    ]);
    mockExtractR2Key.mockReturnValue('music/pod-1.mp3');
    mockDeleteFile.mockResolvedValue(undefined);
    mockMusicGenDelete.mockResolvedValue({});
    mockMusicGenDeleteMany.mockResolvedValue({ count: 1 });
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

  it('deletes a specific generation by generationId', async () => {
    const res = await DELETE(createDeleteRequest('mg-1'), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });

    expect(mockMusicGenFindFirst).toHaveBeenCalledWith({
      where: { id: 'mg-1', podcastId: 'pod-1' },
      select: { id: true, musicUrl: true, selected: true },
    });
    expect(mockExtractR2Key).toHaveBeenCalledWith('https://r2.example.com/music/pod-1.mp3');
    expect(mockDeleteFile).toHaveBeenCalledWith('music/pod-1.mp3');
  });

  it('clears Podcast.musicUrl when deleting the selected generation', async () => {
    mockMusicGenFindFirst.mockResolvedValue({
      id: 'mg-1',
      musicUrl: 'https://r2.example.com/music/pod-1.mp3',
      selected: true,
    });

    const res = await DELETE(createDeleteRequest('mg-1'), routeParams);
    expect(res.status).toBe(200);
    // Transaction should be called (delete + clear musicUrl)
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it('does not clear Podcast.musicUrl when deleting a non-selected generation', async () => {
    mockMusicGenFindFirst.mockResolvedValue({
      id: 'mg-2',
      musicUrl: 'https://r2.example.com/music/mg-2.mp3',
      selected: false,
    });

    const res = await DELETE(createDeleteRequest('mg-2'), routeParams);
    expect(res.status).toBe(200);
    // Should just delete the record, no transaction needed
    expect(mockMusicGenDelete).toHaveBeenCalledWith({ where: { id: 'mg-2' } });
  });

  it('returns 404 when specific generationId not found', async () => {
    mockMusicGenFindFirst.mockResolvedValue(null);
    const res = await DELETE(createDeleteRequest('mg-nonexistent'), routeParams);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'Music generation not found' });
  });

  it('deletes all generations when no generationId provided', async () => {
    mockMusicGenFindMany.mockResolvedValue([
      { id: 'mg-1', musicUrl: 'https://r2.example.com/music1.mp3' },
      { id: 'mg-2', musicUrl: 'https://r2.example.com/music2.mp3' },
    ]);

    const res = await DELETE(createDeleteRequest(), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it('succeeds when deleting generation with no musicUrl', async () => {
    mockMusicGenFindFirst.mockResolvedValue({ id: 'mg-1', musicUrl: null, selected: false });
    const res = await DELETE(createDeleteRequest('mg-1'), routeParams);
    expect(res.status).toBe(200);
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it('succeeds even when R2 deletion fails', async () => {
    mockDeleteFile.mockRejectedValue(new Error('R2 timeout'));
    const res = await DELETE(createDeleteRequest('mg-1'), routeParams);
    expect(res.status).toBe(200);
  });

  it('allows admin to delete music for another user podcast', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'other-user' });

    const res = await DELETE(createDeleteRequest('mg-1'), routeParams);
    expect(res.status).toBe(200);
  });
});

// ---- Tests: PATCH /api/podcasts/[id]/music/select ----

describe('PATCH /api/podcasts/[id]/music/select', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockRequireAdmin.mockResolvedValue(null);
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'user-1' });
    mockMusicGenFindFirst.mockResolvedValue({
      id: 'mg-2',
      status: 'READY',
      musicUrl: 'https://r2.example.com/music2.mp3',
    });
    mockMusicGenUpdateMany.mockResolvedValue({ count: 1 });
    mockMusicGenUpdate.mockResolvedValue({});
    mockPodcastUpdate.mockResolvedValue({});
    mockTransaction.mockImplementation(async (ops: unknown[]) => {
      for (const op of ops as Promise<unknown>[]) {
        await op;
      }
    });
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    const res = await PATCH_SELECT(createSelectRequest({ generationId: 'mg-2' }), routeParams);
    expect(res.status).toBe(401);
  });

  it('returns 404 when podcast not found', async () => {
    mockPodcastFindUnique.mockResolvedValue(null);
    const res = await PATCH_SELECT(createSelectRequest({ generationId: 'mg-2' }), routeParams);
    expect(res.status).toBe(404);
  });

  it('returns 403 when user is not the owner and not admin', async () => {
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'other-user' });
    const res = await PATCH_SELECT(createSelectRequest({ generationId: 'mg-2' }), routeParams);
    expect(res.status).toBe(403);
  });

  it('returns 400 when body is invalid', async () => {
    const res = await PATCH_SELECT(createSelectRequest({}), routeParams);
    expect(res.status).toBe(400);
  });

  it('returns 404 when generation not found', async () => {
    mockMusicGenFindFirst.mockResolvedValue(null);
    const res = await PATCH_SELECT(createSelectRequest({ generationId: 'mg-nonexistent' }), routeParams);
    expect(res.status).toBe(404);
  });

  it('returns 400 when generation is not READY', async () => {
    mockMusicGenFindFirst.mockResolvedValue({
      id: 'mg-2',
      status: 'GENERATING',
      musicUrl: null,
    });
    const res = await PATCH_SELECT(createSelectRequest({ generationId: 'mg-2' }), routeParams);
    expect(res.status).toBe(400);
  });

  it('selects a generation and updates Podcast.musicUrl', async () => {
    const res = await PATCH_SELECT(createSelectRequest({ generationId: 'mg-2' }), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.musicUrl).toBe('https://r2.example.com/music2.mp3');

    // Transaction: deselect all, select target, update podcast
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it('allows admin to select for another user podcast', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'other-user' });

    const res = await PATCH_SELECT(createSelectRequest({ generationId: 'mg-2' }), routeParams);
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
    const res = await PATCH_VOLUME(createPatchVolumeRequest({ volume: 0.5 }), routeParams);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 404 when podcast not found', async () => {
    mockPodcastFindUnique.mockResolvedValue(null);
    const res = await PATCH_VOLUME(createPatchVolumeRequest({ volume: 0.5 }), routeParams);
    expect(res.status).toBe(404);
  });

  it('returns 403 when user is not the owner and not admin', async () => {
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'other-user' });
    const res = await PATCH_VOLUME(createPatchVolumeRequest({ volume: 0.5 }), routeParams);
    expect(res.status).toBe(403);
  });

  it('updates volume and returns new value', async () => {
    const res = await PATCH_VOLUME(createPatchVolumeRequest({ volume: 0.75 }), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ volume: 0.75 });

    expect(mockPodcastUpdate).toHaveBeenCalledWith({
      where: { id: 'pod-1' },
      data: { musicVolume: 0.75 },
    });
  });

  it('accepts volume of 0 (mute)', async () => {
    const res = await PATCH_VOLUME(createPatchVolumeRequest({ volume: 0 }), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ volume: 0 });
  });

  it('accepts volume of 1 (max)', async () => {
    const res = await PATCH_VOLUME(createPatchVolumeRequest({ volume: 1 }), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ volume: 1 });
  });

  it('rejects volume below 0', async () => {
    const res = await PATCH_VOLUME(createPatchVolumeRequest({ volume: -0.1 }), routeParams);
    expect(res.status).toBe(400);
  });

  it('rejects volume above 1', async () => {
    const res = await PATCH_VOLUME(createPatchVolumeRequest({ volume: 1.5 }), routeParams);
    expect(res.status).toBe(400);
  });

  it('rejects missing volume field', async () => {
    const res = await PATCH_VOLUME(createPatchVolumeRequest({}), routeParams);
    expect(res.status).toBe(400);
  });

  it('rejects non-numeric volume', async () => {
    const res = await PATCH_VOLUME(createPatchVolumeRequest({ volume: 'loud' }), routeParams);
    expect(res.status).toBe(400);
  });

  it('allows admin to update volume for another user podcast', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'other-user' });

    const res = await PATCH_VOLUME(createPatchVolumeRequest({ volume: 0.3 }), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ volume: 0.3 });
  });
});
