import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockRequireAdmin = vi.fn();
const mockCheckVideoGenerationGate = vi.fn();
const mockClassifySegmentVisuals = vi.fn();

const mockPodcast = {
  id: 'pod-1',
  userId: 'user-1',
  status: 'READY',
  title: 'Test Podcast',
  topic: 'Testing',
  segments: [
    { id: 'seg-1', order: 0, speaker: 'Host', text: 'Hello world', duration: 5 },
    { id: 'seg-2', order: 1, speaker: 'Expert', text: 'Indeed, testing is important', duration: 8 },
  ],
};

const mockFindUnique = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    podcast: { findUnique: (...args: unknown[]) => mockFindUnique(...args) },
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

vi.mock('@/lib/visual-classifier', () => ({
  classifySegmentVisuals: (...args: unknown[]) => mockClassifySegmentVisuals(...args),
}));

vi.mock('pricetoken', () => ({
  PriceTokenClient: class {
    getImagePricing() {
      return Promise.resolve([
        { modelId: 'fal-recraft-v3', provider: 'fal', displayName: 'fal Recraft V3', pricePerImage: 0.02, defaultResolution: '1024x1024', qualityTier: 'standard' },
        { modelId: 'fal-flux-2-pro', provider: 'fal', displayName: 'fal FLUX 2 Pro', pricePerImage: 0.04, defaultResolution: '1024x1024', qualityTier: 'standard' },
      ]);
    }
    getVideoPricing() {
      return Promise.resolve([
        { modelId: 'fal-wan2.5-480p', provider: 'fal', displayName: 'FAL WAN 2.5 480p', costPerMinute: 3, maxDuration: 5, resolution: '480p', qualityMode: 'standard' },
      ]);
    }
  },
}));

vi.mock('@/lib/providers/fal-endpoints', () => ({
  getFalImageEndpoint: (id: string) => (id.startsWith('fal-') ? `fal-ai/${id}` : null),
  getFalVideoEndpoint: (id: string) => (id.startsWith('fal-') ? `fal-ai/${id}` : null),
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

import { POST, PATCH } from '@/app/api/podcasts/[podcastId]/video/pipeline/route';

function createRequest(method: string, body?: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/podcasts/pod-1/video/pipeline'), {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'Content-Type': 'application/json' } : {},
  });
}

const routeParams = { params: Promise.resolve({ podcastId: 'pod-1' }) };

describe('POST /api/podcasts/[id]/video/pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockRequireAdmin.mockResolvedValue(null);
    mockCheckVideoGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok' });
    mockFindUnique.mockResolvedValue(mockPodcast);
    mockClassifySegmentVisuals.mockResolvedValue({
      classifications: [
        { segmentId: 'seg-1', order: 0, visualType: 'AI_ILLUSTRATION', prompt: 'A test image', metadata: null },
        { segmentId: 'seg-2', order: 1, visualType: 'QUOTE', prompt: null, metadata: { text: 'Indeed' } },
      ],
      inputTokens: 100,
      outputTokens: 50,
      model: 'claude-haiku-4-5-20251001',
    });
  });

  it('returns pipeline JSON with classified segments', async () => {
    const res = await POST(createRequest('POST'), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe(1);
    expect(body.segments).toHaveLength(2);
    expect(body.segments[0].visualType).toBe('AI_ILLUSTRATION');
    expect(body.segments[0].visualMode).toBe('image');
    expect(body.segments[1].visualType).toBe('QUOTE');
    expect(body.segments[1].visualMode).toBe('programmatic');
    expect(typeof body.totalEstimatedCost).toBe('number');
    expect(typeof body.defaultImageModel).toBe('string');
    expect(typeof body.defaultVideoModel).toBe('string');
  });

  it('requires auth', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    const res = await POST(createRequest('POST'), routeParams);
    expect(res.status).toBe(401);
  });

  it('requires ownership', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'other-user' });
    const res = await POST(createRequest('POST'), routeParams);
    expect(res.status).toBe(403);
  });

  it('respects video generation gate', async () => {
    mockCheckVideoGenerationGate.mockResolvedValue({ allowed: false, reason: 'upgrade_to_pro' });
    const res = await POST(createRequest('POST'), routeParams);
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/podcasts/[id]/video/pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockRequireAdmin.mockResolvedValue(null);
    mockFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'user-1' });
  });

  it('recalculates costs for edited pipeline', async () => {
    const pipeline = {
      version: 1,
      defaultImageModel: 'fal-recraft-v3',
      defaultVideoModel: 'fal-wan2.5-480p',
      segments: [
        {
          segmentId: 'seg-1',
          order: 0,
          speaker: 'Host',
          text: 'Hello',
          duration: 5,
          visualType: 'AI_ILLUSTRATION',
          visualMode: 'image' as const,
          model: 'fal-flux-2-pro',
          prompt: 'A test',
          metadata: null,
          estimatedCost: 0,
        },
      ],
      totalEstimatedCost: 0,
    };

    const res = await PATCH(createRequest('PATCH', pipeline), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.segments[0].estimatedCost).toBeGreaterThan(0);
    expect(body.totalEstimatedCost).toBeGreaterThan(0);
  });

  it('rejects unknown model IDs', async () => {
    const pipeline = {
      version: 1,
      defaultImageModel: 'fal-recraft-v3',
      defaultVideoModel: 'fal-wan2.5-480p',
      segments: [
        {
          segmentId: 'seg-1',
          order: 0,
          speaker: 'Host',
          text: 'Hello',
          duration: 5,
          visualType: 'AI_ILLUSTRATION',
          visualMode: 'image' as const,
          model: 'totally-fake-model',
          prompt: 'A test',
          metadata: null,
          estimatedCost: 0,
        },
      ],
      totalEstimatedCost: 0,
    };

    const res = await PATCH(createRequest('PATCH', pipeline), routeParams);
    expect(res.status).toBe(400);
  });
});
