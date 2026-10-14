import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  SAMPLE_CLASS_UNSUBMITTED,
  SAMPLE_CLASS_SPEAKING,
  SAMPLE_CLASS_LISTENING,
  SAMPLE_CLASS_SUBMITTED,
} from './classes/fixtures';

// ---- Mocks ----

const mockAuthenticateRequest = vi.fn();
const mockCourseFindFirst = vi.fn();
const mockCourseUpdateMany = vi.fn();
const mockCourseClassFindFirst = vi.fn();
const mockCourseClassDeleteMany = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    course: {
      findFirst: (...args: unknown[]) => mockCourseFindFirst(...args),
      updateMany: (...args: unknown[]) => mockCourseUpdateMany(...args),
    },
    courseClass: {
      findFirst: (...args: unknown[]) => mockCourseClassFindFirst(...args),
      deleteMany: (...args: unknown[]) => mockCourseClassDeleteMany(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

const mockGetClassForUser = vi.fn();
const mockSubmitClass = vi.fn();
const mockDeleteClassForUser = vi.fn();
const mockReadPreparation = vi.fn();
const mockPreparationActivity = vi.fn();
const mockCancelPreparation = vi.fn();
const mockRequestPreparation = vi.fn();

vi.mock('@/lib/classes/preparation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/classes/preparation')>()),
  requestClassPreparation: (...args: unknown[]) => mockRequestPreparation(...args),
  readClassPreparation: (...args: unknown[]) => mockReadPreparation(...args),
  readPreparationActivity: (...args: unknown[]) => mockPreparationActivity(...args),
  cancelClassPreparation: (...args: unknown[]) => mockCancelPreparation(...args),
}));

vi.mock('@/lib/class-service', () => {
  class CourseNotFoundError extends Error {}
  class ClassGenerationCancelledError extends Error {}
  class ClassIncompleteError extends Error {}
  return {
    ClassIncompleteError,
    getClassForUser: (...args: unknown[]) => mockGetClassForUser(...args),
    submitClass: (...args: unknown[]) => mockSubmitClass(...args),
    deleteClassForUser: (...args: unknown[]) => mockDeleteClassForUser(...args),
    CourseNotFoundError,
    ClassGenerationCancelledError,
  };
});

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---- Imports under test ----
import { DELETE as DELETEClass, GET, POST } from '@/app/api/v1/classes/[classId]/route';
import { POST as POSTSubmit } from '@/app/api/v1/classes/[classId]/submit/route';
import {
  DELETE as DELETEGeneration,
  GET as GETGeneration,
} from '@/app/api/v1/courses/[courseId]/generation/route';
import { PreparationConflictError } from '@/lib/classes/preparation-state';
import { ClassIncompleteError } from '@/lib/class-service';

// ---- Helpers ----

function makeRequest(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function classParams(classId: string) {
  return { params: Promise.resolve({ classId }) };
}

function courseParams(courseId: string) {
  return { params: Promise.resolve({ courseId }) };
}

// ---- GET /api/v1/classes/[classId] ----

describe('GET /api/v1/classes/[classId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const res = await GET(
      makeRequest('http://localhost/api/v1/classes/class-1', 'GET'),
      classParams('class-1')
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized/i);
  });

  it('returns 404 when getClassForUser returns null', async () => {
    mockGetClassForUser.mockResolvedValue(null);

    const res = await GET(
      makeRequest('http://localhost/api/v1/classes/class-1', 'GET'),
      classParams('class-1')
    );

    expect(res.status).toBe(404);
  });

  it('provides immediate practice feedback before final submission', async () => {
    mockGetClassForUser.mockResolvedValue(SAMPLE_CLASS_UNSUBMITTED);

    const res = await GET(
      makeRequest('http://localhost/api/v1/classes/class-1', 'GET'),
      classParams('class-1')
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.submitted).toBe(false);
    expect(body.vocabulary).toEqual([{ lemma: 'hola', gloss: 'hello', pos: null }]);

    const questions = body.sections[0].questions;
    expect(questions[0]).toMatchObject({
      correctIndex: SAMPLE_CLASS_UNSUBMITTED.sections[0].questions[0].correctIndex,
      explanation: SAMPLE_CLASS_UNSUBMITTED.sections[0].questions[0].explanation,
    });
  });

  it('returns SPEAKING section prompts (phrase + translation + reference audio)', async () => {
    mockGetClassForUser.mockResolvedValue(SAMPLE_CLASS_SPEAKING);

    const res = await GET(
      makeRequest('http://localhost/api/v1/classes/class-1', 'GET'),
      classParams('class-1')
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    const prompts = body.sections[0].prompts;
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({
      id: 'p1',
      targetPhrase: 'Hola',
      translation: 'Hello',
      referenceTtsUrl: 'https://r2/ref.mp3',
      latestRecording: {
        id: 'rec-1',
        status: 'SCORED',
        transcript: 'Hola',
        overallScore: 0.91,
        rubricScores: { accuracy: 0.93, fluency: 0.89, completeness: 0.92 },
        phonemeScores: [{ op: 'match', expected: 'hola', actual: 'hola' }],
        feedback: 'Clear pronunciation.',
      },
    });
  });

  it('returns the LISTENING episode (audio url + title) for the player', async () => {
    mockGetClassForUser.mockResolvedValue(SAMPLE_CLASS_LISTENING);

    const res = await GET(
      makeRequest('http://localhost/api/v1/classes/class-1', 'GET'),
      classParams('class-1')
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sections[0].episode).toMatchObject({
      id: 'pod-1',
      audioUrl: 'https://r2/listen.mp3',
      status: 'READY',
      title: 'Listening',
    });
  });

  it('includes correctIndex and explanation after submission', async () => {
    mockGetClassForUser.mockResolvedValue(SAMPLE_CLASS_SUBMITTED);

    const res = await GET(
      makeRequest('http://localhost/api/v1/classes/class-1', 'GET'),
      classParams('class-1')
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.submitted).toBe(true);

    const questions = body.sections[0].questions;
    expect(questions[0]).toHaveProperty('correctIndex', 0);
    expect(questions[0]).toHaveProperty('explanation', 'Exp1');
  });

  it('returns the full class envelope', async () => {
    mockGetClassForUser.mockResolvedValue(SAMPLE_CLASS_UNSUBMITTED);

    const res = await GET(
      makeRequest('http://localhost/api/v1/classes/class-1', 'GET'),
      classParams('class-1')
    );

    const body = await res.json();
    expect(body.id).toBe('class-1');
    expect(body.status).toBe('IN_PROGRESS');
    expect(body.passThreshold).toBe(0.6);
    expect(body.lesson).toMatchObject({ title: 'Greetings' });
    expect(body.intro).toMatchObject({ purpose: 'Practice greetings.' });
    expect(body.sections).toHaveLength(1);
  });
});

// ---- POST /api/v1/classes/[classId] (regenerate) ----

describe('POST /api/v1/classes/[classId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
    mockCourseClassFindFirst.mockResolvedValue({ courseId: 'course-1', status: 'AVAILABLE' });
    mockRequestPreparation.mockResolvedValue({ id: 'operation-1', status: 'QUEUED' });
  });
  it('returns 401 without a learner', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    const response = await POST(
      makeRequest('http://localhost/api/v1/classes/class-1', 'POST', { expectedAttempt: 1 }),
      classParams('class-1')
    );
    expect(response.status).toBe(401);
  });
  it.each([
    { expectedAttempt: 1 },
    { scope: 'sections', expectedAttempt: 1 },
    { scope: 'class', expectedAttempt: 1 },
  ])('returns a durable preparation identity for %j', async (body) => {
    const response = await POST(
      makeRequest('http://localhost/api/v1/classes/class-1', 'POST', body),
      classParams('class-1')
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      started: true,
      status: 'GENERATING',
      courseId: 'course-1',
      operationId: 'operation-1',
      scope: body?.scope === 'class' ? 'class' : 'sections',
    });
  });
  it('returns a conflict for uncertain earlier work', async () => {
    mockRequestPreparation.mockRejectedValue(
      new PreparationConflictError('Execution cleanup is not confirmed.')
    );
    const response = await POST(
      makeRequest('http://localhost/api/v1/classes/class-1', 'POST', { expectedAttempt: 1 }),
      classParams('class-1')
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/cleanup.*confirmed/i),
    });
  });
  it.each([null, { courseId: 'course-1', status: 'PASSED' }])(
    'rejects an unavailable target: %j',
    async (target) => {
      mockCourseClassFindFirst.mockResolvedValue(target);
      const response = await POST(
        makeRequest('http://localhost/api/v1/classes/class-1', 'POST'),
        classParams('class-1')
      );
      expect(response.status).toBe(400);
    }
  );
});

// ---- DELETE /api/v1/classes/[classId] ----

describe('DELETE /api/v1/classes/[classId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const res = await DELETEClass(
      makeRequest('http://localhost/api/v1/classes/class-1', 'DELETE'),
      classParams('class-1')
    );

    expect(res.status).toBe(401);
  });

  it('deletes an owned class', async () => {
    mockDeleteClassForUser.mockResolvedValue(true);

    const res = await DELETEClass(
      makeRequest('http://localhost/api/v1/classes/class-1', 'DELETE'),
      classParams('class-1')
    );

    expect(res.status).toBe(200);
    expect(mockDeleteClassForUser).toHaveBeenCalledWith('class-1', 'u1');
    const body = await res.json();
    expect(body).toEqual({ deleted: true });
  });

  it('returns 404 when the class is not owned by the user', async () => {
    mockDeleteClassForUser.mockResolvedValue(false);

    const res = await DELETEClass(
      makeRequest('http://localhost/api/v1/classes/class-1', 'DELETE'),
      classParams('class-1')
    );

    expect(res.status).toBe(404);
  });
});

// ---- POST /api/v1/classes/[classId]/submit ----

describe('POST /api/v1/classes/[classId]/submit', () => {
  it('reports incomplete oral work as a conflict the learner can resolve', async () => {
    mockSubmitClass.mockRejectedValue(
      new ClassIncompleteError('Listening audio is still generating.')
    );
    const res = await POSTSubmit(
      makeRequest('http://localhost/api/v1/classes/class-1/submit', 'POST', {
        answers: [{ questionId: 'q1', selectedIndex: 0 }],
      }),
      { params: Promise.resolve({ classId: 'class-1' }) }
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/listening/i) });
  });
  const VALID_ANSWERS = [
    { questionId: 'q1', selectedIndex: 0 },
    { questionId: 'q2', selectedIndex: 1 },
  ];

  const SUBMIT_RESULT = {
    passed: true,
    overallScore: 1,
    passedSections: 1,
    totalSections: 1,
    sections: [{ id: 'sec-grammar', skill: 'GRAMMAR', score: 1, passed: true }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const res = await POSTSubmit(
      makeRequest('http://localhost/api/v1/classes/class-1/submit', 'POST', {
        answers: VALID_ANSWERS,
      }),
      classParams('class-1')
    );

    expect(res.status).toBe(401);
  });

  it('finishes a class whose graded work does not include multiple-choice answers', async () => {
    const result = {
      ...SUBMIT_RESULT,
      sections: [{ id: 'writing', skill: 'WRITING', score: 1, passed: true }],
    };
    mockSubmitClass.mockResolvedValue(result);
    const res = await POSTSubmit(
      makeRequest('http://localhost/api/v1/classes/class-1/submit', 'POST', { answers: [] }),
      classParams('class-1')
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(result);
  });

  it('returns 400 when answers field is missing', async () => {
    const res = await POSTSubmit(
      makeRequest('http://localhost/api/v1/classes/class-1/submit', 'POST', {}),
      classParams('class-1')
    );

    expect(res.status).toBe(400);
    expect(mockSubmitClass).not.toHaveBeenCalled();
  });

  it('returns 404 when submitClass returns null (class not owned by user)', async () => {
    mockSubmitClass.mockResolvedValue(null);

    const res = await POSTSubmit(
      makeRequest('http://localhost/api/v1/classes/class-1/submit', 'POST', {
        answers: VALID_ANSWERS,
      }),
      classParams('class-1')
    );

    expect(res.status).toBe(404);
  });

  it('returns the SubmitResult on success', async () => {
    mockSubmitClass.mockResolvedValue(SUBMIT_RESULT);

    const res = await POSTSubmit(
      makeRequest('http://localhost/api/v1/classes/class-1/submit', 'POST', {
        answers: VALID_ANSWERS,
      }),
      classParams('class-1')
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.passed).toBe(true);
    expect(body.overallScore).toBe(1);
    expect(body.sections).toHaveLength(1);
    expect(body.sections[0].skill).toBe('GRAMMAR');
  });

  it('rejects selectedIndex outside 0-3', async () => {
    const res = await POSTSubmit(
      makeRequest('http://localhost/api/v1/classes/class-1/submit', 'POST', {
        answers: [{ questionId: 'q1', selectedIndex: 5 }],
      }),
      classParams('class-1')
    );

    expect(res.status).toBe(400);
    expect(mockSubmitClass).not.toHaveBeenCalled();
  });
});

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
      { skill: 'GRAMMAR', status: 'READY', attempt: 1, updatedAt: new Date(4000), episode: null },
      { skill: 'READING', status: 'PENDING', attempt: 1, updatedAt: new Date(5000), episode: null },
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
      { skill: 'GRAMMAR', status: 'PASSED', attempt: 1, updatedAt: new Date(3000), episode: null },
      { skill: 'READING', status: 'PENDING', attempt: 2, updatedAt: new Date(5000), episode: null },
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
            { skill: 'GRAMMAR', status: 'READY', attempt: 1, updatedAt: new Date(), episode: null },
            { skill: 'READING', status: 'READY', attempt: 1, updatedAt: new Date(), episode: null },
            {
              skill: 'LISTENING',
              attempt: 1,
              updatedAt: new Date(),
              status: 'READY',
              episode: { status: 'STITCHING', audioUrl: null, updatedAt: new Date() },
            },
            {
              skill: 'SPEAKING',
              status: 'READY',
              attempt: 1,
              updatedAt: new Date(),
              episode: null,
            },
            { skill: 'WRITING', status: 'READY', attempt: 1, updatedAt: new Date(), episode: null },
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
            { skill: 'GRAMMAR', status: 'READY', attempt: 1, updatedAt: new Date(), episode: null },
            { skill: 'READING', status: 'READY', attempt: 1, updatedAt: new Date(), episode: null },
            {
              skill: 'LISTENING',
              attempt: 1,
              updatedAt: new Date(),
              status: 'READY',
              episode: { status: 'READY', audioUrl: null, updatedAt: new Date() },
            },
            {
              skill: 'SPEAKING',
              status: 'READY',
              attempt: 1,
              updatedAt: new Date(),
              episode: null,
            },
            { skill: 'WRITING', status: 'READY', attempt: 1, updatedAt: new Date(), episode: null },
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
      classes: [{ id: 'class-generating' }],
    });

    const res = await DELETEGeneration(
      makeRequest('http://localhost/api/v1/courses/course-1/generation', 'DELETE'),
      courseParams('course-1')
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ cancelled: true, classId: 'class-generating' });
    expect(mockCourseUpdateMany).toHaveBeenCalledWith({
      where: { id: 'course-1', userId: 'u1', activeClassId: 'class-generating' },
      data: { activeClassId: null },
    });
    expect(mockCourseClassDeleteMany).toHaveBeenCalledWith({
      where: { id: 'class-generating', courseId: 'course-1' },
    });
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
