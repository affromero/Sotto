import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { NextRequest } from 'next/server';
import { PreparationConflictError } from '@/lib/classes/preparation-state';
import type { GET, DELETE } from '@/app/api/v1/courses/[courseId]/generation/route';

export function generationCases({
  GETGeneration,
  DELETEGeneration,
  makeRequest,
  mockAuthenticateRequest,
  mockCancelPreparation,
  mockDeleteClassForUser,
  mockCourseClassDeleteMany,
  mockCourseFindFirst,
  mockCourseUpdateMany,
  mockPreparationActivity,
  mockReadPreparation,
  mockTransaction,
}: {
  GETGeneration: typeof GET;
  DELETEGeneration: typeof DELETE;
  makeRequest: (url: string, method: string, body?: unknown) => NextRequest;
  mockAuthenticateRequest: Mock;
  mockCancelPreparation: Mock;
  mockDeleteClassForUser: Mock;
  mockCourseClassDeleteMany: Mock;
  mockCourseFindFirst: Mock;
  mockCourseUpdateMany: Mock;
  mockPreparationActivity: Mock;
  mockReadPreparation: Mock;
  mockTransaction: Mock;
}) {
  function courseParams(courseId: string) {
    return { params: Promise.resolve({ courseId }) };
  }

  // ---- GET /api/v1/courses/[courseId]/generation ----

  const EXPECTED_TEST_SKILLS = ['GRAMMAR', 'READING', 'LISTENING', 'SPEAKING', 'WRITING'];
  describe('GET /api/v1/courses/[courseId]/generation', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
      mockReadPreparation.mockResolvedValue(null);
      mockPreparationActivity.mockResolvedValue({
        operationId: 'operation-1',
        updatedAt: new Date(1000).toISOString(),
        providerRequestsCompleted: 4,
        providerRequestInFlight: true,
      });
    });

    function generationState(
      status: string,
      classId = 'older-class',
      classCreatedAt = 2000,
      attempt = 1,
      classStatus = 'AVAILABLE'
    ) {
      mockCourseFindFirst.mockResolvedValue({
        id: 'course-1',
        classes: [
          {
            id: 'current-class',
            status: classStatus,
            attempt,
            createdAt: new Date(classCreatedAt),
            updatedAt: new Date(3000),
            lesson: { title: 'Current lesson' },
            sections: [],
          },
        ],
      });
      mockReadPreparation.mockResolvedValue({
        id: 'operation-1',
        status,
        classId,
        result: status === 'COMPLETED' ? 'done' : null,
        createdAt: 500,
        updatedAt: 1000,
        availableAt: 500,
        timeZone: 'UTC',
        maxProviderRequests: 20,
        deferAudio: true,
        audioEpisodeIds: [],
        selection: {
          provider: 'meta',
          model: 'muse-spark-1.3',
          credentialFingerprint: 'private-binding',
        },
        grant: { revision: 'private-grant' },
      });
    }
    async function progress() {
      return (
        await GETGeneration(
          makeRequest('http://localhost/api/v1/courses/course-1/generation', 'GET'),
          courseParams('course-1')
        )
      ).json();
    }
    it.each(['FAILED', 'CANCELLED', 'COMPLETED'])(
      'shows a newer class after terminal preparation %s',
      async (status) => {
        generationState(status);
        const body = await progress();
        expect(body).toMatchObject({
          classId: 'current-class',
          status: 'AVAILABLE',
          lessonTitle: 'Current lesson',
        });
        expect(body).not.toHaveProperty('operationId');
        expect(body).not.toHaveProperty('aiProvider');
      }
    );
    it.each(['QUEUED', 'RUNNING', 'CANCELLING', 'UNRESOLVED'])(
      'keeps unresolved or active preparation visible: %s',
      async (status) => {
        generationState(status, 'current-class', 500, 2);
        expect(await progress()).toMatchObject({
          operationId: 'operation-1',
          operationStatus: status,
        });
      }
    );
    it('shows section milestones and provider activity while durable preparation is running', async () => {
      generationState('RUNNING', 'current-class', 500, 1, 'GENERATING');
      const course = await mockCourseFindFirst();
      course.classes[0].sections = [
        {
          skill: 'GRAMMAR',
          status: 'READY',
          attempt: 1,
          withdrawn: false,
          updatedAt: new Date(4000),
          episode: null,
        },
        {
          skill: 'READING',
          status: 'PENDING',
          attempt: 1,
          withdrawn: false,
          updatedAt: new Date(5000),
          episode: null,
        },
      ];
      mockCourseFindFirst.mockResolvedValue(course);
      expect(await progress()).toMatchObject({
        operationStatus: 'RUNNING',
        status: 'GENERATING',
        stage: 'Generating reading questions',
        progress: 0.34,
        currentStep: 2,
        updatedAt: new Date(5000).toISOString(),
        providerRequestsCompleted: 4,
        providerRequestInFlight: true,
      });
    });
    it('excludes old section attempts from whole-class regeneration progress', async () => {
      generationState('RUNNING', 'current-class', 500, 2, 'GENERATING');
      mockReadPreparation.mockResolvedValue({
        ...(await mockReadPreparation()),
        intent: { kind: 'REGENERATE', attempt: 2, skills: EXPECTED_TEST_SKILLS },
      });
      const course = await mockCourseFindFirst();
      course.classes[0].sections = EXPECTED_TEST_SKILLS.map((skill) => ({
        skill,
        status: 'READY',
        attempt: 1,
        withdrawn: false,
        updatedAt: new Date(9000),
        episode: null,
      }));
      mockCourseFindFirst.mockResolvedValue(course);
      expect(await progress()).toMatchObject({
        stage: 'Preparing class',
        progress: 0,
        sections: [],
        updatedAt: new Date(3000).toISOString(),
      });
    });
    it('counts preserved passed material when repairing another skill', async () => {
      generationState('RUNNING', 'current-class', 500, 2, 'GENERATING');
      mockReadPreparation.mockResolvedValue({
        ...(await mockReadPreparation()),
        intent: { kind: 'REPAIR', attempt: 2, skills: ['READING'] },
      });
      const course = await mockCourseFindFirst();
      course.classes[0].sections = [
        {
          skill: 'GRAMMAR',
          status: 'PASSED',
          attempt: 1,
          withdrawn: false,
          updatedAt: new Date(3000),
          episode: null,
        },
        {
          skill: 'READING',
          status: 'PENDING',
          attempt: 2,
          withdrawn: false,
          updatedAt: new Date(5000),
          episode: null,
        },
      ];
      mockCourseFindFirst.mockResolvedValue(course);
      expect(await progress()).toMatchObject({
        stage: 'Generating reading questions',
        progress: 0.34,
      });
    });
    it('does not combine activity from a replacement preparation', async () => {
      generationState('RUNNING', 'current-class', 500);
      mockPreparationActivity.mockResolvedValue({ operationId: 'new-operation' });
      const response = await GETGeneration(
        makeRequest('http://localhost/api/v1/courses/course-1/generation', 'GET'),
        courseParams('course-1')
      );
      expect(response.status).toBe(409);
    });
    it.each([
      ['FAILED', 'GENERATING'],
      ['FAILED', 'AVAILABLE'],
      ['FAILED', 'FAILED'],
      ['CANCELLED', 'GENERATING'],
      ['CANCELLED', 'AVAILABLE'],
      ['CANCELLED', 'FAILED'],
      ['COMPLETED', 'AVAILABLE'],
    ])('shows the regenerated class after %s preparation as %s', async (status, classStatus) => {
      generationState(status, 'current-class', 500, 2, classStatus);
      mockReadPreparation.mockResolvedValue({
        ...(await mockReadPreparation()),
        result: status === 'COMPLETED' ? 'gated' : null,
      });
      const body = await progress();
      expect(body).toMatchObject({ classId: 'current-class', status: classStatus });
      expect(body).not.toHaveProperty('operationId');
    });
    it.each(['FAILED', 'CANCELLED'])(
      'keeps %s visible for the matching repair attempt',
      async (status) => {
        generationState(status, 'current-class', 500, 3, 'FAILED');
        mockReadPreparation.mockResolvedValue({
          ...(await mockReadPreparation()),
          intent: { kind: 'REPAIR', classId: 'current-class', attempt: 3 },
        });
        expect(await progress()).toMatchObject({
          operationId: 'operation-1',
          operationStatus: status,
        });
      }
    );
    it('keeps cancellation visible for the original class attempt', async () => {
      generationState('CANCELLED', 'current-class', 500);
      expect(await progress()).toMatchObject({
        operationId: 'operation-1',
        operationStatus: 'CANCELLED',
      });
    });
    it.each(['FAILED', 'CANCELLED', 'COMPLETED'])(
      'retains terminal preparation when the other class is not newer: %s',
      async (status) => {
        generationState(status, 'older-class', 1000);
        expect(await progress()).toMatchObject({
          operationId: 'operation-1',
          operationStatus: status,
        });
      }
    );
    it('preserves public operation metadata with matching completed class progress', async () => {
      generationState('COMPLETED', 'current-class');
      const operation = await mockReadPreparation();
      mockReadPreparation.mockResolvedValue({ ...operation, result: 'created' });
      const body = await progress();
      expect(body).toMatchObject({
        operationId: 'operation-1',
        operationStatus: 'COMPLETED',
        classId: 'current-class',
        status: 'AVAILABLE',
        stage: 'Class ready',
        progress: 1,
        aiProvider: 'meta',
        aiModel: 'muse-spark-1.3',
        maxProviderRequests: 20,
      });
      expect(JSON.stringify(body)).not.toContain('private-');
    });

    it('reports the durable task before a class record exists without exposing authority data', async () => {
      mockCourseFindFirst.mockResolvedValue({ id: 'course-1', classes: [] });
      mockReadPreparation.mockResolvedValue({
        id: 'operation-1',
        status: 'QUEUED',
        classId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        availableAt: Date.now(),
        timeZone: 'America/Bogota',
        maxProviderRequests: 20,
        deferAudio: true,
        selection: {
          provider: 'meta',
          model: 'muse-spark-1.3',
          credentialFingerprint: 'private-fingerprint',
        },
        grant: { revision: 'private-grant-revision' },
      });
      const response = await GETGeneration(
        makeRequest('http://localhost/api/v1/courses/course-1/generation', 'GET'),
        courseParams('course-1')
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        operationId: 'operation-1',
        operationStatus: 'QUEUED',
        classId: null,
        stage: 'Queued preparation',
        audioRequiresReview: true,
        maxProviderRequests: 20,
      });
      expect(JSON.stringify(body)).not.toContain('private-');
    });

    it('reports pending listening audio when the class is available but audioUrl is missing', async () => {
      mockCourseFindFirst.mockResolvedValue({
        id: 'course-1',
        classes: [
          {
            id: 'class-1',
            status: 'AVAILABLE',
            createdAt: new Date(Date.now() - 60_000),
            updatedAt: new Date(),
            lesson: { title: 'Past events' },
            sections: [
              {
                skill: 'GRAMMAR',
                status: 'READY',
                attempt: 1,
                withdrawn: false,
                updatedAt: new Date(),
                episode: null,
              },
              {
                skill: 'READING',
                status: 'READY',
                attempt: 1,
                withdrawn: false,
                updatedAt: new Date(),
                episode: null,
              },
              {
                skill: 'LISTENING',
                attempt: 1,
                withdrawn: false,
                updatedAt: new Date(),
                status: 'READY',
                episode: { status: 'STITCHING', audioUrl: null, updatedAt: new Date() },
              },
              {
                skill: 'SPEAKING',
                status: 'READY',
                attempt: 1,
                withdrawn: false,
                updatedAt: new Date(),
                episode: null,
              },
              {
                skill: 'WRITING',
                status: 'READY',
                attempt: 1,
                withdrawn: false,
                updatedAt: new Date(),
                episode: null,
              },
            ],
          },
        ],
      });

      const res = await GETGeneration(
        makeRequest('http://localhost/api/v1/courses/course-1/generation', 'GET'),
        courseParams('course-1')
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.stage).toBe('Rendering listening audio');
      expect(body.detail).toMatch(/stitching/i);
      expect(body.progress).toBeLessThan(1);
    });

    it('reports a stuck class when listening audio is ready but audioUrl is missing', async () => {
      mockCourseFindFirst.mockResolvedValue({
        id: 'course-1',
        classes: [
          {
            id: 'class-1',
            status: 'AVAILABLE',
            createdAt: new Date(Date.now() - 60_000),
            updatedAt: new Date(),
            lesson: { title: 'Past events' },
            sections: [
              {
                skill: 'GRAMMAR',
                status: 'READY',
                attempt: 1,
                withdrawn: false,
                updatedAt: new Date(),
                episode: null,
              },
              {
                skill: 'READING',
                status: 'READY',
                attempt: 1,
                withdrawn: false,
                updatedAt: new Date(),
                episode: null,
              },
              {
                skill: 'LISTENING',
                attempt: 1,
                withdrawn: false,
                updatedAt: new Date(),
                status: 'READY',
                episode: { status: 'READY', audioUrl: null, updatedAt: new Date() },
              },
              {
                skill: 'SPEAKING',
                status: 'READY',
                attempt: 1,
                withdrawn: false,
                updatedAt: new Date(),
                episode: null,
              },
              {
                skill: 'WRITING',
                status: 'READY',
                attempt: 1,
                withdrawn: false,
                updatedAt: new Date(),
                episode: null,
              },
            ],
          },
        ],
      });

      const res = await GETGeneration(
        makeRequest('http://localhost/api/v1/courses/course-1/generation', 'GET'),
        courseParams('course-1')
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.stage).toBe('Class needs attention');
      expect(body.detail).toMatch(/open this class/i);
      expect(body.progress).toBe(1);
    });
  });

  // ---- DELETE /api/v1/courses/[courseId]/generation ----

  describe('DELETE /api/v1/courses/[courseId]/generation', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
      mockCancelPreparation.mockResolvedValue(null);
      mockDeleteClassForUser.mockResolvedValue(true);
      mockCourseUpdateMany.mockResolvedValue({ count: 1 });
      mockCourseClassDeleteMany.mockResolvedValue({ count: 1 });
      mockTransaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
    });

    it('returns 401 when unauthenticated', async () => {
      mockAuthenticateRequest.mockResolvedValue(null);

      const res = await DELETEGeneration(
        makeRequest('http://localhost/api/v1/courses/course-1/generation', 'DELETE'),
        courseParams('course-1')
      );

      expect(res.status).toBe(401);
    });

    it('returns 404 when the course is missing', async () => {
      mockCourseFindFirst.mockResolvedValue(null);

      const res = await DELETEGeneration(
        makeRequest('http://localhost/api/v1/courses/course-1/generation', 'DELETE'),
        courseParams('course-1')
      );

      expect(res.status).toBe(404);
    });

    it.each(['CANCELLED', 'CANCELLING'])(
      'cancels durable work before a class exists: %s',
      async (status) => {
        mockCancelPreparation.mockResolvedValue({ id: 'operation-1', status, classId: null });
        const response = await DELETEGeneration(
          makeRequest('http://localhost/api/v1/courses/course-1/generation', 'DELETE'),
          courseParams('course-1')
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          cancelled: status === 'CANCELLED',
          cancelling: status === 'CANCELLING',
          operationId: 'operation-1',
          classId: null,
        });
      }
    );

    it('surfaces revoked cancellation authority without deleting legacy work', async () => {
      mockCancelPreparation.mockRejectedValue(new PreparationConflictError('The learner changed.'));
      const response = await DELETEGeneration(
        makeRequest('http://localhost/api/v1/courses/course-1/generation', 'DELETE'),
        courseParams('course-1')
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: 'The learner changed.' });
    });

    it('deletes the current generating legacy class and clears activeClassId', async () => {
      mockCourseFindFirst.mockResolvedValue({
        id: 'course-1',
        classes: [{ id: 'class-generating', createdAt: new Date(1000), attempt: 1 }],
      });

      const res = await DELETEGeneration(
        makeRequest('http://localhost/api/v1/courses/course-1/generation', 'DELETE'),
        courseParams('course-1')
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ cancelled: true, classId: 'class-generating' });
      expect(mockCourseClassDeleteMany).not.toHaveBeenCalled();
    });

    it('keeps the legacy class when verified deletion needs recovery', async () => {
      mockCourseFindFirst.mockResolvedValue({
        id: 'course-1',
        classes: [{ id: 'class-generating', createdAt: new Date(1000), attempt: 1 }],
      });
      mockDeleteClassForUser.mockResolvedValue(false);
      const response = await DELETEGeneration(
        makeRequest('http://localhost/api/v1/courses/course-1/generation', 'DELETE'),
        courseParams('course-1')
      );
      expect(response.status).toBe(409);
      expect(mockCourseClassDeleteMany).not.toHaveBeenCalled();
    });

    it('is a no-op when no class is generating', async () => {
      mockCourseFindFirst.mockResolvedValue({ id: 'course-1', classes: [] });

      const res = await DELETEGeneration(
        makeRequest('http://localhost/api/v1/courses/course-1/generation', 'DELETE'),
        courseParams('course-1')
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ cancelled: false });
      expect(mockTransaction).not.toHaveBeenCalled();
    });
  });
}
