import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---- Mocks ----

const mockAuthenticateRequest = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

const mockPrismaPodcastFindUnique = vi.fn();
const mockPrismaPodcastUpdate = vi.fn();
const mockPrismaJobUpdateMany = vi.fn();
const mockPrismaPodcastVersionSegmentDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
const mockPrismaPodcastVersionDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
const mockPrismaSegmentDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
const mockPrismaScriptDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
const mockPrismaReferenceDeleteMany = vi.fn().mockResolvedValue({ count: 0 });

vi.mock('@/lib/prisma', () => ({
  prisma: {
    podcast: {
      findUnique: (...args: unknown[]) => mockPrismaPodcastFindUnique(...args),
      update: (...args: unknown[]) => mockPrismaPodcastUpdate(...args),
    },
    job: {
      updateMany: (...args: unknown[]) => mockPrismaJobUpdateMany(...args),
    },
    podcastVersionSegment: {
      deleteMany: (...args: unknown[]) => mockPrismaPodcastVersionSegmentDeleteMany(...args),
    },
    podcastVersion: {
      deleteMany: (...args: unknown[]) => mockPrismaPodcastVersionDeleteMany(...args),
    },
    segment: {
      deleteMany: (...args: unknown[]) => mockPrismaSegmentDeleteMany(...args),
    },
    script: {
      deleteMany: (...args: unknown[]) => mockPrismaScriptDeleteMany(...args),
    },
    reference: {
      deleteMany: (...args: unknown[]) => mockPrismaReferenceDeleteMany(...args),
    },
  },
}));

const mockAddJob = vi.fn();

vi.mock('@/lib/queue', () => ({
  contentExtractionQueue: {},
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: {
    EXTRACT_CONTENT: 'extract_content',
  },
}));

const mockCanResolveAi = vi.fn().mockResolvedValue(true);

vi.mock('@/lib/providers/ai', () => ({
  canResolveAi: (...args: unknown[]) => mockCanResolveAi(...args),
}));

const mockCheckRateLimit = vi.fn().mockResolvedValue({ allowed: true, remaining: 19, resetAt: 0 });

vi.mock('@/lib/redis', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

vi.mock('@/lib/stripe', () => ({
  LIMITS: { maxDurationMinutes: 30 },
}));

// ---- Import under test ----
import { POST } from '@/app/api/podcasts/[podcastId]/generate/route';

// ---- Helpers ----

function createMockRequest(): NextRequest {
  return {
    headers: new Headers({
      authorization: 'Bearer test-api-key',
    }),
  } as NextRequest;
}

async function createMockParams(podcastId: string) {
  return { params: Promise.resolve({ podcastId }) };
}

// ---- Tests ----

describe('POST /api/podcasts/[podcastId]/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanResolveAi.mockResolvedValue(true);
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 19, resetAt: 0 });
  });

  it('returns 401 for unauthenticated request', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const request = createMockRequest();
    const params = await createMockParams('podcast-001');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({ error: 'Unauthorized' });
  });

  it('returns 404 when podcast does not exist', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
    mockPrismaPodcastFindUnique.mockResolvedValue(null);

    const request = createMockRequest();
    const params = await createMockParams('podcast-nonexistent');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: 'Podcast not found' });
  });

  it('returns 403 when user does not own podcast', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      id: 'podcast-002',
      userId: 'user-different',
      status: 'PENDING',
      discovery: null,
    });

    const request = createMockRequest();
    const params = await createMockParams('podcast-002');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data).toEqual({ error: 'Forbidden' });
  });

  it('returns 400 when podcast is in READY status', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      id: 'podcast-003',
      userId: 'user-001',
      status: 'READY',
      discovery: null,
    });

    const request = createMockRequest();
    const params = await createMockParams('podcast-003');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      error: 'Podcast must be in PENDING, DISCOVERING, or FAILED status to generate',
    });
  });

  it('returns 403 when AI provider not configured', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
    mockCanResolveAi.mockResolvedValue(false);

    const request = createMockRequest();
    const params = await createMockParams('podcast-noai');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain('AI provider not configured');
  });

  it('returns 429 when rate limited', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 3600000 });

    const request = createMockRequest();
    const params = await createMockParams('podcast-rl');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data.error).toContain('Rate limit exceeded');
  });

  it('successfully starts generation for PENDING podcast', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      id: 'podcast-007',
      userId: 'user-001',
      status: 'PENDING',
      discovery: {
        sourceUrl: 'https://example.com/article',
        sourceContent: null,
        durationTarget: null,
      },
    });
    mockPrismaPodcastUpdate.mockResolvedValue({});

    const request = createMockRequest();
    const params = await createMockParams('podcast-007');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true, message: 'Generation started' });
  });

  it('cleans up failed jobs before retrying FAILED podcast', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-003' });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      id: 'podcast-009',
      userId: 'user-003',
      status: 'FAILED',
      discovery: null,
    });
    mockPrismaJobUpdateMany.mockResolvedValue({ count: 2 });
    mockPrismaPodcastUpdate.mockResolvedValue({});

    const request = createMockRequest();
    const params = await createMockParams('podcast-009');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true, message: 'Generation started' });
    expect(mockPrismaJobUpdateMany).toHaveBeenCalled();
  });

  it('returns 400 when duration exceeds limit', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      id: 'podcast-dur',
      userId: 'user-001',
      status: 'PENDING',
      discovery: {
        sourceUrl: null,
        sourceContent: null,
        durationTarget: 60,
      },
    });

    const request = createMockRequest();
    const params = await createMockParams('podcast-dur');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('exceeds the maximum');
  });
});
