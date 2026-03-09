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

const mockUserFindUniqueOrThrow = vi.fn();
const mockUserAiKeyFindMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    podcast: { findUnique: (...args: unknown[]) => mockFindUnique(...args) },
    user: { findUniqueOrThrow: (...args: unknown[]) => mockUserFindUniqueOrThrow(...args) },
    userAiKey: { findMany: (...args: unknown[]) => mockUserAiKeyFindMany(...args) },
  },
}));

vi.mock('@/lib/byok', () => ({
  getAiKey: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/auto-model-config', () => ({
  resolveVideoModel: vi.fn().mockResolvedValue({
    videoProvider: 'minimax',
    videoModel: 'minimax-hailuo02-768p',
  }),
}));

const VALID_PROVIDERS = new Set(['anthropic', 'openai', 'google']);
const VALID_MODELS = new Set(['claude-haiku-4-5-20251001', 'gpt-5-nano', 'gemini-3.1-flash-lite-preview']);

vi.mock('@/lib/providers/ai-registry', () => ({
  resolveAiModelAndProvider: vi.fn().mockResolvedValue({
    model: 'claude-haiku-4-5-20251001',
    provider: 'anthropic',
  }),
  isValidAiProviderId: (id: string) => VALID_PROVIDERS.has(id),
  isValidModelId: (id: string) => VALID_MODELS.has(id),
}));

vi.mock('@/lib/byok-errors', () => ({
  classifyError: vi.fn().mockReturnValue('unknown'),
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
  STATIC_PRICING: [],
  STATIC_IMAGE_PRICING: [
    { modelId: 'fal-recraft-v3', provider: 'fal', displayName: 'fal Recraft V3', pricePerImage: 0.02, defaultResolution: '1024x1024', qualityTier: 'standard' },
    { modelId: 'fal-flux-2-pro', provider: 'fal', displayName: 'fal FLUX 2 Pro', pricePerImage: 0.04, defaultResolution: '1024x1024', qualityTier: 'standard' },
  ],
  STATIC_VIDEO_PRICING: [
    { modelId: 'fal-wan2.5-480p', provider: 'fal', displayName: 'FAL WAN 2.5 480p', costPerMinute: 3, maxDuration: 5, resolution: '480p', qualityMode: 'standard' },
  ],
}));

vi.mock('@/lib/providers/fal-endpoints', () => ({
  getFalImageEndpoint: (id: string) => (id.startsWith('fal-') ? `fal-ai/${id}` : null),
  getFalVideoEndpoint: (id: string) => (id.startsWith('fal-') ? `fal-ai/${id}` : null),
  FAL_IMAGE_MODEL_IDS: new Set(['fal-recraft-v3', 'fal-flux-2-pro']),
  FAL_VIDEO_MODEL_IDS: new Set(['fal-wan2.5-480p']),
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
    mockCheckVideoGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok', dailyUsed: 0, dailyLimit: 1, dailyRemaining: 1, isByokUser: false, isProUser: false });
    mockFindUnique.mockResolvedValue(mockPodcast);
    mockUserFindUniqueOrThrow.mockResolvedValue({ plan: 'FREE' });
    mockUserAiKeyFindMany.mockResolvedValue([]);
    mockClassifySegmentVisuals.mockResolvedValue({
      classifications: [
        { segmentId: 'seg-1', order: 0, subVisuals: [{ subOrder: 0, startOffsetFraction: 0, durationFraction: 1, visualType: 'AI_ILLUSTRATION', prompt: 'A test image', metadata: null, endStatePrompt: null }] },
        { segmentId: 'seg-2', order: 1, subVisuals: [{ subOrder: 0, startOffsetFraction: 0, durationFraction: 1, visualType: 'QUOTE', prompt: null, metadata: { text: 'Indeed' }, endStatePrompt: null }] },
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
    expect(body.version).toBe(2);
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

  it('returns 403 when no image provider', async () => {
    mockCheckVideoGenerationGate.mockResolvedValue({ allowed: false, reason: 'no_image_provider', dailyUsed: 0, dailyLimit: 1, dailyRemaining: 1, isByokUser: false, isProUser: false });
    const res = await POST(createRequest('POST'), routeParams);
    expect(res.status).toBe(403);
  });

  it('returns 429 when daily video limit reached', async () => {
    mockCheckVideoGenerationGate.mockResolvedValue({ allowed: false, reason: 'daily_limit_reached', dailyUsed: 1, dailyLimit: 1, dailyRemaining: 0, resetInSeconds: 7200, isByokUser: false, isProUser: false });
    const res = await POST(createRequest('POST'), routeParams);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe('daily_limit_reached');
  });

  it('returns isLlmError when classification fails with credit error', async () => {
    const { classifyError } = await import('@/lib/byok-errors');
    vi.mocked(classifyError).mockReturnValue('insufficient_credits');
    mockRequireAdmin.mockResolvedValue('admin-1');
    mockClassifySegmentVisuals.mockRejectedValue(new Error('Your credit balance is too low to access the Anthropic API'));
    const res = await POST(createRequest('POST'), routeParams);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.isLlmError).toBe(true);
    expect(body.errorKind).toBe('insufficient_credits');
    expect(body.currentProvider).toBe('anthropic');
  });

  it('does not set isLlmError for non-LLM errors', async () => {
    const { classifyError } = await import('@/lib/byok-errors');
    vi.mocked(classifyError).mockReturnValue('unknown');
    mockRequireAdmin.mockResolvedValue('admin-1');
    mockClassifySegmentVisuals.mockRejectedValue(new Error('Network timeout'));
    const res = await POST(createRequest('POST'), routeParams);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.isLlmError).toBeUndefined();
  });

  it('accepts aiProvider/aiModel override in POST body', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');
    const res = await POST(
      createRequest('POST', { aiProvider: 'google', aiModel: 'gemini-3.1-flash-lite-preview' }),
      routeParams,
    );
    expect(res.status).toBe(200);
    expect(mockClassifySegmentVisuals).toHaveBeenCalledWith(
      expect.any(Array),
      'Test Podcast',
      'Testing',
      expect.objectContaining({ provider: 'google', model: 'gemini-3.1-flash-lite-preview' }),
    );
  });

  it('rejects invalid aiProvider in POST body', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');
    const res = await POST(
      createRequest('POST', { aiProvider: 'invalid-provider', aiModel: 'some-model' }),
      routeParams,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Unknown AI provider');
  });

  it('rejects invalid aiModel in POST body', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');
    const res = await POST(
      createRequest('POST', { aiProvider: 'openai', aiModel: 'fake-model' }),
      routeParams,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Unknown AI model');
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
