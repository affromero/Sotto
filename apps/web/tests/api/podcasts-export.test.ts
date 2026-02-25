import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---- Mocks ----

const mockAuth = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

const mockPrismaPodcastFindUnique = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    podcast: {
      findUnique: (...args: unknown[]) => mockPrismaPodcastFindUnique(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

const mockAddJob = vi.fn();

vi.mock('@/lib/queue', () => ({
  pdfGenerationQueue: {},
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: {
    GENERATE_PDF: 'generate_pdf',
  },
}));

// ---- Import under test ----
import { POST, GET } from '@/app/api/podcasts/[podcastId]/export/route';

const mockPdfGenerationQueue = {};

// ---- Helpers ----

function createMockRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/podcasts/test-id/export');
}

async function createMockParams(podcastId: string) {
  return { params: Promise.resolve({ podcastId }) };
}

// ---- Tests ----

describe('POST /api/podcasts/[podcastId]/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createMockRequest();
    const params = await createMockParams('podcast-001');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 401 when session has no user ID', async () => {
    mockAuth.mockResolvedValue({ user: {} });

    const request = createMockRequest();
    const params = await createMockParams('podcast-002');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 404 when podcast does not exist', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockPrismaPodcastFindUnique.mockResolvedValue(null);

    const request = createMockRequest();
    const params = await createMockParams('podcast-nonexistent');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toMatchObject({ error: 'Podcast not found' });
  });

  it('returns 404 when accessing private podcast owned by another user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      id: 'podcast-003',
      status: 'READY',
      pdfUrl: null,
      userId: 'user-002',
      visibility: 'PRIVATE',
    });

    const request = createMockRequest();
    const params = await createMockParams('podcast-003');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toMatchObject({ error: 'Not found' });
  });

  it('allows export of private podcast by owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      id: 'podcast-004',
      status: 'READY',
      pdfUrl: null,
      userId: 'user-001',
      visibility: 'PRIVATE',
    });

    const request = createMockRequest();
    const params = await createMockParams('podcast-004');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ status: 'generating' });
    expect(mockAddJob).toHaveBeenCalled();
  });

  it('allows export of public podcast by non-owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      id: 'podcast-005',
      status: 'READY',
      pdfUrl: null,
      userId: 'user-002',
      visibility: 'PUBLIC',
    });

    const request = createMockRequest();
    const params = await createMockParams('podcast-005');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ status: 'generating' });
    expect(mockAddJob).toHaveBeenCalledWith(mockPdfGenerationQueue, 'generate_pdf', {
      podcastId: 'podcast-005',
      userId: 'user-001',
    });
  });

  it('allows export of unlisted podcast by non-owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      id: 'podcast-006',
      status: 'READY',
      pdfUrl: null,
      userId: 'user-002',
      visibility: 'UNLISTED',
    });

    const request = createMockRequest();
    const params = await createMockParams('podcast-006');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ status: 'generating' });
  });

  it('returns 400 when podcast status is not READY', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      id: 'podcast-007',
      status: 'PENDING',
      pdfUrl: null,
      userId: 'user-001',
      visibility: 'PUBLIC',
    });

    const request = createMockRequest();
    const params = await createMockParams('podcast-007');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toMatchObject({ error: 'Podcast must be in READY status to export' });
  });

  it('returns existing PDF URL immediately without queuing job when PDF exists', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      id: 'podcast-010',
      status: 'READY',
      pdfUrl: 'https://r2.example.com/pdfs/podcast-010.pdf',
      userId: 'user-001',
      visibility: 'PUBLIC',
    });

    const request = createMockRequest();
    const params = await createMockParams('podcast-010');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      status: 'ready',
      pdfUrl: 'https://r2.example.com/pdfs/podcast-010.pdf',
    });
  });

  it('queues PDF generation job when no PDF exists', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-002' } });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      id: 'podcast-011',
      status: 'READY',
      pdfUrl: null,
      userId: 'user-002',
      visibility: 'PUBLIC',
    });

    const request = createMockRequest();
    const params = await createMockParams('podcast-011');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ status: 'generating' });
    expect(mockAddJob).toHaveBeenCalledWith(mockPdfGenerationQueue, 'generate_pdf', {
      podcastId: 'podcast-011',
      userId: 'user-002',
    });
  });

  it('includes correct podcastId and userId in job data', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-003' } });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      id: 'podcast-012',
      status: 'READY',
      pdfUrl: null,
      userId: 'user-004',
      visibility: 'PUBLIC',
    });

    const request = createMockRequest();
    const params = await createMockParams('podcast-012');
    await POST(request, params);

    expect(mockAddJob).toHaveBeenCalledWith(mockPdfGenerationQueue, 'generate_pdf', {
      podcastId: 'podcast-012',
      userId: 'user-003',
    });
  });
});

describe('GET /api/podcasts/[podcastId]/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createMockRequest();
    const params = await createMockParams('podcast-020');
    const response = await GET(request, params);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 401 when session has no user ID', async () => {
    mockAuth.mockResolvedValue({ user: {} });

    const request = createMockRequest();
    const params = await createMockParams('podcast-021');
    const response = await GET(request, params);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 404 when podcast does not exist', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockPrismaPodcastFindUnique.mockResolvedValue(null);

    const request = createMockRequest();
    const params = await createMockParams('podcast-nonexistent');
    const response = await GET(request, params);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toMatchObject({ error: 'Podcast not found' });
  });

  it('returns 404 when accessing private podcast owned by another user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      pdfUrl: null,
      userId: 'user-002',
      visibility: 'PRIVATE',
    });

    const request = createMockRequest();
    const params = await createMockParams('podcast-022');
    const response = await GET(request, params);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toMatchObject({ error: 'Not found' });
  });

  it('allows checking status of public podcast by non-owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      pdfUrl: 'https://r2.example.com/pdfs/podcast-023.pdf',
      userId: 'user-002',
      visibility: 'PUBLIC',
    });

    const request = createMockRequest();
    const params = await createMockParams('podcast-023');
    const response = await GET(request, params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      status: 'ready',
      pdfUrl: 'https://r2.example.com/pdfs/podcast-023.pdf',
    });
  });

  it('returns ready status with pdfUrl when PDF exists', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      pdfUrl: 'https://r2.example.com/pdfs/podcast-024.pdf',
      userId: 'user-001',
      visibility: 'PUBLIC',
    });

    const request = createMockRequest();
    const params = await createMockParams('podcast-024');
    const response = await GET(request, params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      status: 'ready',
      pdfUrl: 'https://r2.example.com/pdfs/podcast-024.pdf',
    });
  });

  it('returns idle status when PDF does not exist', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      pdfUrl: null,
      userId: 'user-001',
      visibility: 'PUBLIC',
    });

    const request = createMockRequest();
    const params = await createMockParams('podcast-025');
    const response = await GET(request, params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ status: 'idle', pdfUrl: null });
  });

  it('returns idle status when pdfUrl is empty string', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      pdfUrl: '',
      userId: 'user-001',
      visibility: 'PUBLIC',
    });

    const request = createMockRequest();
    const params = await createMockParams('podcast-026');
    const response = await GET(request, params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ status: 'idle', pdfUrl: null });
  });

  it('allows checking private podcast by owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      pdfUrl: 'https://r2.example.com/pdfs/podcast-027.pdf',
      userId: 'user-001',
      visibility: 'PRIVATE',
    });

    const request = createMockRequest();
    const params = await createMockParams('podcast-027');
    const response = await GET(request, params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      status: 'ready',
      pdfUrl: 'https://r2.example.com/pdfs/podcast-027.pdf',
    });
  });

  it('allows checking unlisted podcast by non-owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      pdfUrl: null,
      userId: 'user-002',
      visibility: 'UNLISTED',
    });

    const request = createMockRequest();
    const params = await createMockParams('podcast-028');
    const response = await GET(request, params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ status: 'idle', pdfUrl: null });
  });

});
