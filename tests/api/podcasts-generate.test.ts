import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---- Mocks ----

const mockAuthenticateRequest = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

const mockPrismaTransaction = vi.fn();
const mockPrismaPodcastFindUnique = vi.fn();
const mockPrismaPodcastUpdate = vi.fn();
const mockPrismaJobUpdateMany = vi.fn();
const mockPrismaSubscriptionFindUnique = vi.fn();
const mockPrismaUserFindUnique = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    podcast: {
      findUnique: (...args: unknown[]) => mockPrismaPodcastFindUnique(...args),
      update: (...args: unknown[]) => mockPrismaPodcastUpdate(...args),
    },
    job: {
      updateMany: (...args: unknown[]) => mockPrismaJobUpdateMany(...args),
    },
    subscription: {
      findUnique: (...args: unknown[]) => mockPrismaSubscriptionFindUnique(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => mockPrismaUserFindUnique(...args),
    },
    $transaction: (operations: unknown) => mockPrismaTransaction(operations),
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

const mockConsumeCredit = vi.fn();
const mockGetUserTier = vi.fn().mockResolvedValue('FREE');

vi.mock('@/lib/subscription', () => ({
  getUserTier: (...args: unknown[]) => mockGetUserTier(...args),
}));

const mockCanGenerate = vi.fn();

vi.mock('@/lib/stripe', () => ({
  TIER_LIMITS: {
    FREE: { maxDurationMinutes: 5 },
    PRO: { maxDurationMinutes: 10 },
    STARTER: { maxDurationMinutes: 10 },
    STUDIO: { maxDurationMinutes: 10 },
  },
  canGenerate: (...args: unknown[]) => mockCanGenerate(...args),
}));

vi.mock('@/lib/credits', () => ({
  consumeCredit: (...args: unknown[]) => mockConsumeCredit(...args),
}));

// ---- Import under test ----
import { POST } from '@/app/api/podcasts/[podcastId]/generate/route';

const mockContentExtractionQueue = {};

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
    mockPrismaSubscriptionFindUnique.mockResolvedValue({ creditsBalance: 5 });
    mockPrismaUserFindUnique.mockResolvedValue({ role: 'USER' });
    mockCanGenerate.mockReturnValue({ allowed: true, cost: 1 });
    mockConsumeCredit.mockResolvedValue(undefined);
  });

  it('returns 401 for unauthenticated request', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const request = createMockRequest();
    const params = await createMockParams('podcast-001');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({ error: 'Unauthorized' });
    expect(mockPrismaPodcastFindUnique).not.toHaveBeenCalled();
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
    expect(mockPrismaPodcastFindUnique).toHaveBeenCalledWith({
      where: { id: 'podcast-nonexistent' },
      include: {
        discovery: {
          select: { sourceUrl: true, sourceContent: true, durationTarget: true },
        },
      },
    });
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

  it('returns 400 when podcast is in EXTRACTING status', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      id: 'podcast-004',
      userId: 'user-001',
      status: 'EXTRACTING',
      discovery: null,
    });

    const request = createMockRequest();
    const params = await createMockParams('podcast-004');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('PENDING, DISCOVERING, or FAILED');
  });

  it('returns 400 when podcast is in SCRIPTING status', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      id: 'podcast-005',
      userId: 'user-001',
      status: 'SCRIPTING',
      discovery: null,
    });

    const request = createMockRequest();
    const params = await createMockParams('podcast-005');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('PENDING, DISCOVERING, or FAILED');
  });

  it('returns 402 when premium voice requested but no credits remaining', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      id: 'podcast-006',
      userId: 'user-001',
      status: 'PENDING',
      usePremiumVoice: true,
      discovery: null,
    });
    mockPrismaSubscriptionFindUnique.mockResolvedValue({ creditsBalance: 0 });
    mockCanGenerate.mockReturnValue({
      allowed: false,
      cost: 2,
      reason: 'Insufficient credits: need 2, have 0. Buy more credits or upgrade your plan.',
    });

    const request = createMockRequest();
    const params = await createMockParams('podcast-006');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(402);
    expect(data).toEqual({
      error: 'Insufficient credits: need 2, have 0. Buy more credits or upgrade your plan.',
    });
    expect(mockCanGenerate).toHaveBeenCalledWith(0, true, 'FREE', 'USER');
    expect(mockConsumeCredit).not.toHaveBeenCalled();
    expect(mockPrismaPodcastUpdate).not.toHaveBeenCalled();
  });

  it('successfully starts generation for PENDING podcast', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      id: 'podcast-007',
      userId: 'user-001',
      status: 'PENDING',
      usePremiumVoice: false,
      discovery: {
        sourceUrl: 'https://example.com/article',
        sourceContent: null,
      },
    });
    mockPrismaPodcastUpdate.mockResolvedValue({});

    const request = createMockRequest();
    const params = await createMockParams('podcast-007');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true, message: 'Generation started' });
    expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
      where: { id: 'podcast-007' },
      data: { status: 'EXTRACTING' },
    });
    expect(mockAddJob).toHaveBeenCalledWith(mockContentExtractionQueue, 'extract_content', {
      podcastId: 'podcast-007',
      userId: 'user-001',
      sourceUrl: 'https://example.com/article',
      sourceText: undefined,
    });
  });

  it('successfully starts generation for DISCOVERING podcast', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-002' });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      id: 'podcast-008',
      userId: 'user-002',
      status: 'DISCOVERING',
      usePremiumVoice: false,
      discovery: {
        sourceUrl: null,
        sourceContent: 'Manual source text',
      },
    });
    mockPrismaPodcastUpdate.mockResolvedValue({});

    const request = createMockRequest();
    const params = await createMockParams('podcast-008');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true, message: 'Generation started' });
    expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
      where: { id: 'podcast-008' },
      data: { status: 'EXTRACTING' },
    });
    expect(mockAddJob).toHaveBeenCalledWith(mockContentExtractionQueue, 'extract_content', {
      podcastId: 'podcast-008',
      userId: 'user-002',
      sourceUrl: undefined,
      sourceText: 'Manual source text',
    });
  });

  it('cleans up failed jobs before retrying FAILED podcast', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-003' });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      id: 'podcast-009',
      userId: 'user-003',
      status: 'FAILED',
      usePremiumVoice: false,
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
    expect(mockPrismaJobUpdateMany).toHaveBeenCalledWith({
      where: { podcastId: 'podcast-009', status: 'failed' },
      data: { status: 'superseded' },
    });
    expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
      where: { id: 'podcast-009' },
      data: { status: 'EXTRACTING' },
    });
  });

  it('does not clean up jobs for non-FAILED podcasts', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-004' });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      id: 'podcast-010',
      userId: 'user-004',
      status: 'PENDING',
      usePremiumVoice: false,
      discovery: null,
    });
    mockPrismaPodcastUpdate.mockResolvedValue({});

    const request = createMockRequest();
    const params = await createMockParams('podcast-010');
    const response = await POST(request, params);

    expect(response.status).toBe(200);
    expect(mockPrismaJobUpdateMany).not.toHaveBeenCalled();
  });

  it('consumes 2 credits when usePremiumVoice is true', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-005' });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      id: 'podcast-011',
      userId: 'user-005',
      status: 'PENDING',
      usePremiumVoice: true,
      discovery: null,
    });
    mockPrismaSubscriptionFindUnique.mockResolvedValue({ creditsBalance: 5 });
    mockCanGenerate.mockReturnValue({ allowed: true, cost: 2 });
    mockConsumeCredit.mockResolvedValue(undefined);
    mockPrismaPodcastUpdate.mockResolvedValue({});

    const request = createMockRequest();
    const params = await createMockParams('podcast-011');
    const response = await POST(request, params);

    expect(response.status).toBe(200);
    expect(mockCanGenerate).toHaveBeenCalledWith(5, true, 'FREE', 'USER');
    expect(mockConsumeCredit).toHaveBeenCalledWith(
      'user-005',
      2,
      'Podcast generation (premium voice)',
      'podcast-011'
    );
    expect(mockPrismaPodcastUpdate).toHaveBeenCalled();
  });

  it('consumes 1 credit when usePremiumVoice is false', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-006' });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      id: 'podcast-012',
      userId: 'user-006',
      status: 'PENDING',
      usePremiumVoice: false,
      discovery: null,
    });
    mockPrismaSubscriptionFindUnique.mockResolvedValue({ creditsBalance: 5 });
    mockCanGenerate.mockReturnValue({ allowed: true, cost: 1 });
    mockConsumeCredit.mockResolvedValue(undefined);
    mockPrismaPodcastUpdate.mockResolvedValue({});

    const request = createMockRequest();
    const params = await createMockParams('podcast-012');
    const response = await POST(request, params);

    expect(response.status).toBe(200);
    expect(mockCanGenerate).toHaveBeenCalledWith(5, false, 'FREE', 'USER');
    expect(mockConsumeCredit).toHaveBeenCalledWith(
      'user-006',
      1,
      'Podcast generation',
      'podcast-012'
    );
  });

  it('queues job with both sourceUrl and sourceContent when available', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-007' });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      id: 'podcast-013',
      userId: 'user-007',
      status: 'PENDING',
      usePremiumVoice: false,
      discovery: {
        sourceUrl: 'https://example.com/doc.pdf',
        sourceContent: 'Fallback content',
      },
    });
    mockPrismaPodcastUpdate.mockResolvedValue({});

    const request = createMockRequest();
    const params = await createMockParams('podcast-013');
    const response = await POST(request, params);

    expect(response.status).toBe(200);
    expect(mockAddJob).toHaveBeenCalledWith(mockContentExtractionQueue, 'extract_content', {
      podcastId: 'podcast-013',
      userId: 'user-007',
      sourceUrl: 'https://example.com/doc.pdf',
      sourceText: 'Fallback content',
    });
  });

  it('queues job with neither sourceUrl nor sourceContent when discovery has none', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-008' });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      id: 'podcast-014',
      userId: 'user-008',
      status: 'PENDING',
      usePremiumVoice: false,
      discovery: {
        sourceUrl: null,
        sourceContent: null,
      },
    });
    mockPrismaPodcastUpdate.mockResolvedValue({});

    const request = createMockRequest();
    const params = await createMockParams('podcast-014');
    const response = await POST(request, params);

    expect(response.status).toBe(200);
    expect(mockAddJob).toHaveBeenCalledWith(mockContentExtractionQueue, 'extract_content', {
      podcastId: 'podcast-014',
      userId: 'user-008',
      sourceUrl: undefined,
      sourceText: undefined,
    });
  });

  it('queues job with no discovery record', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-009' });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      id: 'podcast-015',
      userId: 'user-009',
      status: 'PENDING',
      usePremiumVoice: false,
      discovery: null,
    });
    mockPrismaPodcastUpdate.mockResolvedValue({});

    const request = createMockRequest();
    const params = await createMockParams('podcast-015');
    const response = await POST(request, params);

    expect(response.status).toBe(200);
    expect(mockAddJob).toHaveBeenCalledWith(mockContentExtractionQueue, 'extract_content', {
      podcastId: 'podcast-015',
      userId: 'user-009',
      sourceUrl: undefined,
      sourceText: undefined,
    });
  });

  it('updates status to EXTRACTING before queueing job', async () => {
    const updateOrder: string[] = [];

    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-010' });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      id: 'podcast-016',
      userId: 'user-010',
      status: 'PENDING',
      usePremiumVoice: false,
      discovery: null,
    });
    mockPrismaPodcastUpdate.mockImplementation(async () => {
      updateOrder.push('update');
      return {};
    });
    mockAddJob.mockImplementation(async () => {
      updateOrder.push('addJob');
    });

    const request = createMockRequest();
    const params = await createMockParams('podcast-016');
    await POST(request, params);

    expect(updateOrder).toEqual(['update', 'addJob']);
  });

  it('validates podcastId parameter is provided', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-011' });

    const request = createMockRequest();
    const params = await createMockParams('');

    mockPrismaPodcastFindUnique.mockResolvedValue(null);

    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: 'Podcast not found' });
  });

  it('includes discovery data in database query', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-012' });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      id: 'podcast-017',
      userId: 'user-012',
      status: 'PENDING',
      usePremiumVoice: false,
      discovery: {
        sourceUrl: 'https://test.com',
        sourceContent: 'test',
      },
    });
    mockPrismaPodcastUpdate.mockResolvedValue({});

    const request = createMockRequest();
    const params = await createMockParams('podcast-017');
    await POST(request, params);

    expect(mockPrismaPodcastFindUnique).toHaveBeenCalledWith({
      where: { id: 'podcast-017' },
      include: {
        discovery: {
          select: { sourceUrl: true, sourceContent: true, durationTarget: true },
        },
      },
    });
  });
});
