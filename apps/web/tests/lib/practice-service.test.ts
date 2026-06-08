/**
 * Unit tests for src/lib/practice-service.ts — ungated single-skill practice.
 * Verifies: course ownership, VOCAB cold-start guard + recall-item shape (answer
 * hidden in the public projection), GRAMMAR seed → generator, no-content guard,
 * and that submit drives SRS (per-item for VOCAB, aggregate otherwise).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCourseFindFirst = vi.fn();
const mockLearnerVocabCount = vi.fn();
const mockLearnerVocabFindMany = vi.fn();
const mockLessonFindFirst = vi.fn();
const mockLessonFindMany = vi.fn();
const mockPracticeSessionCreate = vi.fn();
const mockPracticeSessionFindFirst = vi.fn();
const mockPracticeSessionUpdate = vi.fn();
const mockSpeakingPromptCount = vi.fn();
const mockSpeakingRecordingFindMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    course: { findFirst: (...a: unknown[]) => mockCourseFindFirst(...a) },
    learnerVocab: {
      count: (...a: unknown[]) => mockLearnerVocabCount(...a),
      findMany: (...a: unknown[]) => mockLearnerVocabFindMany(...a),
    },
    lesson: {
      findFirst: (...a: unknown[]) => mockLessonFindFirst(...a),
      findMany: (...a: unknown[]) => mockLessonFindMany(...a),
    },
    practiceSession: {
      create: (...a: unknown[]) => mockPracticeSessionCreate(...a),
      findFirst: (...a: unknown[]) => mockPracticeSessionFindFirst(...a),
      update: (...a: unknown[]) => mockPracticeSessionUpdate(...a),
    },
    speakingPrompt: { count: (...a: unknown[]) => mockSpeakingPromptCount(...a) },
    speakingRecording: { findMany: (...a: unknown[]) => mockSpeakingRecordingFindMany(...a) },
  },
}));

const mockGetDueItems = vi.fn();
const mockApplyReviewOutcome = vi.fn();
vi.mock('@/lib/knowledge-graph', () => ({
  getDueItems: (...a: unknown[]) => mockGetDueItems(...a),
  applyReviewOutcome: (...a: unknown[]) => mockApplyReviewOutcome(...a),
}));

const mockGenerateSectionQuestions = vi.fn();
vi.mock('@/lib/class-generation', () => ({
  generateSectionQuestions: (...a: unknown[]) => mockGenerateSectionQuestions(...a),
}));

vi.mock('@/lib/class-listening-generator', () => ({ composeListeningContent: vi.fn() }));
vi.mock('@/lib/class-speaking-generator', () => ({ composeSpeakingPrompts: vi.fn() }));
vi.mock('@/lib/course-notes', () => ({ getCourseNote: vi.fn().mockResolvedValue('') }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { startPractice, submitPractice, PracticeCourseNotFoundError } from '@/lib/practice-service';

const COURSE = {
  id: 'c1',
  userId: 'u1',
  nativeLang: 'en',
  targetLang: 'es',
  currentLevel: 'A1',
  curriculumId: 'cur1',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCourseFindFirst.mockResolvedValue(COURSE);
  mockPracticeSessionCreate.mockResolvedValue({ id: 'ps1' });
  mockPracticeSessionUpdate.mockResolvedValue({});
});

describe('startPractice — ownership', () => {
  it('throws PracticeCourseNotFoundError when the course is not the user\'s', async () => {
    mockCourseFindFirst.mockResolvedValue(null);
    await expect(startPractice('c1', 'intruder', 'VOCAB')).rejects.toBeInstanceOf(PracticeCourseNotFoundError);
  });
});

describe('startPractice — VOCAB', () => {
  it('is unavailable (not_enough_vocab) on a cold-start course', async () => {
    mockLearnerVocabCount.mockResolvedValue(1);
    const r = await startPractice('c1', 'u1', 'VOCAB');
    expect(r).toEqual({ status: 'unavailable', reason: 'not_enough_vocab' });
    expect(mockPracticeSessionCreate).not.toHaveBeenCalled();
  });

  it('builds recall items with the answer among the options, hidden from the public projection', async () => {
    mockLearnerVocabCount.mockResolvedValue(10);
    mockGetDueItems.mockResolvedValue({
      vocab: [
        { id: 'lv1', lemma: 'hola', translation: 'hello', mastery: 0.2 },
        { id: 'lv2', lemma: 'gracias', translation: 'thanks', mastery: 0.3 },
      ],
      grammar: [],
    });
    mockLearnerVocabFindMany.mockResolvedValue(
      ['hola', 'gracias', 'adios', 'si', 'no'].map((lemma) => ({ lemma })),
    );

    const r = await startPractice('c1', 'u1', 'VOCAB');
    if (r.status !== 'ready') throw new Error('expected ready');

    expect(r.kind).toBe('VOCAB');
    expect(r.items).toHaveLength(2);
    // Public item exposes only id/prompt/options — never the answer.
    expect(r.items[0]).not.toHaveProperty('correctIndex');
    expect(r.items[0]).not.toHaveProperty('vocabLemma');
    expect(Object.keys(r.items[0]).sort()).toEqual(['id', 'options', 'prompt']);
    // Each recall item must contain its own answer among the choices.
    const prompts = r.items.map((it) => it.prompt);
    expect(prompts).toEqual(expect.arrayContaining(['hello', 'thanks']));
    const helloItem = r.items.find((it) => it.prompt === 'hello')!;
    expect(helloItem.options).toContain('hola');

    expect(mockPracticeSessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'VOCAB', vocabLemmas: expect.arrayContaining(['hola', 'gracias']) }),
      }),
    );
  });
});

describe('startPractice — GRAMMAR', () => {
  it('seeds from due items and generates questions', async () => {
    mockGetDueItems.mockResolvedValue({
      vocab: [{ id: 'lv1', lemma: 'hola', translation: 'hello', mastery: 0.4 }],
      grammar: [{ id: 'lg1', topicKey: 'ser-vs-estar', title: 'Ser vs Estar', mastery: 0.3 }],
    });
    mockGenerateSectionQuestions.mockResolvedValue([
      { question: 'Soy ___ Madrid', options: ['de', 'en', 'a', 'por'], correctIndex: 0, explanation: 'origin' },
    ]);

    const r = await startPractice('c1', 'u1', 'GRAMMAR');
    if (r.status !== 'ready') throw new Error('expected ready');

    expect(mockGenerateSectionQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ skill: 'GRAMMAR', grammarPoints: ['ser-vs-estar'] }),
    );
    expect(r.items[0]).not.toHaveProperty('correctIndex');
    expect(mockPracticeSessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: 'GRAMMAR', grammarKeys: ['ser-vs-estar'] }) }),
    );
  });

  it('is unavailable (no_content) when nothing is due and no curriculum lesson exists', async () => {
    mockGetDueItems.mockResolvedValue({ vocab: [], grammar: [] });
    mockLessonFindFirst.mockResolvedValue(null);

    const r = await startPractice('c1', 'u1', 'GRAMMAR');
    expect(r).toEqual({ status: 'unavailable', reason: 'no_content' });
    expect(mockGenerateSectionQuestions).not.toHaveBeenCalled();
  });
});

describe('submitPractice — SRS', () => {
  it('applies per-item SRS for VOCAB: correct lemmas pass, incorrect lemmas lapse', async () => {
    mockPracticeSessionFindFirst.mockResolvedValue({
      id: 'ps1',
      kind: 'VOCAB',
      courseId: 'c1',
      vocabLemmas: ['hola', 'gracias'],
      grammarKeys: [],
      items: [
        { id: 'v0', correctIndex: 1, vocabLemma: 'hola', prompt: 'hello', options: [], explanation: '' },
        { id: 'v1', correctIndex: 0, vocabLemma: 'gracias', prompt: 'thanks', options: [], explanation: '' },
      ],
    });

    const r = await submitPractice('ps1', 'u1', [
      { itemId: 'v0', selectedIndex: 1 }, // correct
      { itemId: 'v1', selectedIndex: 2 }, // wrong
    ]);

    expect(r).toEqual({ score: 0.5, correct: 1, total: 2 });
    expect(mockApplyReviewOutcome).toHaveBeenCalledWith('c1', ['hola'], [], 1, 0, expect.any(Date));
    expect(mockApplyReviewOutcome).toHaveBeenCalledWith('c1', ['gracias'], [], 0, 0, expect.any(Date));
    expect(mockPracticeSessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED', score: 0.5 }) }),
    );
  });

  it('applies aggregate SRS for GRAMMAR across the session due items', async () => {
    mockPracticeSessionFindFirst.mockResolvedValue({
      id: 'ps2',
      kind: 'GRAMMAR',
      courseId: 'c1',
      vocabLemmas: ['hola'],
      grammarKeys: ['ser-vs-estar'],
      items: [{ id: 'q0', correctIndex: 0, vocabLemma: null, prompt: 'q', options: [], explanation: '' }],
    });

    const r = await submitPractice('ps2', 'u1', [{ itemId: 'q0', selectedIndex: 0 }]);

    expect(r.score).toBe(1);
    expect(mockApplyReviewOutcome).toHaveBeenCalledWith('c1', ['hola'], ['ser-vs-estar'], 1, 1, expect.any(Date));
  });
});
