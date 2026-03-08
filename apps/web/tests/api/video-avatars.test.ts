import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockRequireAdmin = vi.fn();
const mockCheckAvatarGenerationGate = vi.fn();
const mockTryIncrementAvatarGeneration = vi.fn();
const mockListAvatars = vi.fn();
const mockDeleteFile = vi.fn();

const mockPodcastFindUnique = vi.fn();
const mockVideoGenFindUnique = vi.fn();
const mockVideoGenUpdate = vi.fn();
const mockAvatarOverlayUpsert = vi.fn();
const mockAvatarOverlayDeleteMany = vi.fn();
const mockAvatarOverlayUpdateMany = vi.fn();
const mockAddJob = vi.fn();

const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    podcast: { findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args) },
    videoGeneration: {
      findUnique: (...args: unknown[]) => mockVideoGenFindUnique(...args),
      update: (...args: unknown[]) => mockVideoGenUpdate(...args),
    },
    avatarOverlay: {
      upsert: (...args: unknown[]) => mockAvatarOverlayUpsert(...args),
      deleteMany: (...args: unknown[]) => mockAvatarOverlayDeleteMany(...args),
      updateMany: (...args: unknown[]) => mockAvatarOverlayUpdateMany(...args),
    },
  },
}));

vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: { GENERATE_AVATAR: 'generate_avatar' },
  avatarGenerationQueue: { name: 'avatar-generation' },
}));

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/auth-guards', () => ({
  requireAdmin: () => mockRequireAdmin(),
}));

vi.mock('@/lib/video-gate', () => ({
  checkAvatarGenerationGate: (...args: unknown[]) => mockCheckAvatarGenerationGate(...args),
  tryIncrementAvatarGeneration: (...args: unknown[]) => mockTryIncrementAvatarGeneration(...args),
}));

vi.mock('@/lib/heygen', () => ({
  listAvatars: (...args: unknown[]) => mockListAvatars(...args),
}));

vi.mock('@/lib/r2', () => ({
  deleteFile: (...args: unknown[]) => mockDeleteFile(...args),
  extractR2Key: vi.fn((url: string) => url),
}));

vi.mock('@/lib/redis', () => ({
  createRedisConnection: () => ({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  }),
}));

vi.mock('@/lib/validations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/validations')>('@/lib/validations');
  return actual;
});

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/api-response', () => ({
  errorResponse: (error: string, status: number) =>
    new Response(JSON.stringify({ error }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
}));

function makeGet(url: string) {
  return new NextRequest(new URL(url, 'http://localhost'));
}

function makeJson(url: string, method: string, body?: unknown) {
  return new NextRequest(new URL(url, 'http://localhost'), {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'Content-Type': 'application/json' } : {},
  });
}

const routeParams = { params: Promise.resolve({ podcastId: 'pod-1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
  mockRequireAdmin.mockResolvedValue(null);
  process.env.HEYGEN_API_KEY = 'test-heygen-key';
});

describe('GET /api/podcasts/[podcastId]/video/avatars', () => {
  it('returns cached avatars from Redis', async () => {
    const { GET } = await import('@/app/api/podcasts/[podcastId]/video/avatars/route');
    mockCheckAvatarGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok', dailyUsed: 0, dailyLimit: 1, dailyRemaining: 1, isByokUser: false, isProUser: false });
    const cached = [{ avatar_id: 'av-1', avatar_name: 'Test' }];
    mockRedisGet.mockResolvedValue(JSON.stringify(cached));

    const res = await GET(makeGet('http://localhost/api/podcasts/pod-1/video/avatars'), routeParams);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.avatars).toEqual(cached);
    expect(mockListAvatars).not.toHaveBeenCalled();
  });

  it('fetches from HeyGen and filters premium avatars', async () => {
    const { GET } = await import('@/app/api/podcasts/[podcastId]/video/avatars/route');
    mockCheckAvatarGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok', dailyUsed: 0, dailyLimit: 1, dailyRemaining: 1, isByokUser: false, isProUser: false });
    mockRedisGet.mockResolvedValue(null);
    mockListAvatars.mockResolvedValue([
      { avatar_id: 'av-1', avatar_name: 'Free', premium: false },
      { avatar_id: 'av-2', avatar_name: 'Premium', premium: true },
    ]);

    const res = await GET(makeGet('http://localhost/api/podcasts/pod-1/video/avatars'), routeParams);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.avatars).toHaveLength(1);
    expect(data.avatars[0].avatar_id).toBe('av-1');
  });

  it('rejects unauthorized requests', async () => {
    const { GET } = await import('@/app/api/podcasts/[podcastId]/video/avatars/route');
    mockAuthenticateRequest.mockResolvedValue(null);

    const res = await GET(makeGet('http://localhost/api/podcasts/pod-1/video/avatars'), routeParams);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/podcasts/[podcastId]/video/avatars', () => {
  it('creates avatar overlays and auto-starts generation when video is READY', async () => {
    const { POST } = await import('@/app/api/podcasts/[podcastId]/video/avatars/route');
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'user-1', status: 'READY', duration: 300 });
    mockVideoGenFindUnique.mockResolvedValue({ id: 'vg-1', status: 'READY' });
    mockVideoGenUpdate.mockResolvedValue({});
    mockCheckAvatarGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok', dailyUsed: 0, dailyLimit: 1, dailyRemaining: 1, isByokUser: true, isProUser: false });
    mockAvatarOverlayUpsert.mockImplementation(({ create }: { create: Record<string, unknown> }) => ({
      id: `overlay-${create.speaker}`,
      ...create,
    }));

    const res = await POST(
      makeJson('http://localhost/api/podcasts/pod-1/video/avatars', 'POST', { avatars: [{ speaker: 'Host', avatarId: 'av-1' }] }),
      routeParams,
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.overlays).toHaveLength(1);
    expect(data.videoGenerationId).toBe('vg-1');
    expect(data.generationStarted).toBe(true);
    expect(mockAvatarOverlayUpsert).toHaveBeenCalledTimes(1);
    // Should transition to GENERATING_AVATARS
    expect(mockVideoGenUpdate).toHaveBeenCalledWith({
      where: { id: 'vg-1' },
      data: { status: 'GENERATING_AVATARS' },
    });
    // Should queue avatar generation job
    expect(mockAddJob).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'avatar-generation' }),
      'generate_avatar',
      expect.objectContaining({ podcastId: 'pod-1', videoGenerationId: 'vg-1', speaker: 'Host', avatarId: 'av-1' }),
    );
  });

  it('creates overlays without auto-start when video is still generating', async () => {
    const { POST } = await import('@/app/api/podcasts/[podcastId]/video/avatars/route');
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'user-1', status: 'READY', duration: 300 });
    mockVideoGenFindUnique.mockResolvedValue({ id: 'vg-1', status: 'GENERATING_VISUALS' });
    mockAvatarOverlayUpsert.mockImplementation(({ create }: { create: Record<string, unknown> }) => ({
      id: `overlay-${create.speaker}`,
      ...create,
    }));

    const res = await POST(
      makeJson('http://localhost/api/podcasts/pod-1/video/avatars', 'POST', { avatars: [{ speaker: 'Host', avatarId: 'av-1' }] }),
      routeParams,
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.generationStarted).toBe(false);
    expect(mockVideoGenUpdate).not.toHaveBeenCalled();
    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it('rejects podcasts exceeding 600s duration', async () => {
    const { POST } = await import('@/app/api/podcasts/[podcastId]/video/avatars/route');
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'user-1', status: 'READY', duration: 700 });

    const res = await POST(
      makeJson('http://localhost/api/podcasts/pod-1/video/avatars', 'POST', { avatars: [{ speaker: 'Host', avatarId: 'av-1' }] }),
      routeParams,
    );

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/too long/i);
  });

  it('rejects when podcast is not READY', async () => {
    const { POST } = await import('@/app/api/podcasts/[podcastId]/video/avatars/route');
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'user-1', status: 'GENERATING_AUDIO', duration: 300 });

    const res = await POST(
      makeJson('http://localhost/api/podcasts/pod-1/video/avatars', 'POST', { avatars: [{ speaker: 'Host', avatarId: 'av-1' }] }),
      routeParams,
    );

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/podcasts/[podcastId]/video/avatars', () => {
  it('deletes overlays and R2 assets', async () => {
    const { DELETE } = await import('@/app/api/podcasts/[podcastId]/video/avatars/route');
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'user-1' });
    mockVideoGenFindUnique.mockResolvedValue({
      id: 'vg-1',
      avatarOverlays: [
        { id: 'o-1', videoUrl: 'r2://avatar.webm', concatAudioUrl: 'r2://concat.mp3' },
      ],
    });
    mockDeleteFile.mockResolvedValue(undefined);
    mockAvatarOverlayDeleteMany.mockResolvedValue({ count: 1 });

    const res = await DELETE(
      makeJson('http://localhost/api/podcasts/pod-1/video/avatars', 'DELETE'),
      routeParams,
    );

    expect(res.status).toBe(200);
    expect(mockDeleteFile).toHaveBeenCalledTimes(2);
    expect(mockAvatarOverlayDeleteMany).toHaveBeenCalled();
  });
});

describe('PATCH /api/podcasts/[podcastId]/video/avatars/positions', () => {
  it('updates avatar positions', async () => {
    const { PATCH } = await import('@/app/api/podcasts/[podcastId]/video/avatars/positions/route');
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'user-1' });
    mockVideoGenFindUnique.mockResolvedValue({ id: 'vg-1' });
    mockAvatarOverlayUpdateMany.mockResolvedValue({ count: 1 });

    const res = await PATCH(
      makeJson('http://localhost/api/podcasts/pod-1/video/avatars/positions', 'PATCH', {
          positions: [{ speaker: 'Host', posX: 0.1, posY: 0.5, width: 0.25, height: 0.35 }],
        }),
      routeParams,
    );

    expect(res.status).toBe(200);
    expect(mockAvatarOverlayUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { videoGenerationId: 'vg-1', speaker: 'Host' },
        data: { posX: 0.1, posY: 0.5, width: 0.25, height: 0.35 },
      }),
    );
  });

  it('rejects invalid position values', async () => {
    const { PATCH } = await import('@/app/api/podcasts/[podcastId]/video/avatars/positions/route');
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'user-1' });
    mockVideoGenFindUnique.mockResolvedValue({ id: 'vg-1' });

    const res = await PATCH(
      makeJson('http://localhost/api/podcasts/pod-1/video/avatars/positions', 'PATCH', {
          positions: [{ speaker: 'Host', posX: 1.5, posY: 0.5, width: 0.25, height: 0.35 }],
        }),
      routeParams,
    );

    expect(res.status).toBe(400);
  });
});
