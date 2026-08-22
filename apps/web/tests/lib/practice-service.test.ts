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
const mockSpeakingPromptCreateMany = vi.fn();
const mockSpeakingPromptFindMany = vi.fn();
const mockSpeakingPromptCount = vi.fn();
const mockWritingPromptCreateMany = vi.fn();
const mockWritingPromptFindMany = vi.fn();
const mockWritingPromptCount = vi.fn();
const mockWritingResponseFindMany = vi.fn();
const mockComposeListeningContent = vi.fn();
const mockComposeSpeakingPrompts = vi.fn();
const mockComposeWritingPrompts = vi.fn();
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
    speakingPrompt: {
      createMany: (...a: unknown[]) => mockSpeakingPromptCreateMany(...a),
      findMany: (...a: unknown[]) => mockSpeakingPromptFindMany(...a),
      count: (...a: unknown[]) => mockSpeakingPromptCount(...a),
    },
    speakingRecording: { findMany: (...a: unknown[]) => mockSpeakingRecordingFindMany(...a) },
    writingPrompt: {
      createMany: (...a: unknown[]) => mockWritingPromptCreateMany(...a),
      findMany: (...a: unknown[]) => mockWritingPromptFindMany(...a),
      count: (...a: unknown[]) => mockWritingPromptCount(...a),
    },
    writingResponse: { findMany: (...a: unknown[]) => mockWritingResponseFindMany(...a) },
  },
}));

const mockGetDueItems = vi.fn();
const mockApplyReviewOutcome = vi.fn();
vi.mock('@/lib/knowledge-graph', () => ({
  getDueItems: (...a: unknown[]) => mockGetDueItems(...a),
  applyReviewOutcome: (...a: unknown[]) => mockApplyReviewOutcome(...a),
}));

const mockGetPracticeFocusTargets = vi.fn();
const mockMarkFocusTargetsPracticed = vi.fn();
vi.mock('@/lib/learning-targets', () => ({
  getPracticeFocusTargets: (...a: unknown[]) => mockGetPracticeFocusTargets(...a),
  markFocusTargetsPracticed: (...a: unknown[]) => mockMarkFocusTargetsPracticed(...a),
}));

const mockGenerateSectionQuestions = vi.fn();
vi.mock('@/lib/class-generation', () => ({
  generateSectionQuestions: (...a: unknown[]) => mockGenerateSectionQuestions(...a),
}));

vi.mock('@/lib/class-listening-generator', () => ({
  composeListeningContent: (...a: unknown[]) => mockComposeListeningContent(...a),
}));
vi.mock('@/lib/class-speaking-generator', () => ({
  composeSpeakingPrompts: (...a: unknown[]) => mockComposeSpeakingPrompts(...a),
}));
vi.mock('@/lib/class-writing-generator', () => ({
  composeWritingPrompts: (...a: unknown[]) => mockComposeWritingPrompts(...a),
}));
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
  pedagogy: 'BALANCED',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCourseFindFirst.mockResolvedValue(COURSE);
  mockGetPracticeFocusTargets.mockResolvedValue([]);
  mockMarkFocusTargetsPracticed.mockResolvedValue(undefined);
  mockPracticeSessionCreate.mockResolvedValue({ id: 'ps1' });
  mockPracticeSessionUpdate.mockResolvedValue({});
  mockSpeakingPromptCreateMany.mockResolvedValue({ count: 1 });
  mockSpeakingPromptFindMany.mockResolvedValue([]);
  mockSpeakingPromptCount.mockResolvedValue(0);
  mockWritingPromptCreateMany.mockResolvedValue({ count: 1 });
  mockWritingPromptFindMany.mockResolvedValue([]);
  mockWritingPromptCount.mockResolvedValue(0);
  mockWritingResponseFindMany.mockResolvedValue([]);
  mockComposeListeningContent.mockResolvedValue({ episodeId: 'ep1', comprehensionQuestions: [] });
  mockComposeSpeakingPrompts.mockResolvedValue([
    { targetPhrase: 'Hola', translation: 'Hello', ipa: null, referenceTtsUrl: null },
  ]);
  mockComposeWritingPrompts.mockResolvedValue([{ task: 'Write a greeting note.', guidance: null }]);
  mockSpeakingRecordingFindMany.mockResolvedValue([]);
});

describe('startPractice — ownership', () => {
  it("throws PracticeCourseNotFoundError when the course is not the user's", async () => {
    mockCourseFindFirst.mockResolvedValue(null);
    await expect(startPractice('c1', 'intruder', 'VOCAB')).rejects.toBeInstanceOf(
      PracticeCourseNotFoundError
    );
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
      ['hola', 'gracias', 'adios', 'si', 'no'].map((lemma) => ({ lemma }))
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
        data: expect.objectContaining({
          kind: 'VOCAB',
          vocabLemmas: expect.arrayContaining(['hola', 'gracias']),
        }),
      })
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
      {
        question: 'Soy ___ Madrid',
        options: ['de', 'en', 'a', 'por'],
        correctIndex: 0,
        explanation: 'origin',
      },
    ]);

    const r = await startPractice('c1', 'u1', 'GRAMMAR');
    if (r.status !== 'ready') throw new Error('expected ready');

    expect(mockGenerateSectionQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ skill: 'GRAMMAR', grammarPoints: ['ser-vs-estar'] })
    );
    expect(r.items[0]).not.toHaveProperty('correctIndex');
    expect(mockPracticeSessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'GRAMMAR', grammarKeys: ['ser-vs-estar'] }),
      })
    );
  });

  it('is unavailable (no_content) when nothing is due and no curriculum lesson exists', async () => {
    mockGetDueItems.mockResolvedValue({ vocab: [], grammar: [] });
    mockLessonFindFirst.mockResolvedValue(null);

    const r = await startPractice('c1', 'u1', 'GRAMMAR');
    expect(r).toEqual({ status: 'unavailable', reason: 'no_content' });
    expect(mockGenerateSectionQuestions).not.toHaveBeenCalled();
  });

  it('adds selected focus targets to a generated reading practice session', async () => {
    mockGetPracticeFocusTargets.mockResolvedValue([
      {
        id: 'ft1',
        kind: 'SENTENCE',
        text: 'Me cuesta entenderlo.',
        normalizedText: 'me cuesta entenderlo.',
        contextText: 'Me cuesta entenderlo cuando hablan rápido.',
        priorityBoost: 0.5,
      },
    ]);
    mockGetDueItems.mockResolvedValue({
      vocab: [{ id: 'lv1', lemma: 'entender', translation: 'understand', mastery: 0.4 }],
      grammar: [],
    });
    mockGenerateSectionQuestions.mockResolvedValue([
      {
        question: 'What does the speaker find difficult?',
        options: ['a', 'b', 'c', 'd'],
        correctIndex: 0,
        explanation: 'context',
      },
    ]);

    const r = await startPractice('c1', 'u1', 'READING', { focusTargetId: 'ft1' });
    if (r.status !== 'ready') throw new Error('expected ready');

    expect(mockGetPracticeFocusTargets).toHaveBeenCalledWith('c1', 2, 'ft1');
    const createArg = mockPracticeSessionCreate.mock.calls[0][0];
    expect(createArg.data.focusTargetIds).toEqual(['ft1']);
    expect(createArg.data.items[0]).toMatchObject({ focusTargetId: 'ft1' });
    expect(r.items[0].prompt).toContain('Choose the marked expression');
  });
});

describe('startPractice — FULL', () => {
  it('creates one mixed catch-up session with MC, listening, speaking, and writing work', async () => {
    mockLearnerVocabCount.mockResolvedValue(10);
    mockGetDueItems
      .mockResolvedValueOnce({
        vocab: [{ id: 'lv1', lemma: 'hola', translation: 'hello', mastery: 0.4 }],
        grammar: [{ id: 'lg1', topicKey: 'ser-vs-estar', title: 'Ser vs Estar', mastery: 0.3 }],
      })
      .mockResolvedValueOnce({
        vocab: [{ id: 'lv1', lemma: 'hola', translation: 'hello', mastery: 0.4 }],
        grammar: [],
      });
    mockLearnerVocabFindMany.mockResolvedValue(
      ['hola', 'gracias', 'adios', 'si', 'no'].map((lemma) => ({ lemma }))
    );
    mockGenerateSectionQuestions.mockResolvedValue([
      {
        question: 'Soy ___ Madrid',
        options: ['de', 'en', 'a', 'por'],
        correctIndex: 0,
        explanation: 'origin',
      },
    ]);
    mockComposeListeningContent.mockResolvedValue({
      episodeId: 'ep1',
      comprehensionQuestions: [
        {
          question: 'What did you hear?',
          options: ['a', 'b', 'c', 'd'],
          correctIndex: 1,
          explanation: 'listen',
        },
      ],
    });
    mockPracticeSessionCreate.mockResolvedValue({ id: 'pfull' });
    mockSpeakingPromptFindMany.mockResolvedValue([
      { id: 'sp1', targetPhrase: 'Hola', translation: 'Hello', referenceTtsUrl: null },
    ]);
    mockWritingPromptFindMany.mockResolvedValue([
      { id: 'wp1', task: 'Write a greeting note.', guidance: null },
    ]);

    const r = await startPractice('c1', 'u1', 'FULL');
    if (r.status !== 'ready_full') throw new Error(`expected ready_full, got ${r.status}`);

    expect(r.kind).toBe('FULL');
    expect(r.episodeId).toBe('ep1');
    expect(r.items.length).toBeGreaterThanOrEqual(4);
    expect(r.speakingPrompts).toEqual([
      { id: 'sp1', targetPhrase: 'Hola', translation: 'Hello', referenceTtsUrl: null },
    ]);
    expect(r.writingPrompts).toEqual([
      { id: 'wp1', task: 'Write a greeting note.', guidance: null },
    ]);
    expect(mockPracticeSessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'FULL',
          episodeId: 'ep1',
          grammarKeys: ['ser-vs-estar'],
          vocabLemmas: expect.arrayContaining(['hola']),
        }),
      })
    );
    expect(mockSpeakingPromptCreateMany).toHaveBeenCalled();
    expect(mockWritingPromptCreateMany).toHaveBeenCalled();
  });
});

describe('submitPractice — SRS', () => {
  it('applies per-item SRS for VOCAB: correct lemmas pass, incorrect lemmas lapse', async () => {
    mockPracticeSessionFindFirst.mockResolvedValue({
      id: 'ps1',
      status: 'ACTIVE',
      kind: 'VOCAB',
      courseId: 'c1',
      vocabLemmas: ['hola', 'gracias'],
      grammarKeys: [],
      items: [
        {
          id: 'v0',
          correctIndex: 1,
          vocabLemma: 'hola',
          prompt: 'hello',
          options: [],
          explanation: '',
        },
        {
          id: 'v1',
          correctIndex: 0,
          vocabLemma: 'gracias',
          prompt: 'thanks',
          options: [],
          explanation: '',
        },
      ],
    });

    const r = await submitPractice('ps1', 'u1', [
      { itemId: 'v0', selectedIndex: 1 }, // correct
      { itemId: 'v1', selectedIndex: 2 }, // wrong
    ]);

    expect(r).toEqual({ score: 0.5, correct: 1, total: 2 });
    expect(mockApplyReviewOutcome).toHaveBeenCalledWith('c1', ['hola'], [], 1, 0, expect.any(Date));
    expect(mockApplyReviewOutcome).toHaveBeenCalledWith(
      'c1',
      ['gracias'],
      [],
      0,
      0,
      expect.any(Date)
    );
    expect(mockPracticeSessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPLETED', score: 0.5 }),
      })
    );
  });

  it('applies aggregate SRS for GRAMMAR across the session due items', async () => {
    mockPracticeSessionFindFirst.mockResolvedValue({
      id: 'ps2',
      status: 'ACTIVE',
      kind: 'GRAMMAR',
      courseId: 'c1',
      vocabLemmas: ['hola'],
      grammarKeys: ['ser-vs-estar'],
      items: [
        { id: 'q0', correctIndex: 0, vocabLemma: null, prompt: 'q', options: [], explanation: '' },
      ],
    });

    const r = await submitPractice('ps2', 'u1', [{ itemId: 'q0', selectedIndex: 0 }]);

    expect(r.score).toBe(1);
    expect(mockApplyReviewOutcome).toHaveBeenCalledWith(
      'c1',
      ['hola'],
      ['ser-vs-estar'],
      1,
      1,
      expect.any(Date)
    );
  });

  it('marks focus targets practiced using the practice score', async () => {
    mockPracticeSessionFindFirst.mockResolvedValue({
      id: 'ps-focus',
      status: 'ACTIVE',
      kind: 'READING',
      courseId: 'c1',
      vocabLemmas: [],
      grammarKeys: [],
      focusTargetIds: ['ft1'],
      items: [
        { id: 'f0', correctIndex: 0, vocabLemma: null, prompt: 'q', options: [], explanation: '' },
      ],
    });

    await submitPractice('ps-focus', 'u1', [{ itemId: 'f0', selectedIndex: 0 }]);

    expect(mockMarkFocusTargetsPracticed).toHaveBeenCalledWith('c1', ['ft1'], 1, expect.any(Date));
  });

  it('scores only the latest recording per prompt when one was re-recorded', async () => {
    mockPracticeSessionFindFirst.mockResolvedValue({
      id: 'ps-speaking',
      status: 'ACTIVE',
      kind: 'SPEAKING',
      courseId: 'c1',
      vocabLemmas: [],
      grammarKeys: [],
      items: [],
      focusTargetIds: [],
    });
    // Ordered newest first, as the query returns them: prompt p1 was attempted
    // twice, and only the 0.9 retake should count.
    mockSpeakingRecordingFindMany.mockResolvedValue([
      { promptId: 'p1', overallScore: 0.9 },
      { promptId: 'p2', overallScore: 0.5 },
      { promptId: 'p1', overallScore: 0.1 },
    ]);
    mockSpeakingPromptCount.mockResolvedValue(2);

    const r = await submitPractice('ps-speaking', 'u1', []);

    expect(r.correct).toBe(2);
    expect(r.score).toBeCloseTo(0.7);
  });

  it('refuses to grade a session that is already complete', async () => {
    mockPracticeSessionFindFirst.mockResolvedValue({
      id: 'ps-done',
      status: 'COMPLETED',
      kind: 'GRAMMAR',
      courseId: 'c1',
      vocabLemmas: [],
      grammarKeys: [],
      items: [],
    });

    await expect(submitPractice('ps-done', 'u1', [])).rejects.toThrow(/already complete/i);
    expect(mockApplyReviewOutcome).not.toHaveBeenCalled();
  });

  it('applies precise vocab and section-weighted aggregate SRS for FULL sessions', async () => {
    mockPracticeSessionFindFirst.mockResolvedValue({
      id: 'ps-full',
      status: 'ACTIVE',
      kind: 'FULL',
      courseId: 'c1',
      vocabLemmas: ['hola', 'seed-word'],
      grammarKeys: ['ser-vs-estar'],
      items: [
        {
          id: 'v0',
          correctIndex: 1,
          vocabLemma: 'hola',
          prompt: 'hello',
          options: [],
          explanation: '',
        },
        {
          id: 'g0',
          correctIndex: 0,
          vocabLemma: null,
          prompt: 'grammar',
          options: [],
          explanation: '',
        },
      ],
    });
    mockSpeakingRecordingFindMany.mockResolvedValue([{ overallScore: 0.6 }]);
    mockWritingResponseFindMany.mockResolvedValue([{ overallScore: 0.8 }]);
    mockSpeakingPromptCount.mockResolvedValue(1);
    mockWritingPromptCount.mockResolvedValue(1);

    const r = await submitPractice('ps-full', 'u1', [
      { itemId: 'v0', selectedIndex: 1 },
      { itemId: 'g0', selectedIndex: 2 },
    ]);

    expect(r.correct).toBe(3);
    expect(r.total).toBe(4);
    expect(r.score).toBeCloseTo((0.5 + 0.6 + 0.8) / 3);
    expect(mockApplyReviewOutcome).toHaveBeenCalledWith('c1', ['hola'], [], 1, 0, expect.any(Date));
    expect(mockApplyReviewOutcome).toHaveBeenCalledWith(
      'c1',
      ['seed-word'],
      ['ser-vs-estar'],
      expect.closeTo((0.5 + 0.6 + 0.8) / 3),
      0,
      expect.any(Date)
    );
  });
});

describe('startPractice — WRITING', () => {
  it('creates a session + writing prompts and returns ready_writing', async () => {
    mockGetDueItems.mockResolvedValue({
      vocab: [{ id: 'lv1', lemma: 'hola', translation: 'hello', mastery: 0.4 }],
      grammar: [],
    });
    mockPracticeSessionCreate.mockResolvedValue({ id: 'pw1' });
    mockComposeWritingPrompts.mockResolvedValue([
      { task: 'Write a greeting note.', guidance: null },
    ]);
    mockWritingPromptCreateMany.mockResolvedValue({ count: 1 });
    mockWritingPromptFindMany.mockResolvedValue([
      { id: 'wp1', task: 'Write a greeting note.', guidance: null },
    ]);

    const r = await startPractice('c1', 'u1', 'WRITING');
    if (r.status !== 'ready_writing') throw new Error(`expected ready_writing, got ${r.status}`);

    expect(r.sessionId).toBe('pw1');
    expect(r.prompts).toEqual([{ id: 'wp1', task: 'Write a greeting note.', guidance: null }]);
    expect(mockComposeWritingPrompts).toHaveBeenCalled();
    expect(mockWritingPromptCreateMany).toHaveBeenCalled();
    expect(mockPracticeSessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: 'WRITING' }) })
    );
  });
});
