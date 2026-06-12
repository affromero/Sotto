import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---- Mocks ----

const mockAuth = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

const mockPrismaEpisodeFindUnique = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    episode: {
      findUnique: (...args: unknown[]) => mockPrismaEpisodeFindUnique(...args),
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
import { POST, GET } from '@/app/api/v1/episodes/[episodeId]/export/route';

const mockPdfGenerationQueue = {};

// ---- Helpers ----

function createMockRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/episodes/test-id/export');
}

async function createMockParams(episodeId: string) {
  return { params: Promise.resolve({ episodeId }) };
}

// ---- Tests ----

describe('POST /api/v1/episodes/[episodeId]/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createMockRequest();
    const params = await createMockParams('episode-001');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 401 when session has no user ID', async () => {
    mockAuth.mockResolvedValue({ user: {} });

    const request = createMockRequest();
    const params = await createMockParams('episode-002');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 404 when episode does not exist', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockPrismaEpisodeFindUnique.mockResolvedValue(null);

    const request = createMockRequest();
    const params = await createMockParams('episode-nonexistent');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toMatchObject({ error: 'Episode not found' });
  });

  it('returns 404 when accessing private episode owned by another user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockPrismaEpisodeFindUnique.mockResolvedValue({
      id: 'episode-003',
      status: 'READY',
      pdfUrl: null,
      userId: 'user-002',
      visibility: 'PRIVATE',
    });

    const request = createMockRequest();
    const params = await createMockParams('episode-003');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toMatchObject({ error: 'Not found' });
  });

  it('allows export of private episode by owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockPrismaEpisodeFindUnique.mockResolvedValue({
      id: 'episode-004',
      status: 'READY',
      pdfUrl: null,
      userId: 'user-001',
      visibility: 'PRIVATE',
    });

    const request = createMockRequest();
    const params = await createMockParams('episode-004');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ status: 'generating' });
    expect(mockAddJob).toHaveBeenCalled();
  });

  it('allows export of public episode by non-owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockPrismaEpisodeFindUnique.mockResolvedValue({
      id: 'episode-005',
      status: 'READY',
      pdfUrl: null,
      userId: 'user-002',
      visibility: 'PUBLIC',
    });

    const request = createMockRequest();
    const params = await createMockParams('episode-005');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ status: 'generating' });
    expect(mockAddJob).toHaveBeenCalledWith(mockPdfGenerationQueue, 'generate_pdf', {
      episodeId: 'episode-005',
      userId: 'user-001',
    });
  });

  it('allows export of unlisted episode by non-owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockPrismaEpisodeFindUnique.mockResolvedValue({
      id: 'episode-006',
      status: 'READY',
      pdfUrl: null,
      userId: 'user-002',
      visibility: 'UNLISTED',
    });

    const request = createMockRequest();
    const params = await createMockParams('episode-006');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ status: 'generating' });
  });

  it('returns 400 when episode status is not READY', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockPrismaEpisodeFindUnique.mockResolvedValue({
      id: 'episode-007',
      status: 'PENDING',
      pdfUrl: null,
      userId: 'user-001',
      visibility: 'PUBLIC',
    });

    const request = createMockRequest();
    const params = await createMockParams('episode-007');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toMatchObject({ error: 'Episode must be in READY status to export' });
  });

  it('returns existing PDF URL immediately without queuing job when PDF exists', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockPrismaEpisodeFindUnique.mockResolvedValue({
      id: 'episode-010',
      status: 'READY',
      pdfUrl: 'https://r2.example.com/pdfs/episode-010.pdf',
      userId: 'user-001',
      visibility: 'PUBLIC',
    });

    const request = createMockRequest();
    const params = await createMockParams('episode-010');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      status: 'ready',
      pdfUrl: 'https://r2.example.com/pdfs/episode-010.pdf',
    });
  });

  it('queues PDF generation job when no PDF exists', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-002' } });
    mockPrismaEpisodeFindUnique.mockResolvedValue({
      id: 'episode-011',
      status: 'READY',
      pdfUrl: null,
      userId: 'user-002',
      visibility: 'PUBLIC',
    });

    const request = createMockRequest();
    const params = await createMockParams('episode-011');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ status: 'generating' });
    expect(mockAddJob).toHaveBeenCalledWith(mockPdfGenerationQueue, 'generate_pdf', {
      episodeId: 'episode-011',
      userId: 'user-002',
    });
  });

  it('includes correct episodeId and userId in job data', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-003' } });
    mockPrismaEpisodeFindUnique.mockResolvedValue({
      id: 'episode-012',
      status: 'READY',
      pdfUrl: null,
      userId: 'user-004',
      visibility: 'PUBLIC',
    });

    const request = createMockRequest();
    const params = await createMockParams('episode-012');
    await POST(request, params);

    expect(mockAddJob).toHaveBeenCalledWith(mockPdfGenerationQueue, 'generate_pdf', {
      episodeId: 'episode-012',
      userId: 'user-003',
    });
  });
});

describe('GET /api/v1/episodes/[episodeId]/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createMockRequest();
    const params = await createMockParams('episode-020');
    const response = await GET(request, params);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 401 when session has no user ID', async () => {
    mockAuth.mockResolvedValue({ user: {} });

    const request = createMockRequest();
    const params = await createMockParams('episode-021');
    const response = await GET(request, params);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 404 when episode does not exist', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockPrismaEpisodeFindUnique.mockResolvedValue(null);

    const request = createMockRequest();
    const params = await createMockParams('episode-nonexistent');
    const response = await GET(request, params);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toMatchObject({ error: 'Episode not found' });
  });

  it('returns 404 when accessing private episode owned by another user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockPrismaEpisodeFindUnique.mockResolvedValue({
      pdfUrl: null,
      userId: 'user-002',
      visibility: 'PRIVATE',
    });

    const request = createMockRequest();
    const params = await createMockParams('episode-022');
    const response = await GET(request, params);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toMatchObject({ error: 'Not found' });
  });

  it('allows checking status of public episode by non-owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockPrismaEpisodeFindUnique.mockResolvedValue({
      pdfUrl: 'https://r2.example.com/pdfs/episode-023.pdf',
      userId: 'user-002',
      visibility: 'PUBLIC',
    });

    const request = createMockRequest();
    const params = await createMockParams('episode-023');
    const response = await GET(request, params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      status: 'ready',
      pdfUrl: 'https://r2.example.com/pdfs/episode-023.pdf',
    });
  });

  it('returns ready status with pdfUrl when PDF exists', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockPrismaEpisodeFindUnique.mockResolvedValue({
      pdfUrl: 'https://r2.example.com/pdfs/episode-024.pdf',
      userId: 'user-001',
      visibility: 'PUBLIC',
    });

    const request = createMockRequest();
    const params = await createMockParams('episode-024');
    const response = await GET(request, params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      status: 'ready',
      pdfUrl: 'https://r2.example.com/pdfs/episode-024.pdf',
    });
  });

  it('returns idle status when PDF does not exist', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockPrismaEpisodeFindUnique.mockResolvedValue({
      pdfUrl: null,
      userId: 'user-001',
      visibility: 'PUBLIC',
    });

    const request = createMockRequest();
    const params = await createMockParams('episode-025');
    const response = await GET(request, params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ status: 'idle', pdfUrl: null });
  });

  it('returns idle status when pdfUrl is empty string', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockPrismaEpisodeFindUnique.mockResolvedValue({
      pdfUrl: '',
      userId: 'user-001',
      visibility: 'PUBLIC',
    });

    const request = createMockRequest();
    const params = await createMockParams('episode-026');
    const response = await GET(request, params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ status: 'idle', pdfUrl: null });
  });

  it('allows checking private episode by owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockPrismaEpisodeFindUnique.mockResolvedValue({
      pdfUrl: 'https://r2.example.com/pdfs/episode-027.pdf',
      userId: 'user-001',
      visibility: 'PRIVATE',
    });

    const request = createMockRequest();
    const params = await createMockParams('episode-027');
    const response = await GET(request, params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      status: 'ready',
      pdfUrl: 'https://r2.example.com/pdfs/episode-027.pdf',
    });
  });

  it('allows checking unlisted episode by non-owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockPrismaEpisodeFindUnique.mockResolvedValue({
      pdfUrl: null,
      userId: 'user-002',
      visibility: 'UNLISTED',
    });

    const request = createMockRequest();
    const params = await createMockParams('episode-028');
    const response = await GET(request, params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ status: 'idle', pdfUrl: null });
  });

});
