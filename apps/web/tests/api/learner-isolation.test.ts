/**
 * Cross-learner isolation (adversarial).
 *
 * A self-hosted Sotto is multi-user: one household, many private learners. This
 * locks the invariant that learner B can never read learner A's course data —
 * the routes must scope every lookup by the authenticated userId, return 404 on
 * a foreign resource, and never touch the underlying data on a failed ownership
 * check. A regression that drops `userId` from the `where` clause fails here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

const mockCourseFindFirst = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    course: { findFirst: (...args: unknown[]) => mockCourseFindFirst(...args) },
  },
}));

const mockGetMemoryGraph = vi.fn();
vi.mock('@/lib/knowledge-graph', () => ({
  getMemoryGraph: (...args: unknown[]) => mockGetMemoryGraph(...args),
}));

const mockGetClassForUser = vi.fn();
const mockRegenerateFailedSections = vi.fn();
vi.mock('@/lib/class-service', () => ({
  getClassForUser: (...args: unknown[]) => mockGetClassForUser(...args),
  regenerateFailedSections: (...args: unknown[]) => mockRegenerateFailedSections(...args),
  CourseNotFoundError: class extends Error {},
}));

vi.mock('@/lib/api-response', () => ({
  errorResponse: (message: unknown, status: number) =>
    new Response(JSON.stringify({ error: message }), { status }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const OWNER = 'learner-A';
const INTRUDER = 'learner-B';

function req(path: string): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000${path}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  // course-A belongs to OWNER only — the findFirst where-clause is the gate.
  mockCourseFindFirst.mockImplementation((args: { where: { id: string; userId: string } }) => {
    const { id, userId } = args.where;
    return Promise.resolve(id === 'course-A' && userId === OWNER ? { id: 'course-A' } : null);
  });
  mockGetMemoryGraph.mockResolvedValue({ nodes: [], edges: [] });
  // class-A belongs to OWNER only.
  mockGetClassForUser.mockImplementation((_classId: string, userId: string) =>
    Promise.resolve(userId === OWNER ? { id: 'class-A', sections: [] } : null),
  );
});

afterEach(() => vi.clearAllMocks());

describe('GET /api/v1/courses/[courseId]/graph — memory graph isolation', () => {
  it("lets the owner read their own course graph", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: OWNER });
    const { GET } = await import('@/app/api/v1/courses/[courseId]/graph/route');
    const res = await GET(req('/api/v1/courses/course-A/graph'), {
      params: Promise.resolve({ courseId: 'course-A' }),
    });
    expect(res.status).toBe(200);
    expect(mockGetMemoryGraph).toHaveBeenCalledWith('course-A');
  });

  it("blocks another learner from reading course-A's graph (404, no data touched)", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: INTRUDER });
    const { GET } = await import('@/app/api/v1/courses/[courseId]/graph/route');
    const res = await GET(req('/api/v1/courses/course-A/graph'), {
      params: Promise.resolve({ courseId: 'course-A' }),
    });
    expect(res.status).toBe(404);
    // The intruder's userId was used in the lookup, and the graph was never read.
    expect(mockCourseFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'course-A', userId: INTRUDER } }),
    );
    expect(mockGetMemoryGraph).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request with 401', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    const { GET } = await import('@/app/api/v1/courses/[courseId]/graph/route');
    const res = await GET(req('/api/v1/courses/course-A/graph'), {
      params: Promise.resolve({ courseId: 'course-A' }),
    });
    expect(res.status).toBe(401);
    expect(mockCourseFindFirst).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/classes/[classId] — class isolation', () => {
  it('lets the owner read their own class', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: OWNER });
    const { GET } = await import('@/app/api/v1/classes/[classId]/route');
    const res = await GET(req('/api/v1/classes/class-A'), {
      params: Promise.resolve({ classId: 'class-A' }),
    });
    expect(res.status).toBe(200);
    expect(mockGetClassForUser).toHaveBeenCalledWith('class-A', OWNER);
  });

  it("blocks another learner from reading class-A (404)", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: INTRUDER });
    const { GET } = await import('@/app/api/v1/classes/[classId]/route');
    const res = await GET(req('/api/v1/classes/class-A'), {
      params: Promise.resolve({ classId: 'class-A' }),
    });
    expect(res.status).toBe(404);
    expect(mockGetClassForUser).toHaveBeenCalledWith('class-A', INTRUDER);
  });
});
