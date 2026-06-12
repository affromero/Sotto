import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockRequireAdmin = vi.fn();
const mockCheckVideoGenerationGate = vi.fn();
const mockAddJob = vi.fn().mockResolvedValue({});
const mockCacheGet = vi.fn();
const { mockGetAiKey, mockResolveAiModelAndProvider } = vi.hoisted(() => ({
  mockGetAiKey: vi.fn(),
  mockResolveAiModelAndProvider: vi.fn(),
}));

const mockEpisode = {
  id: 'pod-1',
  userId: 'user-1',
  status: 'READY',
  title: 'Test Episode',
  topic: 'Testing',
  segments: [
    { id: 'seg-1', order: 0, speaker: 'Host', text: 'Hello world', duration: 5 },
    { id: 'seg-2', order: 1, speaker: 'Expert', text: 'Indeed, testing is important', duration: 8 },
  ],
};

const mockFindUnique = vi.fn();
const mockUserFindUniqueOrThrow = vi.fn();
const mockUserAiKeyFindMany = vi.fn();

const mockVideoGenFindFirst = vi.fn().mockResolvedValue(null);
const mockVideoGenUpdateMany = vi.fn().mockResolvedValue({ count: 0 });

vi.mock('@/lib/prisma', () => ({
  prisma: {
    episode: { findUnique: (...args: unknown[]) => mockFindUnique(...args) },
    user: { findUniqueOrThrow: (...args: unknown[]) => mockUserFindUniqueOrThrow(...args) },
    userAiKey: { findMany: (...args: unknown[]) => mockUserAiKeyFindMany(...args) },
    videoGeneration: {
      findFirst: (...args: unknown[]) => mockVideoGenFindFirst(...args),
      updateMany: (...args: unknown[]) => mockVideoGenUpdateMany(...args),
    },
  },
}));

vi.mock('@/lib/byok', () => ({
  getAiKey: (...args: unknown[]) => mockGetAiKey(...args),
}));

vi.mock('@/lib/auto-model-config', () => ({
  resolveVideoModel: vi.fn().mockResolvedValue({
    videoProvider: 'minimax',
    videoModel: 'minimax-hailuo02-768p',
  }),
}));

const VALID_PROVIDERS = new Set(['anthropic', 'openai', 'google', 'claude-code']);
const VALID_MODELS = new Set([
  'claude-haiku-4-5-20251001',
  'gpt-5-nano',
  'gemini-3.1-flash-lite-preview',
  'sonnet',
]);

const MODEL_TO_PROVIDER: Record<string, string> = {
  'claude-haiku-4-5-20251001': 'anthropic',
  'gpt-5-nano': 'openai',
  'gemini-3.1-flash-lite-preview': 'google',
  sonnet: 'claude-code',
};
const PROVIDER_CHEAPEST: Record<string, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-5-nano',
  google: 'gemini-3.1-flash-lite-preview',
  'claude-code': 'sonnet',
};

vi.mock('@/lib/providers/ai-registry', () => ({
  resolveAiModelAndProvider: (...args: unknown[]) => mockResolveAiModelAndProvider(...args),
  isValidAiProviderId: (id: string) => VALID_PROVIDERS.has(id),
  isValidModelId: (id: string) => VALID_MODELS.has(id),
  getProviderForModel: (id: string) => MODEL_TO_PROVIDER[id] ?? null,
  getCheapestModelForProvider: (id: string) => PROVIDER_CHEAPEST[id] ?? null,
  getAiProviderMeta: (id: string) => {
    const names: Record<string, string> = {
      anthropic: 'Anthropic (Claude)',
      openai: 'OpenAI',
      google: 'Google (Gemini)',
      'claude-code': 'Claude Code (CLI)',
    };
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

import { POST, GET, PATCH } from '@/app/api/v1/episodes/[episodeId]/video/pipeline/route';

function createRequest(method: string, body?: unknown, url?: string): NextRequest {
  return new NextRequest(new URL(url ?? 'http://localhost:3000/api/v1/episodes/pod-1/video/pipeline'), {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'Content-Type': 'application/json' } : {},
  });
}

const routeParams = { params: Promise.resolve({ episodeId: 'pod-1' }) };

describe('POST /api/v1/episodes/[id]/video/pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockRequireAdmin.mockResolvedValue(null);
    mockCheckVideoGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok' });
    mockFindUnique.mockResolvedValue(mockEpisode);
    mockUserFindUniqueOrThrow.mockResolvedValue({ preferredAiModel: null });
    mockUserAiKeyFindMany.mockResolvedValue([]);
    mockGetAiKey.mockImplementation(async (_userId: string, provider?: string) => {
      if (provider === 'openai') return { apiKey: 'openai-key', provider: 'openai' };
      if (provider === 'google') return { apiKey: 'google-key', provider: 'google' };
      return { apiKey: 'anthropic-key', provider: 'anthropic' };
    });
    mockResolveAiModelAndProvider.mockImplementation(
      async (opts: { episodeAiModel?: string | null; aiKey?: { provider: string } | null }) => {
        if (opts.episodeAiModel) {
          const provider = opts.episodeAiModel.startsWith('claude-code:')
            ? 'claude-code'
            : MODEL_TO_PROVIDER[opts.episodeAiModel];
          if (!provider) throw new Error(`Unknown AI model "${opts.episodeAiModel}".`);
          return { model: opts.episodeAiModel, provider };
        }

        if (opts.aiKey) {
          return {
            model: PROVIDER_CHEAPEST[opts.aiKey.provider],
            provider: opts.aiKey.provider,
          };
        }

        return { model: 'claude-haiku-4-5-20251001', provider: 'anthropic' };
      },
    );
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
        episodeId: 'pod-1',
        userId: 'user-1',
        aiProvider: 'anthropic',
        aiModel: 'claude-haiku-4-5-20251001',
        apiKeyOverride: 'anthropic-key',
      }),
    );
    expect(mockGetAiKey).toHaveBeenCalledWith('user-1');
    expect(mockResolveAiModelAndProvider).toHaveBeenCalledWith({
      episodeAiModel: null,
      aiKey: { apiKey: 'anthropic-key', provider: 'anthropic' },
    });
  });

  it('requires an AI key when no explicit model is configured', async () => {
    mockGetAiKey.mockResolvedValue(null);
    const res = await POST(createRequest('POST'), routeParams);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('ai_key_required');
    expect(body.error).toBe('AI model is required for video pipeline classification when no AI key is configured.');
    expect(mockAddJob).not.toHaveBeenCalled();
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
    mockCheckVideoGenerationGate.mockResolvedValue({ allowed: false, reason: 'no_image_provider' });
    const res = await POST(createRequest('POST'), routeParams);
    expect(res.status).toBe(403);
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
        apiKeyOverride: 'google-key',
      }),
    );
    expect(mockGetAiKey).toHaveBeenCalledWith('user-1', 'google');
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
        apiKeyOverride: 'openai-key',
      }),
    );
    expect(mockGetAiKey).toHaveBeenCalledWith('user-1', 'openai');
  });

  it('uses the selected user model and requires the matching provider key', async () => {
    mockUserFindUniqueOrThrow.mockResolvedValue({ preferredAiModel: 'gpt-5-nano' });
    const res = await POST(createRequest('POST'), routeParams);
    expect(res.status).toBe(200);
    expect(mockResolveAiModelAndProvider).toHaveBeenCalledWith({
      episodeAiModel: 'gpt-5-nano',
      aiKey: null,
    });
    expect(mockGetAiKey).toHaveBeenCalledWith('user-1', 'openai');
    expect(mockAddJob).toHaveBeenCalledWith(
      expect.anything(),
      'classify_pipeline',
      expect.objectContaining({
        aiProvider: 'openai',
        aiModel: 'gpt-5-nano',
        apiKeyOverride: 'openai-key',
      }),
    );
  });

  it('rejects explicit hosted models without a matching provider key', async () => {
    mockGetAiKey.mockResolvedValue(null);
    const res = await POST(
      createRequest('POST', { aiModel: 'gpt-5-nano' }),
      routeParams,
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('ai_key_required');
    expect(body.provider).toBe('openai');
    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it('allows local Claude Code models without an AI key', async () => {
    mockGetAiKey.mockResolvedValue(null);
    const res = await POST(
      createRequest('POST', { aiModel: 'claude-code:sonnet' }),
      routeParams,
    );
    expect(res.status).toBe(200);
    expect(mockGetAiKey).not.toHaveBeenCalled();
    expect(mockAddJob).toHaveBeenCalledWith(
      expect.anything(),
      'classify_pipeline',
      expect.objectContaining({
        aiProvider: 'claude-code',
        aiModel: 'claude-code:sonnet',
        apiKeyOverride: undefined,
      }),
    );
  });

  it('rejects an empty local Claude Code model suffix', async () => {
    const res = await POST(
      createRequest('POST', { aiModel: 'claude-code:' }),
      routeParams,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Unknown AI model: claude-code:');
    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it('rejects provider and model mismatches', async () => {
    const res = await POST(
      createRequest('POST', { aiProvider: 'anthropic', aiModel: 'gpt-5-nano' }),
      routeParams,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('AI model "gpt-5-nano" does not belong to provider "anthropic".');
    expect(mockAddJob).not.toHaveBeenCalled();
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

describe('GET /api/v1/episodes/[id]/video/pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockRequireAdmin.mockResolvedValue(null);
    mockFindUnique.mockResolvedValue({ userId: 'user-1' });
  });

  it('returns classifying when Redis key does not exist', async () => {
    mockCacheGet.mockResolvedValue(null);
    const res = await GET(
      createRequest('GET', undefined, 'http://localhost:3000/api/v1/episodes/pod-1/video/pipeline?classificationId=550e8400-e29b-41d4-a716-446655440000'),
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
      createRequest('GET', undefined, 'http://localhost:3000/api/v1/episodes/pod-1/video/pipeline?classificationId=550e8400-e29b-41d4-a716-446655440000'),
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
      createRequest('GET', undefined, 'http://localhost:3000/api/v1/episodes/pod-1/video/pipeline?classificationId=550e8400-e29b-41d4-a716-446655440000'),
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
      createRequest('GET', undefined, 'http://localhost:3000/api/v1/episodes/pod-1/video/pipeline?classificationId=550e8400-e29b-41d4-a716-446655440000'),
      routeParams,
    );
    expect(res.status).toBe(401);
  });

  it('returns none status when no classificationId and no draft exists', async () => {
    mockVideoGenFindFirst.mockResolvedValue(null);
    const res = await GET(
      createRequest('GET', undefined, 'http://localhost:3000/api/v1/episodes/pod-1/video/pipeline'),
      routeParams,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('none');
  });

  it('rejects non-UUID classificationId', async () => {
    const res = await GET(
      createRequest('GET', undefined, 'http://localhost:3000/api/v1/episodes/pod-1/video/pipeline?classificationId=not-a-uuid'),
      routeParams,
    );
    expect(res.status).toBe(400);
  });

  it('requires episode ownership', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'other-user' });
    const res = await GET(
      createRequest('GET', undefined, 'http://localhost:3000/api/v1/episodes/pod-1/video/pipeline?classificationId=550e8400-e29b-41d4-a716-446655440000'),
      routeParams,
    );
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/v1/episodes/[id]/video/pipeline', () => {
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
