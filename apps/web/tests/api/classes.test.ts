import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---- Mocks ----

const mockAuthenticateRequest = vi.fn();
const mockCourseFindFirst = vi.fn();
const mockCourseUpdateMany = vi.fn();
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
      deleteMany: (...args: unknown[]) => mockCourseClassDeleteMany(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

const mockGetClassForUser = vi.fn();
const mockSubmitClass = vi.fn();
const mockRegenerateFailedSections = vi.fn();
const mockRegenerateCurrentClass = vi.fn();
const mockDeleteClassForUser = vi.fn();
const mockCreateNextClass = vi.fn();

vi.mock('@/lib/class-service', () => {
  class CourseNotFoundError extends Error {}
  class ClassGenerationCancelledError extends Error {}
  return {
    getClassForUser: (...args: unknown[]) => mockGetClassForUser(...args),
    submitClass: (...args: unknown[]) => mockSubmitClass(...args),
    regenerateFailedSections: (...args: unknown[]) => mockRegenerateFailedSections(...args),
    regenerateCurrentClass: (...args: unknown[]) => mockRegenerateCurrentClass(...args),
    deleteClassForUser: (...args: unknown[]) => mockDeleteClassForUser(...args),
    createNextClass: (...args: unknown[]) => mockCreateNextClass(...args),
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
import { POST as POSTNextClass } from '@/app/api/v1/courses/[courseId]/next-class/route';
import { DELETE as DELETEGeneration } from '@/app/api/v1/courses/[courseId]/generation/route';
import { ClassGenerationCancelledError, CourseNotFoundError } from '@/lib/class-service';

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

// A class with two sections, each with two questions. Submission is null (not yet submitted).
const SAMPLE_CLASS_UNSUBMITTED = {
  id: 'class-1',
  courseId: 'course-1',
  status: 'IN_PROGRESS',
  order: 1,
  passThreshold: 0.6,
  sourceUrl: null,
  sourceTitle: null,
  adaptiveSeed: {
    intro: {
      purpose: 'Practice greetings.',
      about: 'Use greetings before the questions.',
      focus: ['Greet someone'],
      examples: [{ target: 'Hola', meaning: 'Hello', note: 'Greeting' }],
      tips: ['Listen for formal and informal forms.'],
    },
  },
  course: { nativeLang: 'en', targetLang: 'es' },
  lesson: {
    title: 'Greetings',
    level: 'A1',
    objective: 'Learn greetings',
    grammarPoints: ['ser-present'],
    targetVocab: [{ lemma: 'hola', gloss: 'hello' }],
  },
  submission: null,
  sections: [
    {
      id: 'sec-grammar',
      skill: 'GRAMMAR',
      status: 'READY',
      attempt: 1,
      score: null,
      passed: null,
      episode: null,
      questions: [
        {
          id: 'q1',
          order: 1,
          question: 'Q1?',
          options: ['a', 'b', 'c', 'd'],
          passageRef: null,
          passageText: null,
          correctIndex: 0,
          explanation: 'Exp1',
        },
        {
          id: 'q2',
          order: 2,
          question: 'Q2?',
          options: ['a', 'b', 'c', 'd'],
          passageRef: null,
          passageText: null,
          correctIndex: 1,
          explanation: 'Exp2',
        },
      ],
      prompts: [],
      writingPrompts: [],
    },
  ],
};

// A class whose SPEAKING section carries prompts (no MC questions).
const SAMPLE_CLASS_SPEAKING = {
  ...SAMPLE_CLASS_UNSUBMITTED,
  sections: [
    {
      id: 'sec-speaking',
      skill: 'SPEAKING',
      status: 'READY',
      attempt: 1,
      score: null,
      passed: null,
      episode: null,
      questions: [],
      prompts: [
        {
          id: 'p1',
          order: 1,
          targetPhrase: 'Hola',
          translation: 'Hello',
          ipa: 'ˈola',
          referenceTtsUrl: 'https://r2/ref.mp3',
        },
      ],
      writingPrompts: [],
    },
  ],
};

// A class whose LISTENING section reuses a episode (audio + comprehension MC).
const SAMPLE_CLASS_LISTENING = {
  ...SAMPLE_CLASS_UNSUBMITTED,
  sections: [
    {
      id: 'sec-listening',
      skill: 'LISTENING',
      status: 'READY',
      attempt: 1,
      score: null,
      passed: null,
      episode: {
        id: 'pod-1',
        audioUrl: 'https://r2/listen.mp3',
        title: 'Listening',
        references: [],
      },
      questions: [
        {
          id: 'l1',
          order: 1,
          question: 'What did they discuss?',
          options: ['a', 'b', 'c', 'd'],
          passageRef: null,
          passageText: null,
          correctIndex: 0,
          explanation: 'E',
        },
      ],
      prompts: [],
      writingPrompts: [],
    },
  ],
};

// Same class after submission — submission is non-null.
const SAMPLE_CLASS_SUBMITTED = {
  ...SAMPLE_CLASS_UNSUBMITTED,
  status: 'PASSED',
  submission: { passed: true, overallScore: 1, submittedAt: new Date('2026-01-01T00:00:00Z') },
};

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

  it('strips correctIndex and explanation before submission', async () => {
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
    expect(questions[0]).not.toHaveProperty('correctIndex');
    expect(questions[0]).not.toHaveProperty('explanation');
    // Safe fields are present
    expect(questions[0]).toHaveProperty('id');
    expect(questions[0]).toHaveProperty('question');
    expect(questions[0]).toHaveProperty('options');
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
      latestRecording: null,
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

describe('POST /api/v1/classes/[classId] (regenerate)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const res = await POST(
      makeRequest('http://localhost/api/v1/classes/class-1', 'POST'),
      classParams('class-1')
    );

    expect(res.status).toBe(401);
  });

  it('returns {regenerated:true} when regeneration succeeds', async () => {
    mockRegenerateFailedSections.mockResolvedValue(true);

    const res = await POST(
      makeRequest('http://localhost/api/v1/classes/class-1', 'POST'),
      classParams('class-1')
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ regenerated: true });
  });

  it('regenerates the current class when scope=class', async () => {
    mockRegenerateCurrentClass.mockResolvedValue(true);

    const res = await POST(
      makeRequest('http://localhost/api/v1/classes/class-1', 'POST', { scope: 'class' }),
      classParams('class-1')
    );

    expect(res.status).toBe(200);
    expect(mockRegenerateCurrentClass).toHaveBeenCalledWith('class-1', 'u1');
    expect(mockRegenerateFailedSections).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body).toEqual({ regenerated: true, scope: 'class' });
  });

  it('returns 400 when there are no failed sections to regenerate', async () => {
    mockRegenerateFailedSections.mockResolvedValue(false);

    const res = await POST(
      makeRequest('http://localhost/api/v1/classes/class-1', 'POST'),
      classParams('class-1')
    );

    expect(res.status).toBe(400);
  });
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

  it('returns 400 when answers array is empty', async () => {
    const res = await POSTSubmit(
      makeRequest('http://localhost/api/v1/classes/class-1/submit', 'POST', { answers: [] }),
      classParams('class-1')
    );

    expect(res.status).toBe(400);
    expect(mockSubmitClass).not.toHaveBeenCalled();
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

// ---- POST /api/v1/courses/[courseId]/next-class ----

describe('POST /api/v1/courses/[courseId]/next-class', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const res = await POSTNextClass(
      makeRequest('http://localhost/api/v1/courses/course-1/next-class', 'POST'),
      courseParams('course-1')
    );

    expect(res.status).toBe(401);
  });

  it('returns 201 with classId when a new class is created', async () => {
    mockCreateNextClass.mockResolvedValue({ kind: 'created', classId: 'class-new' });

    const res = await POSTNextClass(
      makeRequest('http://localhost/api/v1/courses/course-1/next-class', 'POST'),
      courseParams('course-1')
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.classId).toBe('class-new');
  });

  it('returns 202 immediately for background class generation', async () => {
    mockCourseFindFirst.mockResolvedValue({ id: 'course-1' });
    mockCreateNextClass.mockResolvedValue({ kind: 'created', classId: 'class-new' });

    const res = await POSTNextClass(
      makeRequest('http://localhost/api/v1/courses/course-1/next-class?background=1', 'POST'),
      courseParams('course-1')
    );

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.started).toBe(true);
    expect(mockCreateNextClass).toHaveBeenCalledWith('course-1', 'u1', {});
  });

  it('returns 404 for background class generation when the course is missing', async () => {
    mockCourseFindFirst.mockResolvedValue(null);

    const res = await POSTNextClass(
      makeRequest('http://localhost/api/v1/courses/course-1/next-class?background=1', 'POST'),
      courseParams('course-1')
    );

    expect(res.status).toBe(404);
    expect(mockCreateNextClass).not.toHaveBeenCalled();
  });

  it('returns 409 with activeClassId and status when gated', async () => {
    mockCreateNextClass.mockResolvedValue({
      kind: 'gated',
      activeClassId: 'class-existing',
      status: 'IN_PROGRESS',
    });

    const res = await POSTNextClass(
      makeRequest('http://localhost/api/v1/courses/course-1/next-class', 'POST'),
      courseParams('course-1')
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.activeClassId).toBe('class-existing');
    expect(body.status).toBe('IN_PROGRESS');
  });

  it('returns 200 with {done:true} when curriculum is finished', async () => {
    mockCreateNextClass.mockResolvedValue({ kind: 'done' });

    const res = await POSTNextClass(
      makeRequest('http://localhost/api/v1/courses/course-1/next-class', 'POST'),
      courseParams('course-1')
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.done).toBe(true);
  });

  it('returns 404 when CourseNotFoundError is thrown', async () => {
    mockCreateNextClass.mockRejectedValue(new CourseNotFoundError('Course not found'));

    const res = await POSTNextClass(
      makeRequest('http://localhost/api/v1/courses/course-1/next-class', 'POST'),
      courseParams('course-1')
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/course not found/i);
  });

  it('returns 409 when generation is cancelled', async () => {
    mockCreateNextClass.mockRejectedValue(new ClassGenerationCancelledError('class-new'));

    const res = await POSTNextClass(
      makeRequest('http://localhost/api/v1/courses/course-1/next-class', 'POST'),
      courseParams('course-1')
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.cancelled).toBe(true);
  });

  it('returns 500 on unexpected errors', async () => {
    mockCreateNextClass.mockRejectedValue(new Error('AI meltdown'));

    const res = await POSTNextClass(
      makeRequest('http://localhost/api/v1/courses/course-1/next-class', 'POST'),
      courseParams('course-1')
    );

    expect(res.status).toBe(500);
  });
});

// ---- DELETE /api/v1/courses/[courseId]/generation ----

describe('DELETE /api/v1/courses/[courseId]/generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
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

  it('deletes the current generating class and clears activeClassId', async () => {
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
