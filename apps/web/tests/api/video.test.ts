import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockRequireAdmin = vi.fn();
const mockCheckVideoGenerationGate = vi.fn();
const mockAddJob = vi.fn();

const mockPodcastFindUnique = vi.fn();
const mockVideoGenFindUnique = vi.fn();
const mockVideoGenCreate = vi.fn();
const mockSegmentVisualCreateMany = vi.fn();
const mockSegmentVisualDeleteMany = vi.fn();
const mockSegmentVisualFindMany = vi.fn();
const mockVideoGenUpdate = vi.fn();
const mockVideoGenDelete = vi.fn();

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
    },
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

import { POST } from '@/app/api/podcasts/[podcastId]/video/route';

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
    mockCheckVideoGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok' });
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'user-1', status: 'READY' });
    mockVideoGenFindUnique.mockResolvedValue(null);
    mockVideoGenCreate.mockResolvedValue({ id: 'vg-1', podcastId: 'pod-1', status: 'PENDING' });
    mockSegmentVisualCreateMany.mockResolvedValue({ count: 2 });
    mockSegmentVisualFindMany.mockResolvedValue([
      { id: 'sv-1', segmentId: 'seg-1', visualType: 'AI_ILLUSTRATION', prompt: 'test', metadata: null },
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
