import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---- Mocks ----

const mockAuthenticateRequest = vi.fn();
vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

const mockCourseClassFindFirst = vi.fn();
const mockClassInkLayerUpsert = vi.fn();
const mockClassInkLayerFindMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    courseClass: {
      findFirst: (...args: unknown[]) => mockCourseClassFindFirst(...args),
    },
    classInkLayer: {
      upsert: (...args: unknown[]) => mockClassInkLayerUpsert(...args),
      findMany: (...args: unknown[]) => mockClassInkLayerFindMany(...args),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/api-response', () => ({
  errorResponse: (message: unknown, status: number, meta?: unknown) =>
    new Response(JSON.stringify({ error: message, ...(meta as object) }), { status }),
}));

// ---- Helpers ----

function makeRequest(method: string, body?: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/classes/class-1/ink', {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const PARAMS = Promise.resolve({ classId: 'class-1' });

async function getHandlers() {
  const mod = await import('@/app/api/v1/classes/[classId]/ink/route');
  return { POST: mod.POST, GET: mod.GET };
}

// ---- Tests ----

describe('POST /api/v1/classes/[classId]/ink', () => {
  let POST: Awaited<ReturnType<typeof getHandlers>>['POST'];

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ POST } = await getHandlers());
  });

  it('returns 401 when not authenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    const res = await POST(makeRequest('POST', { surface: 'page1', strokes: 'abc' }), { params: PARAMS });
    expect(res.status).toBe(401);
  });

  it('returns 404 when class not found or not owned', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockCourseClassFindFirst.mockResolvedValue(null);
    const res = await POST(makeRequest('POST', { surface: 'page1', strokes: 'abc' }), { params: PARAMS });
    expect(res.status).toBe(404);
  });

  it('returns 400 for missing surface', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockCourseClassFindFirst.mockResolvedValue({ id: 'class-1' });
    const res = await POST(makeRequest('POST', { strokes: 'abc' }), { params: PARAMS });
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty surface', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockCourseClassFindFirst.mockResolvedValue({ id: 'class-1' });
    const res = await POST(makeRequest('POST', { surface: '', strokes: 'abc' }), { params: PARAMS });
    expect(res.status).toBe(400);
  });

  it('returns 400 for surface exceeding 120 chars', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockCourseClassFindFirst.mockResolvedValue({ id: 'class-1' });
    const res = await POST(makeRequest('POST', { surface: 'x'.repeat(121), strokes: 'abc' }), { params: PARAMS });
    expect(res.status).toBe(400);
  });

  it('returns 400 for strokes exceeding 5_000_000 chars', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockCourseClassFindFirst.mockResolvedValue({ id: 'class-1' });
    const res = await POST(makeRequest('POST', { surface: 'page1', strokes: 'x'.repeat(5_000_001) }), { params: PARAMS });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON body', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockCourseClassFindFirst.mockResolvedValue({ id: 'class-1' });
    const req = new NextRequest('http://localhost:3000/api/v1/classes/class-1/ink', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const res = await POST(req, { params: PARAMS });
    expect(res.status).toBe(400);
  });

  it('upserts and returns 200 { ok: true } on valid request', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockCourseClassFindFirst.mockResolvedValue({ id: 'class-1' });
    mockClassInkLayerUpsert.mockResolvedValue({});

    const res = await POST(makeRequest('POST', { surface: 'page1', strokes: 'base64data' }), { params: PARAMS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    expect(mockClassInkLayerUpsert).toHaveBeenCalledWith({
      where: { classId_surface: { classId: 'class-1', surface: 'page1' } },
      create: { classId: 'class-1', surface: 'page1', strokes: 'base64data' },
      update: { strokes: 'base64data' },
    });
  });

  it('queries ownership with the authenticated userId', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-42' });
    mockCourseClassFindFirst.mockResolvedValue({ id: 'class-1' });
    mockClassInkLayerUpsert.mockResolvedValue({});

    await POST(makeRequest('POST', { surface: 'page1', strokes: 'data' }), { params: PARAMS });

    expect(mockCourseClassFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ course: { userId: 'user-42' } }),
      }),
    );
  });
});

describe('GET /api/v1/classes/[classId]/ink', () => {
  let GET: Awaited<ReturnType<typeof getHandlers>>['GET'];

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ GET } = await getHandlers());
  });

  it('returns 401 when not authenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    const res = await GET(makeRequest('GET'), { params: PARAMS });
    expect(res.status).toBe(401);
  });

  it('returns 404 when class not found or not owned', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockCourseClassFindFirst.mockResolvedValue(null);
    const res = await GET(makeRequest('GET'), { params: PARAMS });
    expect(res.status).toBe(404);
  });

  it('returns layers array on success', async () => {
    const fakeLayers = [
      { surface: 'page1', strokes: 'abc', updatedAt: new Date('2026-01-01') },
      { surface: 'page2', strokes: 'xyz', updatedAt: new Date('2026-01-02') },
    ];
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockCourseClassFindFirst.mockResolvedValue({ id: 'class-1' });
    mockClassInkLayerFindMany.mockResolvedValue(fakeLayers);

    const res = await GET(makeRequest('GET'), { params: PARAMS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.layers).toHaveLength(2);
    expect(body.layers[0].surface).toBe('page1');
    expect(body.layers[1].surface).toBe('page2');
  });

  it('returns empty layers array when none exist', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockCourseClassFindFirst.mockResolvedValue({ id: 'class-1' });
    mockClassInkLayerFindMany.mockResolvedValue([]);

    const res = await GET(makeRequest('GET'), { params: PARAMS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.layers).toEqual([]);
  });
});
