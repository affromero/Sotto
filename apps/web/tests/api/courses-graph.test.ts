import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---- Mocks ----

const mockAuthenticateRequest = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

const mockCourseFindFirst = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    course: {
      findFirst: (...args: unknown[]) => mockCourseFindFirst(...args),
    },
  },
}));

const mockGetMemoryGraph = vi.fn();

vi.mock('@/lib/knowledge-graph', () => ({
  getMemoryGraph: (...args: unknown[]) => mockGetMemoryGraph(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---- Import under test ----

import { GET } from '@/app/api/v1/courses/[courseId]/graph/route';

// ---- Helpers ----

function makeGetRequest(courseId: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v1/courses/${courseId}/graph`, {
    method: 'GET',
  });
}

function courseParams(courseId: string) {
  return { params: Promise.resolve({ courseId }) };
}

const SAMPLE_GRAPH = {
  nodes: [
    {
      id: 'v1',
      kind: 'vocab' as const,
      label: 'hola',
      translation: 'hello',
      strength: 0.7,
      due: true,
    },
    { id: 'g1', kind: 'grammar' as const, label: 'Articles', strength: 0.5, due: false },
  ],
  edges: [{ source: 'v1', target: 'g1', type: 'exemplifies', weight: 1.0 }],
};

// ---- Tests ----

describe('GET /api/v1/courses/[courseId]/graph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
    mockCourseFindFirst.mockResolvedValue({ id: 'course-1' });
    mockGetMemoryGraph.mockResolvedValue(SAMPLE_GRAPH);
  });

  it('returns 401 when the request is not authenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await GET(makeGetRequest('course-1'), courseParams('course-1'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
    expect(mockCourseFindFirst).not.toHaveBeenCalled();
    expect(mockGetMemoryGraph).not.toHaveBeenCalled();
  });

  it('returns 404 when the course does not exist or does not belong to the user', async () => {
    mockCourseFindFirst.mockResolvedValue(null);

    const response = await GET(makeGetRequest('course-1'), courseParams('course-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toMatch(/not found/i);
    expect(mockGetMemoryGraph).not.toHaveBeenCalled();
  });

  it('returns 200 with the memory graph when authenticated and course is owned', async () => {
    const response = await GET(makeGetRequest('course-1'), courseParams('course-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.nodes).toHaveLength(2);
    expect(body.edges).toHaveLength(1);
    expect(body.nodes[0]).toMatchObject({ id: 'v1', kind: 'vocab', label: 'hola' });
    expect(body.edges[0]).toMatchObject({ source: 'v1', target: 'g1' });
  });

  it('queries course with the authenticated userId as the owner filter', async () => {
    await GET(makeGetRequest('course-1'), courseParams('course-1'));

    expect(mockCourseFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'course-1', userId: 'u1' },
      })
    );
  });

  it('calls getMemoryGraph with the resolved courseId', async () => {
    await GET(makeGetRequest('course-42'), courseParams('course-42'));

    expect(mockGetMemoryGraph).toHaveBeenCalledWith('course-42');
  });

  it('passes dynamic params as a Promise (route contract)', async () => {
    // Ensure the handler awaits params correctly — pass a pending-then-resolved Promise
    let resolveParams!: (v: { courseId: string }) => void;
    const paramsPromise = new Promise<{ courseId: string }>((res) => {
      resolveParams = res;
    });
    // Resolve after a tick to confirm the route awaits it
    setImmediate(() => resolveParams({ courseId: 'course-1' }));

    const response = await GET(makeGetRequest('course-1'), { params: paramsPromise });

    expect(response.status).toBe(200);
  });
});
