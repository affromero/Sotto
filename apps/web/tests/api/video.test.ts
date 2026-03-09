import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockRequireAdmin = vi.fn();
const mockCheckVideoGenerationGate = vi.fn();
const mockTryIncrementVideoGeneration = vi.fn();
const mockAddJob = vi.fn();

const mockPodcastFindUnique = vi.fn();
const mockVideoGenFindUnique = vi.fn();
const mockVideoGenCreate = vi.fn();
const mockSegmentVisualCreateMany = vi.fn();
const mockSegmentVisualDeleteMany = vi.fn();
const mockSegmentVisualFindMany = vi.fn();
const mockSegmentVisualUpdate = vi.fn();
const mockSegmentVisualUpdateMany = vi.fn();
const mockVideoGenUpdate = vi.fn();
const mockVideoGenDelete = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    podcast: { findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args) },
    videoGeneration: {
      findUnique: (...args: unknown[]) => mockVideoGenFindUnique(...args),
      create: (...args: unknown[]) => mockVideoGenCreate(...args),
      update: (...args: unknown[]) => mockVideoGenUpdate(...args),
      delete: (...args: unknown[]) => mockVideoGenDelete(...args),
    },
    segmentVisual: {
      createMany: (...args: unknown[]) => mockSegmentVisualCreateMany(...args),
      deleteMany: (...args: unknown[]) => mockSegmentVisualDeleteMany(...args),
      findMany: (...args: unknown[]) => mockSegmentVisualFindMany(...args),
      update: (...args: unknown[]) => mockSegmentVisualUpdate(...args),
      updateMany: (...args: unknown[]) => mockSegmentVisualUpdateMany(...args),
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

vi.mock('@/lib/video-gate', () => ({
  checkVideoGenerationGate: (...args: unknown[]) => mockCheckVideoGenerationGate(...args),
  tryIncrementVideoGeneration: (...args: unknown[]) => mockTryIncrementVideoGeneration(...args),
}));

vi.mock('@/lib/validations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/validations')>('@/lib/validations');
  return actual;
});

vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: {
    CLASSIFY_VISUALS: 'classify_visuals',
    GENERATE_VISUAL: 'generate_visual',
    COMPOSE_VIDEO: 'compose_video',
  },
  visualClassificationQueue: 'vis-class-queue',
  visualGenerationQueue: 'vis-gen-queue',
  videoCompositionQueue: 'vid-comp-queue',
}));

vi.mock('@/lib/r2', () => ({
  deleteFile: vi.fn(),
  extractR2Key: vi.fn((url: string) => url),
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

import { POST, PATCH } from '@/app/api/podcasts/[podcastId]/video/route';

function createRequest(body?: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/podcasts/pod-1/video'), {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'Content-Type': 'application/json' } : {},
  });
}

const routeParams = { params: Promise.resolve({ podcastId: 'pod-1' }) };

describe('POST /api/podcasts/[id]/video', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockRequireAdmin.mockResolvedValue(null);
    mockCheckVideoGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok', dailyUsed: 0, dailyLimit: 1, dailyRemaining: 1, isByokUser: false, isProUser: false });
    mockTryIncrementVideoGeneration.mockResolvedValue(true);
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'user-1', status: 'READY' });
    mockVideoGenFindUnique.mockResolvedValue(null);
    mockVideoGenCreate.mockResolvedValue({ id: 'vg-1', podcastId: 'pod-1', status: 'PENDING' });
    mockSegmentVisualCreateMany.mockResolvedValue({ count: 2 });
    mockSegmentVisualFindMany.mockResolvedValue([
      { id: 'sv-1', segmentId: 'seg-1', visualType: 'AI_ILLUSTRATION', visualMode: 'image', prompt: 'test', metadata: null },
    ]);
    mockVideoGenUpdate.mockResolvedValue({});
    mockAddJob.mockResolvedValue({});
  });

  it('queues classification when no pipeline is provided', async () => {
    const res = await POST(createRequest(), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.videoGenerationId).toBe('vg-1');

    expect(mockAddJob).toHaveBeenCalledWith('vis-class-queue', 'classify_visuals', expect.objectContaining({
      podcastId: 'pod-1',
      videoGenerationId: 'vg-1',
    }));
    expect(mockSegmentVisualCreateMany).not.toHaveBeenCalled();
  });

  it('creates SegmentVisuals directly when pipeline is provided', async () => {
    const pipeline = {
      version: 1 as const,
      defaultImageModel: 'fal-recraft-v3',
      defaultVideoModel: 'fal-wan2.5-480p',
      segments: [
        {
          segmentId: 'seg-1',
          order: 0,
          visualType: 'AI_ILLUSTRATION',
          visualMode: 'image' as const,
          model: 'fal-flux-2-pro',
          prompt: 'A test',
          metadata: null,
        },
      ],
    };

    const res = await POST(createRequest({ pipeline }), routeParams);
    expect(res.status).toBe(200);

    expect(mockSegmentVisualCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            segmentId: 'seg-1',
            visualType: 'AI_ILLUSTRATION',
            visualMode: 'image',
          }),
        ]),
      }),
    );

    // Should NOT queue classification
    expect(mockAddJob).not.toHaveBeenCalledWith('vis-class-queue', expect.anything(), expect.anything());
    // Should queue visual generation
    expect(mockAddJob).toHaveBeenCalledWith('vis-gen-queue', 'generate_visual', expect.objectContaining({
      segmentVisualId: 'sv-1',
    }));
  });

  it('returns 429 when daily video limit is reached', async () => {
    mockCheckVideoGenerationGate.mockResolvedValue({
      allowed: false,
      reason: 'daily_limit_reached',
      dailyUsed: 1,
      dailyLimit: 1,
      dailyRemaining: 0,
      resetInSeconds: 3600,
      isByokUser: false,
      isProUser: false,
    });

    const res = await POST(createRequest(), routeParams);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe('daily_limit_reached');
    expect(body.dailyUsed).toBe(1);
    expect(body.resetInSeconds).toBe(3600);
  });

  it('returns 403 when no image provider available', async () => {
    mockCheckVideoGenerationGate.mockResolvedValue({
      allowed: false,
      reason: 'no_image_provider',
      dailyUsed: 0,
      dailyLimit: 1,
      dailyRemaining: 1,
      isByokUser: false,
      isProUser: false,
    });

    const res = await POST(createRequest(), routeParams);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('no_image_provider');
  });

  it('returns 429 when atomic increment fails (TOCTOU race)', async () => {
    mockTryIncrementVideoGeneration.mockResolvedValue(false);

    const res = await POST(createRequest(), routeParams);
    expect(res.status).toBe(429);
  });

  it('skips daily counter for BYOK users', async () => {
    mockCheckVideoGenerationGate.mockResolvedValue({
      allowed: true,
      reason: 'ok',
      dailyUsed: 0,
      dailyLimit: 1,
      dailyRemaining: Infinity,
      isByokUser: true,
      isProUser: false,
    });

    const res = await POST(createRequest(), routeParams);
    expect(res.status).toBe(200);
    expect(mockTryIncrementVideoGeneration).not.toHaveBeenCalled();
  });

  it('skips daily counter for admin users', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');

    const res = await POST(createRequest(), routeParams);
    expect(res.status).toBe(200);
    expect(mockTryIncrementVideoGeneration).not.toHaveBeenCalled();
    expect(mockCheckVideoGenerationGate).not.toHaveBeenCalled();
  });

  it('stores pipelineJson on VideoGeneration when pipeline provided', async () => {
    const pipeline = {
      version: 1 as const,
      defaultImageModel: 'fal-recraft-v3',
      defaultVideoModel: 'fal-wan2.5-480p',
      segments: [
        {
          segmentId: 'seg-1',
          order: 0,
          visualType: 'TEXT_CARD',
          visualMode: 'programmatic' as const,
          model: null,
          prompt: null,
          metadata: null,
        },
      ],
    };

    await POST(createRequest({ pipeline }), routeParams);

    expect(mockVideoGenCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pipelineJson: expect.objectContaining({ version: 1 }),
        }),
      }),
    );
  });
});

function createPatchRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/podcasts/pod-1/video'), {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('PATCH /api/podcasts/[id]/video', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockRequireAdmin.mockResolvedValue(null);
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'user-1' });
    mockVideoGenFindUnique.mockResolvedValue({ id: 'vg-1', status: 'READY', videoUrl: null });
    mockSegmentVisualFindMany.mockResolvedValue([
      { id: 'sv-1', segmentId: 'seg-1', visualType: 'AI_ILLUSTRATION', visualMode: 'image', prompt: 'old prompt', metadata: null, assetUrl: 'https://r2.example.com/old.png' },
    ]);
    mockSegmentVisualUpdate.mockResolvedValue({});
    mockVideoGenUpdate.mockResolvedValue({});
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        segmentVisual: { update: mockSegmentVisualUpdate },
        videoGeneration: { update: mockVideoGenUpdate },
      };
      await fn(tx);
    });
    mockAddJob.mockResolvedValue({});
  });

  it('rejects unauthenticated requests', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    const res = await PATCH(createPatchRequest({ segments: [{ segmentVisualId: 'sv-1' }] }), routeParams);
    expect(res.status).toBe(401);
  });

  it('rejects non-owner requests', async () => {
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'other-user' });
    const res = await PATCH(createPatchRequest({ segments: [{ segmentVisualId: 'sv-1' }] }), routeParams);
    expect(res.status).toBe(403);
  });

  it('rejects when video is not READY or FAILED', async () => {
    mockVideoGenFindUnique.mockResolvedValue({ id: 'vg-1', status: 'GENERATING_VISUALS', videoUrl: null });
    const res = await PATCH(createPatchRequest({ segments: [{ segmentVisualId: 'sv-1' }] }), routeParams);
    expect(res.status).toBe(400);
  });

  it('rejects invalid body', async () => {
    const res = await PATCH(createPatchRequest({ segments: [] }), routeParams);
    expect(res.status).toBe(400);
  });

  it('rejects missing segment visual IDs', async () => {
    mockSegmentVisualFindMany.mockResolvedValueOnce([]);
    const res = await PATCH(createPatchRequest({ segments: [{ segmentVisualId: 'sv-missing' }] }), routeParams);
    expect(res.status).toBe(404);
  });

  it('updates segment visuals and queues regeneration for image mode', async () => {
    // After transaction, return updated visuals for job queuing
    mockSegmentVisualFindMany
      .mockResolvedValueOnce([
        { id: 'sv-1', segmentId: 'seg-1', visualType: 'AI_ILLUSTRATION', visualMode: 'image', assetUrl: 'https://r2.example.com/old.png', prompt: 'old prompt', metadata: null },
      ])
      .mockResolvedValueOnce([
        { id: 'sv-1', segmentId: 'seg-1', visualType: 'STOCK_FOOTAGE', visualMode: 'image', prompt: 'new prompt', metadata: null },
      ])
      .mockResolvedValueOnce([
        { id: 'sv-1', status: 'pending' },
      ]);

    const res = await PATCH(createPatchRequest({
      segments: [{
        segmentVisualId: 'sv-1',
        visualType: 'STOCK_FOOTAGE',
        prompt: 'new prompt',
      }],
    }), routeParams);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('GENERATING_VISUALS');

    // Should have run transaction
    expect(mockTransaction).toHaveBeenCalledTimes(1);

    // Should queue visual generation
    expect(mockAddJob).toHaveBeenCalledWith('vis-gen-queue', 'generate_visual', expect.objectContaining({
      segmentVisualId: 'sv-1',
    }));
  });

  it('marks READY immediately when all changed segments are programmatic', async () => {
    mockSegmentVisualFindMany
      .mockResolvedValueOnce([
        { id: 'sv-1', segmentId: 'seg-1', visualType: 'AI_ILLUSTRATION', visualMode: 'image', assetUrl: null, prompt: null, metadata: null },
      ])
      .mockResolvedValueOnce([
        { id: 'sv-1', segmentId: 'seg-1', visualType: 'TEXT_CARD', visualMode: 'programmatic', prompt: null, metadata: null },
      ])
      .mockResolvedValueOnce([
        { id: 'sv-1', status: 'ready' },
      ]);

    const res = await PATCH(createPatchRequest({
      segments: [{
        segmentVisualId: 'sv-1',
        visualType: 'TEXT_CARD',
        visualMode: 'programmatic',
      }],
    }), routeParams);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('READY');

    // Should NOT queue any jobs
    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it('allows PATCH when video is FAILED', async () => {
    mockVideoGenFindUnique.mockResolvedValue({ id: 'vg-1', status: 'FAILED', videoUrl: null });
    mockSegmentVisualFindMany
      .mockResolvedValueOnce([
        { id: 'sv-1', segmentId: 'seg-1', visualType: 'AI_ILLUSTRATION', visualMode: 'image', assetUrl: null, prompt: null, metadata: null },
      ])
      .mockResolvedValueOnce([
        { id: 'sv-1', segmentId: 'seg-1', visualType: 'AI_ILLUSTRATION', visualMode: 'image', prompt: 'retry prompt', metadata: null },
      ])
      .mockResolvedValueOnce([
        { id: 'sv-1', status: 'pending' },
      ]);

    const res = await PATCH(createPatchRequest({
      segments: [{ segmentVisualId: 'sv-1', prompt: 'retry prompt' }],
    }), routeParams);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('GENERATING_VISUALS');
  });
});
