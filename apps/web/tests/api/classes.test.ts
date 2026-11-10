// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { generationCases } from './classes/generation-cases';
import { sampleTeaching } from '../helpers/learning/class-teaching';
import { classDetailResponseSchema, createSkillRequirements } from '@sotto/shared';
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
  prismaUnfiltered: { $transaction: (...args: unknown[]) => mockTransaction(...args) },
}));

vi.mock('@/lib/sidedoor/credentials/runtime/provider-execution', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/sidedoor/credentials/runtime/provider-execution')
  >()),
  sottoRequestExecution: (_request: unknown, identity: { userId: string }) => ({
    userId: identity.userId,
    authorize: async () => ({ userId: identity.userId }),
  }),
}));

const mockReadPrerequisiteSource = vi.fn();
const mockClassTaskMaterialHash = vi.fn();
const mockReadInitialA1PracticeAuthorization = vi.fn();
vi.mock('@/lib/classes/lesson/initial-a1-provenance', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/classes/lesson/initial-a1-provenance')>()),
  classTaskMaterialHash: (...args: unknown[]) => mockClassTaskMaterialHash(...args),
  readInitialA1PracticeAuthorization: (...args: unknown[]) =>
    mockReadInitialA1PracticeAuthorization(...args),
}));
vi.mock('@/lib/classes/help/content/prerequisite-source', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/classes/help/content/prerequisite-source')>()),
  readPrerequisiteSource: (...args: unknown[]) => mockReadPrerequisiteSource(...args),
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
import { PrerequisiteSourceConflict } from '@/lib/classes/help/content/prerequisite-source';
import { PrerequisiteDeletionConflict } from '@/lib/classes/help/prerequisite-deletion';
import { SpeakingDeletionConflict } from '@/lib/sidedoor/jobs/stitch/speaking-grading-deletion';
import { AssessmentFenceConflict } from '@/lib/learning/classes/lifecycle/assessment-fence';
import { InitialA1PracticeBlocked } from '@/lib/classes/lesson/initial-a1-provenance';

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

// ---- GET /api/v1/classes/[classId] ----

describe('GET /api/v1/classes/[classId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'class-test-key');
    mockClassTaskMaterialHash.mockResolvedValue('b'.repeat(64));
    mockReadInitialA1PracticeAuthorization.mockResolvedValue(null);
    mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
    mockTransaction.mockImplementation(async (operation: (database: object) => Promise<unknown>) =>
      operation({})
    );
  });
  afterEach(() => vi.unstubAllEnvs());

  it('returns distinct opaque revisions for prerequisite guidance and task material', async () => {
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'class-test-key');
    const requirements = createSkillRequirements({
      scope: 'CLASS',
      nativeLang: 'es',
      targetLang: 'ru',
      level: 'A1',
      ttsProvider: null,
      sttProvider: null,
    });
    mockGetClassForUser.mockResolvedValue({
      ...SAMPLE_CLASS_UNSUBMITTED,
      teaching: sampleTeaching,
      skillRequirements: requirements,
    });
    mockReadPrerequisiteSource.mockResolvedValue({
      sourceHash: 'a'.repeat(64),
      source: { lesson: { level: 'A1' } },
    });
    const res = await GET(
      makeRequest('http://localhost/api/v1/classes/class-1', 'GET'),
      classParams('class-1')
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const revision = body.prerequisiteSourceHash;
    expect(revision).toMatch(/^[a-f0-9]{64}$/);
    expect(revision).not.toBe('a'.repeat(64));
    expect(body.taskMaterialRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(body.taskMaterialRevision).not.toBe('b'.repeat(64));
    expect(body.taskMaterialRevision).not.toBe(revision);
  });

  it('binds complete legacy A1 guidance even when skill requirements were not saved', async () => {
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'class-test-key');
    mockGetClassForUser.mockResolvedValue({
      ...SAMPLE_CLASS_UNSUBMITTED,
      teaching: sampleTeaching,
      skillRequirements: null,
    });
    mockReadPrerequisiteSource.mockResolvedValue({
      sourceHash: 'a'.repeat(64),
      source: { lesson: { level: 'A1' } },
    });
    const res = await GET(
      makeRequest('http://localhost/api/v1/classes/class-1', 'GET'),
      classParams('class-1')
    );
    expect(res.status).toBe(200);
    const revision = (await res.json()).prerequisiteSourceHash;
    expect(revision).toMatch(/^[a-f0-9]{64}$/);
    expect(revision).not.toBe('a'.repeat(64));
  });

  it('surfaces unexpected prerequisite source failures instead of silently hiding them', async () => {
    const requirements = createSkillRequirements({
      scope: 'CLASS',
      nativeLang: 'es',
      targetLang: 'ru',
      level: 'A1',
      ttsProvider: null,
      sttProvider: null,
    });
    mockGetClassForUser.mockResolvedValue({
      ...SAMPLE_CLASS_UNSUBMITTED,
      teaching: sampleTeaching,
      skillRequirements: requirements,
    });
    mockReadPrerequisiteSource.mockRejectedValue(new Error('database unavailable'));
    const res = await GET(
      makeRequest('http://localhost/api/v1/classes/class-1', 'GET'),
      classParams('class-1')
    );
    expect(res.status).toBe(500);
  });

  it('keeps an incomplete A1 class readable without enabling prerequisite help', async () => {
    const requirements = createSkillRequirements({
      scope: 'CLASS',
      nativeLang: 'es',
      targetLang: 'ru',
      level: 'A1',
      ttsProvider: null,
      sttProvider: null,
    });
    mockGetClassForUser.mockResolvedValue({
      ...SAMPLE_CLASS_UNSUBMITTED,
      teaching: sampleTeaching,
      skillRequirements: requirements,
    });
    mockReadPrerequisiteSource.mockRejectedValue(new PrerequisiteSourceConflict());
    const res = await GET(
      makeRequest('http://localhost/api/v1/classes/class-1', 'GET'),
      classParams('class-1')
    );
    expect(res.status).toBe(200);
    expect((await res.json()).prerequisiteSourceHash).toBeNull();
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
  it('returns prior writing and quiz work as private read-only history', async () => {
    const history = [
      {
        sectionId: 'old',
        attempt: 1,
        prompts: [
          { id: 'prompt', order: 1, task: 'Write a greeting', savedDraft: 'Hola', responses: [] },
        ],
      },
    ];
    mockGetClassForUser.mockResolvedValue({
      ...SAMPLE_CLASS_UNSUBMITTED,
      writingHistory: history,
      speakingHistory: [
        {
          sectionId: 'old-speech',
          attempt: 1,
          prompts: [
            {
              id: 'prompt',
              order: 1,
              targetPhrase: 'Hallo',
              translation: 'Hello',
              recordings: [
                {
                  id: 'recording',
                  attempt: 1,
                  attemptMatches: true,
                  status: 'SCORED',
                  transcript: 'Hallo',
                  overallScore: 0.9,
                  rubricScores: null,
                  phonemeScores: null,
                  feedback: 'Clear.',
                  createdAt: '2024-01-01T00:00:00.000Z',
                },
              ],
            },
          ],
        },
      ],
      orphanWritingDrafts: [{ id: 'orphan', text: 'Saved words' }],
      quizHistory: [
        {
          sectionId: 'old-quiz',
          skill: 'GRAMMAR',
          attempt: 1,
          questions: [
            {
              id: 'q',
              order: 1,
              question: 'Choose',
              passageText: null,
              options: ['a', 'b'],
              savedChoice: 0,
              submissions: [
                { attempt: null, submittedAt: null, selectedIndex: null, isCorrect: null },
              ],
            },
          ],
        },
      ],
      orphanQuizAnswers: [{ sectionId: null, questionId: null, savedChoice: 2, submissions: [] }],
      quizHistoryUnreadable: true,
      quizSubmissionReceipts: [
        {
          attempt: 1,
          submittedAt: null,
          passed: false,
          overallScore: 0.4,
          answersUnavailable: true,
          passedSections: null,
          totalSections: null,
          sections: [],
          summaryIncomplete: true,
        },
      ],
    });
    const res = await GET(
      makeRequest('http://localhost/api/v1/classes/class-1', 'GET'),
      classParams('class-1')
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = await res.json();
    expect(body).toMatchObject({
      writingHistory: history,
      speakingHistory: [expect.objectContaining({ sectionId: 'old-speech' })],
      orphanWritingDrafts: [{ id: 'orphan', text: 'Saved words' }],
      quizHistory: [expect.objectContaining({ sectionId: 'old-quiz' })],
      orphanQuizAnswers: [{ sectionId: null, questionId: null, savedChoice: 2, submissions: [] }],
      quizHistoryUnreadable: true,
      quizSubmissionReceipts: [
        {
          attempt: 1,
          submittedAt: null,
          passed: false,
          overallScore: 0.4,
          answersUnavailable: true,
          passedSections: null,
          totalSections: null,
          sections: [],
          summaryIncomplete: true,
        },
      ],
    });
    expect(classDetailResponseSchema.safeParse(body).success).toBe(true);
  });
  it('preserves the section mastery threshold independently of the class threshold', async () => {
    mockGetClassForUser.mockResolvedValue({
      ...SAMPLE_CLASS_UNSUBMITTED,
      passThreshold: 0.6,
      sections: SAMPLE_CLASS_UNSUBMITTED.sections.map((section) => ({
        ...section,
        passThreshold: 0.85,
      })),
    });
    const response = await GET(
      makeRequest('http://localhost/api/v1/classes/class-1', 'GET'),
      classParams('class-1')
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      passThreshold: 0.6,
      sections: [{ passThreshold: 0.85 }],
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
      taskMode: 'READ_ALOUD',
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

  it('returns an authenticated playback path for encrypted speaking audio', async () => {
    mockGetClassForUser.mockResolvedValue({
      ...SAMPLE_CLASS_SPEAKING,
      sections: SAMPLE_CLASS_SPEAKING.sections.map((section) => ({
        ...section,
        prompts: section.prompts.map((prompt) => ({
          ...prompt,
          referenceTtsUrl: 'https://storage.example/private.bin',
          referenceEncryption: { version: 1 },
        })),
      })),
    });
    const response = await GET(
      makeRequest('http://localhost/api/v1/classes/class-1', 'GET'),
      classParams('class-1')
    );
    const body = await response.json();
    expect(body.sections[0].prompts[0].referenceTtsUrl).toBe(
      '/api/v1/classes/class-1/speaking/p1/reference/audio'
    );
    expect(JSON.stringify(body)).not.toContain('private.bin');
    expect(JSON.stringify(body)).not.toContain('referenceEncryption');
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

  it('returns the validated saved result without private receipt fields', async () => {
    const receipt = {
      source: 'ASSESSMENT',
      passed: true,
      overallScore: 0.9,
      passedSections: 1,
      totalSections: 1,
      sections: [{ id: 'held-out-reading', skill: 'READING', score: 0.9, passed: true }],
    };
    mockGetClassForUser.mockResolvedValue({
      ...SAMPLE_CLASS_SUBMITTED,
      submission: {
        ...SAMPLE_CLASS_SUBMITTED.submission,
        receipt: { ...receipt, privateRubric: 'secret' },
      },
    });
    const response = await GET(
      makeRequest('http://localhost/api/v1/classes/class-1', 'GET'),
      classParams('class-1')
    );
    expect(response.status).toBe(200);
    expect((await response.json()).submission.receipt).toEqual(receipt);
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
    expect(body).not.toHaveProperty('teaching');
    expect(body.sections).toHaveLength(1);
  });

  it('returns the accepted teaching with its worked examples and guided exercise', async () => {
    mockGetClassForUser.mockResolvedValue({
      ...SAMPLE_CLASS_UNSUBMITTED,
      teaching: sampleTeaching,
    });

    const response = await GET(
      makeRequest('http://localhost/api/v1/classes/class-1', 'GET'),
      classParams('class-1')
    );

    expect(response.status).toBe(200);
    expect((await response.json()).teaching).toEqual(sampleTeaching);
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
  it('reports that assessment work must be preserved before regeneration', async () => {
    mockRequestPreparation.mockRejectedValue(
      new PreparationConflictError(
        'This class has assessment work that must be preserved before regeneration.'
      )
    );
    const response = await POST(
      makeRequest('http://localhost/api/v1/classes/class-1', 'POST', { expectedAttempt: 1 }),
      classParams('class-1')
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/assessment work/),
    });
  });
  it('admits a targeted section retry with its confirmed progress revision', async () => {
    const response = await POST(
      makeRequest('http://localhost/api/v1/classes/class-1', 'POST', {
        scope: 'section',
        sectionId: 'grammar-1',
        expectedAttempt: 3,
        expectedRevision: 8,
      }),
      classParams('class-1')
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ scope: 'section', operationId: 'operation-1' });
    expect(mockRequestPreparation.mock.calls.at(-1)?.[2]).toMatchObject({
      intent: {
        kind: 'REPAIR',
        classId: 'class-1',
        expectedAttempt: 3,
        retry: { sectionId: 'grammar-1', expectedRevision: 8 },
      },
    });
  });
  it.each([
    { scope: 'section', expectedAttempt: 1, sectionId: 'grammar-1' },
    { scope: 'section', expectedAttempt: 1, expectedRevision: 0 },
    { scope: 'sections', expectedAttempt: 1, sectionId: 'grammar-1', expectedRevision: 0 },
  ])('rejects an incomplete or mismatched targeted retry request: %j', async (body) => {
    const response = await POST(
      makeRequest('http://localhost/api/v1/classes/class-1', 'POST', body),
      classParams('class-1')
    );
    expect(response.status).toBe(400);
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
    expect(mockDeleteClassForUser).toHaveBeenCalledWith(
      'class-1',
      'u1',
      expect.objectContaining({ userId: 'u1', authorize: expect.any(Function) })
    );
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

  it('reports active prerequisite work as a recoverable conflict', async () => {
    mockDeleteClassForUser.mockRejectedValue(new PrerequisiteDeletionConflict());
    const res = await DELETEClass(
      makeRequest('http://localhost/api/v1/classes/class-1', 'DELETE'),
      classParams('class-1')
    );
    expect(res.status).toBe(409);
  });

  it('reports active assessment work as a recoverable conflict', async () => {
    mockDeleteClassForUser.mockRejectedValue(new AssessmentFenceConflict());
    const res = await DELETEClass(
      makeRequest('http://localhost/api/v1/classes/class-1', 'DELETE'),
      classParams('class-1')
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('assessment') });
  });

  it('reports retained legacy speaking work as a conflict', async () => {
    mockDeleteClassForUser.mockRejectedValue(
      new SpeakingDeletionConflict('Older speaking history requires course-level cleanup.')
    );
    const res = await DELETEClass(
      makeRequest('http://localhost/api/v1/classes/class-1', 'DELETE'),
      classParams('class-1')
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: 'Older speaking history requires course-level cleanup.',
    });
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

  it('returns a recoverable conflict when prerequisite teaching must be reviewed', async () => {
    mockSubmitClass.mockRejectedValue(new InitialA1PracticeBlocked());
    const res = await POSTSubmit(
      makeRequest('http://localhost/api/v1/classes/class-1/submit', 'POST', {
        answers: VALID_ANSWERS,
      }),
      classParams('class-1')
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: expect.stringMatching(/review the prerequisite teaching/i),
      code: 'PREREQUISITE_ACK_REQUIRED',
    });
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

generationCases({
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
});
