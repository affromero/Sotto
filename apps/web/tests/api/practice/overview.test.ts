import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { practicePreparingSchema } from '@sotto/shared';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  admit: vi.fn(),
  resume: vi.fn(),
  submit: vi.fn(),
  course: vi.fn(),
  vocab: vi.fn(),
  grammar: vi.fn(),
  sessions: vi.fn(),
}));
vi.mock('@/lib/api-keys', () => ({ authenticateRequest: mocks.authenticate }));
vi.mock('@/lib/practice/preparation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/practice/preparation')>()),
  requestPracticePreparation: mocks.admit,
}));
vi.mock('@/lib/practice/resume', () => ({ resumePractice: mocks.resume }));
vi.mock('@/lib/practice-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/practice-service')>()),
  submitPractice: mocks.submit,
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    course: { findFirst: mocks.course },
    learnerVocab: { count: mocks.vocab },
    learnerGrammar: { count: mocks.grammar },
    practiceSession: { findMany: mocks.sessions },
  },
}));
import {
  POST as startPost,
  GET as overviewGet,
} from '@/app/api/v1/courses/[courseId]/practice/route';
import { POST as submitPost } from '@/app/api/v1/practice/[sessionId]/submit/route';
import { PracticeCourseNotFoundError, PracticeSessionNotFoundError } from '@/lib/practice-service';
import { PreparationConflictError } from '@/lib/classes/preparation-state';

const courseParams = { params: Promise.resolve({ courseId: 'c1' }) };
const sessionParams = { params: Promise.resolve({ sessionId: 'ps1' }) };
const jsonReq = (body: unknown) =>
  new NextRequest('http://localhost/api/v1/practice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue({ userId: 'u1' });
  mocks.admit.mockResolvedValue({ id: randomUUID(), sessionId: randomUUID(), status: 'QUEUED' });
});

describe('Practice HTTP contract', () => {
  it('acknowledges durable FULL preparation with a saved identity and public status', async () => {
    const response = await startPost(
      jsonReq({ kind: 'FULL', requestId: randomUUID(), focusTargetId: 'ft1' }),
      courseParams
    );
    expect(response.status).toBe(202);
    const progress = practicePreparingSchema.parse(await response.json());
    expect(progress.preparationStatus).toBe('QUEUED');
    expect(progress.message).toMatch(/saved/);
    expect(progress.canRecover).toBe(false);
    expect(progress).not.toHaveProperty('selection');
    expect(progress).not.toHaveProperty('grant');
    expect(mocks.admit).toHaveBeenCalledWith(
      'c1',
      'FULL',
      expect.objectContaining({ userId: 'u1' }),
      expect.objectContaining({ focusTargetId: 'ft1' })
    );
  });

  it('returns already published material when the original admission acknowledgement is retried', async () => {
    mocks.admit.mockResolvedValue({ sessionId: 'ps1', status: 'COMPLETED' });
    mocks.resume.mockResolvedValue({ status: 'ready', sessionId: 'ps1', kind: 'VOCAB', items: [] });
    const response = await startPost(
      jsonReq({ kind: 'VOCAB', requestId: randomUUID() }),
      courseParams
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ready', sessionId: 'ps1' });
  });

  it.each([{ kind: 'invalid' }, { kind: 'FULL', requestId: 'invalid' }])(
    'rejects malformed practice admission %j',
    async (body) => {
      expect((await startPost(jsonReq(body), courseParams)).status).toBe(400);
    }
  );

  it('surfaces an admission conflict rather than claiming a practice was created', async () => {
    mocks.admit.mockRejectedValue(
      new PreparationConflictError('The request was already discarded.')
    );
    const response = await startPost(jsonReq({ kind: 'FULL' }), courseParams);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/discarded/) });
  });

  it('requires authentication and an owned course', async () => {
    mocks.authenticate.mockResolvedValue(null);
    expect((await startPost(jsonReq({ kind: 'VOCAB' }), courseParams)).status).toBe(401);
    mocks.authenticate.mockResolvedValue({ userId: 'u1' });
    mocks.admit.mockRejectedValue(new PracticeCourseNotFoundError('Unknown course'));
    expect((await startPost(jsonReq({ kind: 'VOCAB' }), courseParams)).status).toBe(404);
  });

  it('returns the saved completion receipt including explanations and productive grading counts', async () => {
    const result = {
      score: 0.4,
      correct: 1,
      total: 4,
      answered: 2,
      graded: 2,
      itemFeedback: [
        {
          itemId: 'v0',
          prompt: 'Choose a greeting',
          selectedIndex: 1,
          correctIndex: 0,
          selectedAnswer: 'Bye',
          correctAnswer: 'Hello',
          correct: false,
          explanation: 'Hello opens a conversation.',
        },
      ],
    };
    mocks.submit.mockResolvedValue(result);
    const response = await submitPost(
      jsonReq({ answers: [{ itemId: 'v0', selectedIndex: 1 }] }),
      sessionParams
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
  });

  it('returns a missing-session error instead of another learner’s results', async () => {
    mocks.submit.mockRejectedValue(new PracticeSessionNotFoundError('Unknown session'));
    expect((await submitPost(jsonReq({ answers: [] }), sessionParams)).status).toBe(404);
  });

  it('rejects an invalid answer body', async () => {
    expect((await submitPost(jsonReq({ answers: 'invalid' }), sessionParams)).status).toBe(400);
  });

  it('shows due counts and preparation failures in the owner’s recent history', async () => {
    mocks.course.mockResolvedValue({ id: 'c1' });
    mocks.vocab.mockResolvedValueOnce(7).mockResolvedValueOnce(20);
    mocks.grammar.mockResolvedValue(3);
    mocks.sessions.mockResolvedValue([{ id: 'ps1', kind: 'FULL', status: 'FAILED', score: null }]);
    const response = await overviewGet(
      new NextRequest('http://localhost/api/v1/practice'),
      courseParams
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      due: { vocab: 7, grammar: 3 },
      totalVocab: 20,
      recent: [{ status: 'FAILED' }],
    });
  });
});
