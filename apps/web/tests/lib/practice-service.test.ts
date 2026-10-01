import { blockedProviderExecution } from '../helpers/runtime/provider-execution';
/**
 * Unit tests for src/lib/practice-service.ts — ungated single-skill practice.
 * Verifies: course ownership, VOCAB cold-start guard + recall-item shape (answer
 * hidden in the public projection), GRAMMAR seed → generator, no-content guard,
 * and that submit drives SRS (per-item for VOCAB, aggregate otherwise).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSkillRequirements } from '@sotto/shared';

vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: async () => ({ provider: 'anthropic', model: 'fixture' }),
  capturedLearningAiOptions: async () => ({}),
}));
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({
    generateResponse: async (
      _system: string,
      messages: { content: string }[],
      options: { jsonSchema?: unknown }
    ) => {
      const input = JSON.parse(messages[0]!.content);
      const sourceForm = input.passageText?.split(' ')[0] ?? 'Hola';
      return {
        content: JSON.stringify(
          options.jsonSchema
            ? {
                items: input.items.map((_: unknown, index: number) => ({
                  index,
                  acceptable: true,
                  issues: [],
                  feedback: [],
                })),
              }
            : [
                {
                  lemma: sourceForm,
                  gloss: 'greeting',
                  pos: 'expression',
                  sourceForm,
                  questionIndices: [],
                },
              ]
        ),
        model: 'fixture',
      };
    },
  }),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));

const mockResolveSkillRequirements = vi.fn();
vi.mock('@/lib/learning/skill-requirements', () => ({
  resolveSkillRequirements: (...args: unknown[]) => mockResolveSkillRequirements(...args),
}));

const mockCourseFindFirst = vi.fn();
const mockEpisodeFindUnique = vi.fn();
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
const mockQueueListeningAudio = vi.fn();
const mockComposeSpeakingPrompts = vi.fn();
const mockPublishSpeakingPromptReferences = vi.fn();
const mockComposeWritingPrompts = vi.fn();
const mockSpeakingRecordingFindMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    episode: { findUnique: (...a: unknown[]) => mockEpisodeFindUnique(...a) },
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
  upsertLiveVocab: vi.fn().mockResolvedValue(1),
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
  queueListeningAudio: (...a: unknown[]) => mockQueueListeningAudio(...a),
}));
vi.mock('@/lib/class-speaking-generator', () => ({
  composeSpeakingPrompts: (...a: unknown[]) => mockComposeSpeakingPrompts(...a),
  publishSpeakingPromptReferences: (...a: unknown[]) => mockPublishSpeakingPromptReferences(...a),
}));
vi.mock('@/lib/class-writing-generator', () => ({
  composeWritingPrompts: (...a: unknown[]) => mockComposeWritingPrompts(...a),
}));
vi.mock('@/lib/course-notes', () => ({ getCourseNote: vi.fn().mockResolvedValue('') }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { startPractice, PracticeCourseNotFoundError } from '@/lib/practice-service';

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
  mockResolveSkillRequirements.mockImplementation(async (_execution, context) =>
    createSkillRequirements({ ...context, ttsProvider: 'cartesia', sttProvider: 'openai' })
  );
  mockCourseFindFirst.mockResolvedValue(COURSE);
  mockLessonFindFirst.mockResolvedValue(null);
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
  mockComposeListeningContent.mockResolvedValue({
    episodeId: 'ep1',
    comprehensionQuestions: [],
    turns: [{ speaker: 'HOST', text: 'Hola.' }],
  });
  mockQueueListeningAudio.mockResolvedValue(undefined);
  mockComposeSpeakingPrompts.mockResolvedValue([
    { targetPhrase: 'Hola', translation: 'Hello', ipa: null, referenceTtsAudio: null },
  ]);
  mockPublishSpeakingPromptReferences.mockResolvedValue(new Map());
  mockComposeWritingPrompts.mockResolvedValue([{ task: 'Write a greeting note.', guidance: null }]);
  mockSpeakingRecordingFindMany.mockResolvedValue([]);
  mockEpisodeFindUnique.mockResolvedValue({ status: 'READY', audioUrl: '/audio.mp3' });
  mockGenerateSectionQuestions.mockImplementation(
    async (params: { vocabularyReview?: boolean; targetVocab: Array<{ lemma: string }> }) =>
      params.vocabularyReview ? contextualQuestions(params.targetVocab) : []
  );
});

function contextualQuestions(words: Array<{ lemma: string }>) {
  return words.map(({ lemma }) => ({
    question: `Al entrar, Ana dice _____ a sus amigos. (${lemma})`,
    options: [lemma, 'adiós', 'perdón', 'hasta luego'],
    correctIndex: 0,
    explanation: 'The greeting fits the situation.',
  }));
}

describe('startPractice — ownership', () => {
  it("throws PracticeCourseNotFoundError when the course is not the user's", async () => {
    mockCourseFindFirst.mockResolvedValue(null);
    await expect(
      startPractice('c1', 'intruder', 'VOCAB', blockedProviderExecution('intruder'))
    ).rejects.toBeInstanceOf(PracticeCourseNotFoundError);
  });
});

describe('startPractice — VOCAB', () => {
  it('rejects gloss-only output instead of persisting a misleading exercise', async () => {
    mockLearnerVocabCount.mockResolvedValue(3);
    mockGetDueItems.mockResolvedValue({
      vocab: [{ id: 'word', lemma: 'gemacht', translation: 'done; made', mastery: 0 }],
      grammar: [],
    });
    mockGenerateSectionQuestions.mockResolvedValue([
      {
        question: 'done; made',
        options: ['gemacht', 'gesehen', 'gehen', 'Reise'],
        correctIndex: 0,
        explanation: '',
      },
    ]);
    await expect(
      startPractice('c1', 'u1', 'VOCAB', blockedProviderExecution('u1'))
    ).rejects.toThrow(/contextual exercise/);
    expect(mockPracticeSessionCreate).not.toHaveBeenCalled();
  });
  it('is unavailable (not_enough_vocab) on a cold-start course', async () => {
    mockLearnerVocabCount.mockResolvedValue(1);
    const r = await startPractice('c1', 'u1', 'VOCAB', blockedProviderExecution('u1'));
    expect(r).toEqual({ status: 'unavailable', reason: 'not_enough_vocab' });
    expect(mockPracticeSessionCreate).not.toHaveBeenCalled();
  });

  it('preserves contextual questions and word attribution without exposing the answer key', async () => {
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

    const r = await startPractice('c1', 'u1', 'VOCAB', blockedProviderExecution('u1'));
    if (r.status !== 'ready') throw new Error('expected ready');

    expect(r.kind).toBe('VOCAB');
    expect(r.items).toHaveLength(2);
    // Public item exposes only id/prompt/options — never the answer.
    expect(r.items[0]).not.toHaveProperty('correctIndex');
    expect(r.items[0]).not.toHaveProperty('vocabLemma');
    expect(Object.keys(r.items[0]).sort()).toEqual(['id', 'options', 'prompt']);
    // Each recall item must contain its own answer among the choices.
    const prompts = r.items.map((it) => it.prompt);
    expect(prompts.every((prompt) => prompt.includes('_____'))).toBe(true);
    expect(prompts).not.toContain('hello');
    const helloItem = r.items.find((it) => it.options.includes('hola'))!;
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
  it('keeps the reading source in the stored session and public response', async () => {
    mockGetDueItems.mockResolvedValue({
      vocab: [{ id: 'word', lemma: 'Kino', translation: 'cinema', mastery: 0 }],
      grammar: [],
    });
    mockGenerateSectionQuestions.mockResolvedValue([
      {
        question: 'Wo war Mia?',
        passageText: 'Mia war im Kino.',
        options: ['Kino', 'Park', 'Bonn', 'Berlin'],
        correctIndex: 0,
        explanation: 'The source says Kino.',
      },
    ]);
    const result = await startPractice('c1', 'u1', 'READING', blockedProviderExecution('u1'));
    expect(result).toMatchObject({
      items: [
        {
          prompt: 'Wo war Mia?',
          options: ['Kino', 'Park', 'Bonn', 'Berlin'],
          passageText: 'Mia war im Kino.',
        },
      ],
    });
    expect(mockPracticeSessionCreate.mock.calls[0][0].data.items[0]).toMatchObject({
      passageText: 'Mia war im Kino.',
    });
    expect(JSON.stringify(result)).not.toContain('correctIndex');
  });
  it('seeds from due items and generates questions', async () => {
    mockGetDueItems.mockResolvedValue({
      vocab: [{ id: 'lv1', lemma: 'hola', translation: 'hello', mastery: 0.4 }],
      grammar: [{ id: 'lg1', topicKey: 'ser-vs-estar', title: 'Ser vs Estar', mastery: 0.3 }],
    });
    mockGenerateSectionQuestions.mockImplementation(
      async (params: { vocabularyReview?: boolean; targetVocab: Array<{ lemma: string }> }) =>
        params.vocabularyReview
          ? contextualQuestions(params.targetVocab)
          : [
              {
                question: 'Soy ___ Madrid',
                options: ['de', 'en', 'a', 'por'],
                correctIndex: 0,
                explanation: 'origin',
              },
            ]
    );

    const r = await startPractice('c1', 'u1', 'GRAMMAR', blockedProviderExecution('u1'));
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

    const r = await startPractice('c1', 'u1', 'GRAMMAR', blockedProviderExecution('u1'));
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
    mockGenerateSectionQuestions.mockImplementation(
      async (params: { vocabularyReview?: boolean; targetVocab: Array<{ lemma: string }> }) =>
        params.vocabularyReview
          ? contextualQuestions(params.targetVocab)
          : [
              {
                question: 'What does the speaker find difficult?',
                passageText: 'Me cuesta entenderlo cuando hablan rápido.',
                options: ['a', 'b', 'c', 'd'],
                correctIndex: 0,
                explanation: 'context',
              },
            ]
    );

    const r = await startPractice('c1', 'u1', 'READING', blockedProviderExecution('u1'), {
      focusTargetId: 'ft1',
    });
    if (r.status !== 'ready') throw new Error('expected ready');

    expect(mockGetPracticeFocusTargets).toHaveBeenCalledWith('c1', 2, 'ft1');
    const createArg = mockPracticeSessionCreate.mock.calls[0][0];
    expect(createArg.data.focusTargetIds).toEqual(['ft1']);
    expect(createArg.data.items[0]).toMatchObject({ focusTargetId: 'ft1' });
    expect(r.items[0].prompt).toContain('_____');
    expect(r.items[0].prompt).not.toContain('Choose the marked expression');
  });
});

describe('practice content topics', () => {
  const due = {
    vocab: [{ id: 'lv-due', lemma: 'mesa', translation: 'table', mastery: 0.4 }],
    grammar: [{ id: 'lg-due', topicKey: 'prepositions', title: 'Prepositions', mastery: 0.3 }],
  };
  const focus = {
    id: 'focus-place',
    kind: 'SENTENCE',
    text: 'Está al lado.',
    normalizedText: 'está al lado.',
    contextText: 'El café está al lado del parque.',
    priorityBoost: 0.5,
  };
  const lesson = {
    objective: '  Describe places in a neighborhood.  ',
    grammarPoints: ['articles'],
    targetVocab: [{ lemma: 'calle', gloss: 'street' }],
  };

  it('does not admit listening audio when the final practice association fails to persist', async () => {
    mockGetDueItems.mockResolvedValue(due);
    mockPracticeSessionCreate.mockRejectedValueOnce(new Error('Practice persistence failed'));
    await expect(
      startPractice('c1', 'u1', 'LISTENING', blockedProviderExecution('u1'))
    ).rejects.toThrow('Practice persistence failed');
    expect(mockQueueListeningAudio).not.toHaveBeenCalled();
  });

  it('uses the curriculum topic while retaining the exact due grammar and vocabulary', async () => {
    mockGetDueItems.mockResolvedValue(due);
    mockLessonFindFirst.mockResolvedValue(lesson);
    mockGenerateSectionQuestions.mockResolvedValue(contextualQuestions(due.vocab));
    const result = await startPractice('c1', 'u1', 'GRAMMAR', blockedProviderExecution('u1'));
    expect(result.status).toBe('ready');
    expect(mockGenerateSectionQuestions).toHaveBeenCalledWith(
      expect.objectContaining({
        objective: 'Describe places in a neighborhood.',
        grammarPoints: ['prepositions'],
        targetVocab: [{ lemma: 'mesa', gloss: 'table' }],
      })
    );
    expect(mockPracticeSessionCreate.mock.calls[0][0].data.grammarKeys).toEqual(['prepositions']);
  });

  it.each([null, { ...lesson, objective: '   ' }])(
    'keeps due-only listening about everyday content when no usable lesson objective exists',
    async (currentLesson) => {
      mockGetDueItems.mockResolvedValue(due);
      mockLessonFindFirst.mockResolvedValue(currentLesson);
      const result = await startPractice('c1', 'u1', 'LISTENING', blockedProviderExecution('u1'));
      expect(result.status).toBe('ready');
      expect(mockComposeListeningContent).toHaveBeenCalledWith(
        expect.objectContaining({
          objective: 'Everyday conversations and situations.',
          mustIncludeVocab: [{ word: 'mesa', translation: 'table' }],
        })
      );
    }
  );

  it.each([null, lesson])(
    'retains focus material without turning it into the listening topic',
    async (currentLesson) => {
      mockGetDueItems.mockResolvedValue({ vocab: [], grammar: [] });
      mockLessonFindFirst.mockResolvedValue(currentLesson);
      mockGetPracticeFocusTargets.mockResolvedValue([focus]);
      const result = await startPractice('c1', 'u1', 'LISTENING', blockedProviderExecution('u1'));
      expect(result.status).toBe('ready');
      expect(mockComposeListeningContent).toHaveBeenCalledWith(
        expect.objectContaining({
          objective: currentLesson
            ? 'Describe places in a neighborhood.'
            : 'Everyday conversations and situations.',
          mustIncludeVocab: expect.arrayContaining([
            { word: focus.text, translation: focus.contextText },
          ]),
        })
      );
      const stored = mockPracticeSessionCreate.mock.calls[0][0].data;
      expect(stored.focusTargetIds).toEqual([focus.id]);
      expect(stored.vocabLemmas).toContain(focus.text);
    }
  );
});

describe('startPractice — FULL', () => {
  beforeEach(() => {
    mockComposeSpeakingPrompts.mockResolvedValue(
      Array.from({ length: 4 }, (_, index) => ({
        targetPhrase: `Hola ${index}`,
        translation: `Hello ${index}`,
        ipa: null,
        referenceTtsAudio: new Uint8Array([1]),
      }))
    );
    mockComposeWritingPrompts.mockResolvedValue(
      Array.from({ length: 3 }, (_, index) => ({
        task: `Complete greeting ${index}.`,
        guidance: null,
      }))
    );
  });
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
    mockGenerateSectionQuestions.mockImplementation(
      async (params: { vocabularyReview?: boolean; targetVocab: Array<{ lemma: string }> }) =>
        params.vocabularyReview
          ? contextualQuestions(params.targetVocab)
          : Array.from({ length: 5 }, () => ({
              question: 'Soy ___ Madrid',
              options: ['de', 'en', 'a', 'por'],
              correctIndex: 0,
              explanation: 'origin',
              passageText: 'Ana es de Madrid.',
            }))
    );
    mockComposeListeningContent.mockResolvedValue({
      episodeId: 'ep1',
      turns: [{ speaker: 'Ana', text: 'Hola.' }],
      comprehensionQuestions: Array.from({ length: 4 }, () => ({
        question: 'What did you hear?',
        options: ['a', 'b', 'c', 'd'],
        correctIndex: 1,
        explanation: 'listen',
      })),
    });
    mockPracticeSessionCreate.mockResolvedValue({ id: 'pfull' });
    mockSpeakingPromptFindMany.mockResolvedValue([
      { id: 'sp1', targetPhrase: 'Hola', translation: 'Hello', referenceTtsUrl: null },
    ]);
    mockWritingPromptFindMany.mockResolvedValue([
      { id: 'wp1', task: 'Write a greeting note.', guidance: null },
    ]);

    const r = await startPractice('c1', 'u1', 'FULL', blockedProviderExecution('u1'));
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
          listeningScriptHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          grammarKeys: ['ser-vs-estar'],
          vocabLemmas: expect.arrayContaining(['hola']),
        }),
      })
    );
    expect(mockSpeakingPromptCreateMany).toHaveBeenCalled();
    expect(mockWritingPromptCreateMany).toHaveBeenCalled();
  });

  it('includes vocabulary that only exists once the other sections are generated', async () => {
    // A course with no memory graph yet: the vocabulary rows appear as a side
    // effect of generating this very session, so the count is 0 up front and
    // healthy afterwards. Asking too early is what produced a catch-up with no
    // vocabulary in it.
    let vocabSeeded = false;
    mockLearnerVocabCount.mockImplementation(async () => (vocabSeeded ? 6 : 0));
    mockGenerateSectionQuestions.mockImplementation(
      async (params: { vocabularyReview?: boolean; targetVocab: Array<{ lemma: string }> }) => {
        vocabSeeded = true;
        if (params.vocabularyReview) return contextualQuestions(params.targetVocab);
        return Array.from({ length: 5 }, () => ({
          question: 'Soy ___ Madrid',
          options: ['de', 'en', 'a', 'por'],
          correctIndex: 0,
          explanation: 'origin',
          passageText: 'Ana es de Madrid.',
        }));
      }
    );
    mockGetDueItems.mockResolvedValue({
      vocab: [{ id: 'lv1', lemma: 'hola', translation: 'hello', mastery: 0.4 }],
      grammar: [],
    });
    mockLearnerVocabFindMany.mockResolvedValue(
      ['hola', 'gracias', 'adios', 'si', 'no'].map((lemma) => ({ lemma }))
    );
    mockComposeListeningContent.mockResolvedValue({
      episodeId: 'ep1',
      turns: [{ speaker: 'Ana', text: 'Hola.' }],
      comprehensionQuestions: Array.from({ length: 4 }, () => ({
        question: 'Where is Ana?',
        options: ['home', 'school', 'park', 'shop'],
        correctIndex: 0,
        explanation: 'She says she is home.',
      })),
    });
    mockPracticeSessionCreate.mockResolvedValue({ id: 'pfull2' });
    mockSpeakingPromptFindMany.mockResolvedValue([]);
    mockWritingPromptFindMany.mockResolvedValue([]);

    const r = await startPractice('c1', 'u1', 'FULL', blockedProviderExecution('u1'));
    if (r.status !== 'ready_full') throw new Error(`expected ready_full, got ${r.status}`);

    expect(r.items.some((item) => item.id.startsWith('v'))).toBe(true);
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

    const r = await startPractice('c1', 'u1', 'WRITING', blockedProviderExecution('u1'));
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
