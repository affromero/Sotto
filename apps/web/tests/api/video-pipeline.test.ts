import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockRequireAdmin = vi.fn();
const mockCheckVideoGenerationGate = vi.fn();
const mockAddJob = vi.fn().mockResolvedValue({});
const mockCacheGet = vi.fn();

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

const MODEL_TO_PROVIDER: Record<string, string> = {
  'claude-haiku-4-5-20251001': 'anthropic',
  'gpt-5-nano': 'openai',
  'gemini-3.1-flash-lite-preview': 'google',
};
const PROVIDER_CHEAPEST: Record<string, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-5-nano',
  google: 'gemini-3.1-flash-lite-preview',
};

vi.mock('@/lib/providers/ai-registry', () => ({
  resolveAiModelAndProvider: vi.fn().mockResolvedValue({
    model: 'claude-haiku-4-5-20251001',
    provider: 'anthropic',
  }),
  isValidAiProviderId: (id: string) => VALID_PROVIDERS.has(id),
  isValidModelId: (id: string) => VALID_MODELS.has(id),
  getProviderForModel: (id: string) => MODEL_TO_PROVIDER[id] ?? null,
  getCheapestModelForProvider: (id: string) => PROVIDER_CHEAPEST[id] ?? null,
  getAiProviderMeta: (id: string) => {
    const names: Record<string, string> = { anthropic: 'Anthropic (Claude)', openai: 'OpenAI', google: 'Google (Gemini)' };
    if (!names[id]) throw new Error(`Unknown AI provider: ${id}`);
    return { displayName: names[id] };
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

vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mockAddJob(...args),
  pipelineClassificationQueue: {},
  JobType: { CLASSIFY_PIPELINE: 'classify_pipeline' },
}));

vi.mock('@/lib/redis', () => ({
  cache: {
    get: (...args: unknown[]) => mockCacheGet(...args),
  },
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

vi.mock('@/lib/providers/video-registry', () => ({
  getAllVideoProviderMeta: () => [],
  videoModelSupportsLastFrame: () => false,
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

import { POST, GET, PATCH } from '@/app/api/podcasts/[podcastId]/video/pipeline/route';

function createRequest(method: string, body?: unknown, url?: string): NextRequest {
  return new NextRequest(new URL(url ?? 'http://localhost:3000/api/podcasts/pod-1/video/pipeline'), {
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
    mockUserFindUniqueOrThrow.mockResolvedValue({ plan: 'FREE', preferredAiModel: null });
    mockUserAiKeyFindMany.mockResolvedValue([]);
  });

  it('queues classification job and returns classificationId', async () => {
    const res = await POST(createRequest('POST'), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('classifying');
    expect(body.classificationId).toBeDefined();
    expect(typeof body.classificationId).toBe('string');
    expect(mockAddJob).toHaveBeenCalledWith(
      expect.anything(),
      'classify_pipeline',
      expect.objectContaining({
        classificationId: body.classificationId,
        podcastId: 'pod-1',
        userId: 'user-1',
        aiProvider: 'anthropic',
        aiModel: 'claude-haiku-4-5-20251001',
        tier: 'FREE',
      }),
    );
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

  it('passes aiProvider/aiModel override to job payload', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');
    const res = await POST(
      createRequest('POST', { aiProvider: 'google', aiModel: 'gemini-3.1-flash-lite-preview' }),
      routeParams,
    );
    expect(res.status).toBe(200);
    expect(mockAddJob).toHaveBeenCalledWith(
      expect.anything(),
      'classify_pipeline',
      expect.objectContaining({
        aiProvider: 'google',
        aiModel: 'gemini-3.1-flash-lite-preview',
      }),
    );
  });

  it('resolves provider from model when only aiModel is provided', async () => {
    const res = await POST(
      createRequest('POST', { aiModel: 'gpt-5-nano' }),
      routeParams,
    );
    expect(res.status).toBe(200);
    expect(mockAddJob).toHaveBeenCalledWith(
      expect.anything(),
      'classify_pipeline',
      expect.objectContaining({
        aiProvider: 'openai',
        aiModel: 'gpt-5-nano',
      }),
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

describe('GET /api/podcasts/[id]/video/pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockRequireAdmin.mockResolvedValue(null);
    mockFindUnique.mockResolvedValue({ userId: 'user-1' });
  });

  it('returns classifying when Redis key does not exist', async () => {
    mockCacheGet.mockResolvedValue(null);
    const res = await GET(
      createRequest('GET', undefined, 'http://localhost:3000/api/podcasts/pod-1/video/pipeline?classificationId=550e8400-e29b-41d4-a716-446655440000'),
      routeParams,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('classifying');
  });

  it('returns ready pipeline from Redis', async () => {
    const mockPipeline = { version: 3, segments: [], transitions: [], totalEstimatedCost: 0 };
    mockCacheGet.mockResolvedValue({ status: 'ready', pipeline: mockPipeline });
    const res = await GET(
      createRequest('GET', undefined, 'http://localhost:3000/api/podcasts/pod-1/video/pipeline?classificationId=550e8400-e29b-41d4-a716-446655440000'),
      routeParams,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ready');
    expect(body.pipeline).toEqual(mockPipeline);
  });

  it('returns failed status from Redis', async () => {
    mockCacheGet.mockResolvedValue({ status: 'failed', error: 'LLM error', isLlmError: true, currentProvider: 'anthropic' });
    const res = await GET(
      createRequest('GET', undefined, 'http://localhost:3000/api/podcasts/pod-1/video/pipeline?classificationId=550e8400-e29b-41d4-a716-446655440000'),
      routeParams,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('failed');
    expect(body.error).toBe('LLM error');
    expect(body.isLlmError).toBe(true);
  });

  it('requires auth', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    const res = await GET(
      createRequest('GET', undefined, 'http://localhost:3000/api/podcasts/pod-1/video/pipeline?classificationId=550e8400-e29b-41d4-a716-446655440000'),
      routeParams,
    );
    expect(res.status).toBe(401);
  });

  it('rejects missing classificationId', async () => {
    const res = await GET(
      createRequest('GET', undefined, 'http://localhost:3000/api/podcasts/pod-1/video/pipeline'),
      routeParams,
    );
    expect(res.status).toBe(400);
  });

  it('rejects non-UUID classificationId', async () => {
    const res = await GET(
      createRequest('GET', undefined, 'http://localhost:3000/api/podcasts/pod-1/video/pipeline?classificationId=not-a-uuid'),
      routeParams,
    );
    expect(res.status).toBe(400);
  });

  it('requires podcast ownership', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'other-user' });
    const res = await GET(
      createRequest('GET', undefined, 'http://localhost:3000/api/podcasts/pod-1/video/pipeline?classificationId=550e8400-e29b-41d4-a716-446655440000'),
      routeParams,
    );
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
