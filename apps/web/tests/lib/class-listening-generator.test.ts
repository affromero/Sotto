import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Hoisted mock handles (vi.hoisted so they are available before vi.mock calls) ----

const {
  mockPodcastCreate,
  mockPodcastUpdate,
  mockScriptCreate,
  mockVocabEntryCreateMany,
  mockLearnerVocabUpsert,
  mockClassSectionCreate,
  mockLessonQuestionCreateMany,
  mockTransaction,
} = vi.hoisted(() => {
  const podcastCreate = vi.fn();
  const podcastUpdate = vi.fn();
  const scriptCreate = vi.fn();
  const vocabEntryCreateMany = vi.fn();
  const learnerVocabUpsert = vi.fn();
  const classSectionCreate = vi.fn();
  const lessonQuestionCreateMany = vi.fn();
  const transaction = vi.fn();

  return {
    mockPodcastCreate: podcastCreate,
    mockPodcastUpdate: podcastUpdate,
    mockScriptCreate: scriptCreate,
    mockVocabEntryCreateMany: vocabEntryCreateMany,
    mockLearnerVocabUpsert: learnerVocabUpsert,
    mockClassSectionCreate: classSectionCreate,
    mockLessonQuestionCreateMany: lessonQuestionCreateMany,
    mockTransaction: transaction,
  };
});

const { mockGenerateScript } = vi.hoisted(() => ({ mockGenerateScript: vi.fn() }));
const { mockCreateSegmentsAndQueueAudio } = vi.hoisted(() => ({ mockCreateSegmentsAndQueueAudio: vi.fn() }));
const { mockGetAiKey } = vi.hoisted(() => ({ mockGetAiKey: vi.fn() }));
const { mockGetAiProviderMeta } = vi.hoisted(() => ({ mockGetAiProviderMeta: vi.fn() }));
const { mockCreateAIProvider, mockGenerateResponse } = vi.hoisted(() => {
  const generateResponse = vi.fn();
  return {
    mockCreateAIProvider: vi.fn((..._args: unknown[]) => ({ generateResponse })),
    mockGenerateResponse: generateResponse,
  };
});
const { mockLoadAndRender } = vi.hoisted(() => ({ mockLoadAndRender: vi.fn() }));
const { mockLogUsage } = vi.hoisted(() => ({ mockLogUsage: vi.fn() }));

// ---- Module mocks ----

vi.mock('@/lib/prisma', () => ({
  prisma: {
    podcast: {
      create: (...args: unknown[]) => mockPodcastCreate(...args),
      update: (...args: unknown[]) => mockPodcastUpdate(...args),
    },
    script: {
      create: (...args: unknown[]) => mockScriptCreate(...args),
    },
    vocabularyEntry: {
      createMany: (...args: unknown[]) => mockVocabEntryCreateMany(...args),
    },
    learnerVocab: {
      upsert: (...args: unknown[]) => mockLearnerVocabUpsert(...args),
    },
    classSection: {
      create: (...args: unknown[]) => mockClassSectionCreate(...args),
    },
    lessonQuestion: {
      createMany: (...args: unknown[]) => mockLessonQuestionCreateMany(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

vi.mock('@/lib/script-generator', () => ({
  generateScript: (...args: unknown[]) => mockGenerateScript(...args),
}));

vi.mock('@/lib/segment-creator', () => ({
  createSegmentsAndQueueAudio: (...args: unknown[]) => mockCreateSegmentsAndQueueAudio(...args),
}));

vi.mock('@/lib/byok', () => ({
  getAiKey: (...args: unknown[]) => mockGetAiKey(...args),
}));

vi.mock('@/lib/providers/ai-registry', () => ({
  getAiProviderMeta: (...args: unknown[]) => mockGetAiProviderMeta(...args),
}));

vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: (...args: unknown[]) => mockCreateAIProvider(...args),
}));

vi.mock('@/lib/prompt-loader', () => ({
  loadAndRender: (...args: unknown[]) => mockLoadAndRender(...args),
}));

vi.mock('@/lib/usage-logger', () => ({
  logUsage: (...args: unknown[]) => mockLogUsage(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---- Import under test (must come AFTER vi.mock calls) ----

import { generateClassListening, composeListeningContent } from '@/lib/class-listening-generator';
import type { ClassListeningParams, ListeningContentParams } from '@/lib/class-listening-generator';

// ---- Fixtures ----

const SAMPLE_TURNS = [
  { speaker: 'HOST', text: 'Hola, bienvenidos al podcast.' },
  { speaker: 'EXPERT', text: 'Hoy hablamos sobre saludos.' },
];

const SAMPLE_VOCABULARY = [
  {
    number: 1,
    word: 'hola',
    translation: 'hello',
    partOfSpeech: 'interjection',
    pronunciation: 'OH-lah',
    exampleSentence: 'Hola, ¿cómo estás?',
    difficulty: 'A1',
  },
  {
    number: 2,
    word: 'gracias',
    translation: 'thank you',
    partOfSpeech: 'interjection',
    pronunciation: 'GRAH-thyahs',
    exampleSentence: 'Gracias por tu ayuda.',
    difficulty: 'A1',
  },
];

const SAMPLE_SCRIPT_RESULT = {
  turns: SAMPLE_TURNS,
  soundCues: [],
  references: [],
  vocabulary: SAMPLE_VOCABULARY,
  places: [],
  markdown: '## Podcast\n\nHola, bienvenidos.',
  inputTokens: 100,
  outputTokens: 200,
  model: 'm',
};

const SAMPLE_QUESTIONS_JSON = JSON.stringify([
  {
    question: 'What does "hola" mean?',
    options: ['hello', 'goodbye', 'please', 'thanks'],
    correctIndex: 0,
    explanation: '"Hola" is a greeting.',
  },
  {
    question: 'What skill is being practiced?',
    options: ['Writing', 'Reading', 'Listening', 'Speaking'],
    correctIndex: 2,
    explanation: 'This is a listening section.',
  },
  {
    question: 'Who is the host?',
    options: ['HOST', 'EXPERT', 'NARRATOR', 'GUEST'],
    correctIndex: 0,
    explanation: 'The host introduces the episode.',
  },
  {
    question: 'What is the topic?',
    options: ['Weather', 'Numbers', 'Greetings', 'Food'],
    correctIndex: 2,
    explanation: 'Saludos means greetings.',
  },
]);

const PARAMS: ClassListeningParams = {
  userId: 'u1',
  classId: 'class-1',
  courseId: 'course-1',
  level: 'A1',
  nativeLang: 'en',
  targetLang: 'es',
  objective: 'Learn greetings',
  mustIncludeVocab: [{ word: 'hola', translation: 'hello' }],
};

// ---- Helpers ----

/** Wire all happy-path mocks. */
function setupHappyPath() {
  mockGetAiKey.mockResolvedValue({ provider: 'anthropic', apiKey: 'k' });
  mockGetAiProviderMeta.mockReturnValue({ defaultModel: 'm' });
  mockPodcastCreate.mockResolvedValue({ id: 'podcast-1' });
  mockPodcastUpdate.mockResolvedValue({});
  mockGenerateScript.mockResolvedValue(SAMPLE_SCRIPT_RESULT);

  // $transaction receives a callback; execute it with a tx proxy that delegates to the mocks
  mockTransaction.mockImplementation(async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => {
    const tx = {
      script: { create: (...args: unknown[]) => mockScriptCreate(...args) },
      vocabularyEntry: { createMany: (...args: unknown[]) => mockVocabEntryCreateMany(...args) },
    };
    return cb(tx);
  });

  mockScriptCreate.mockResolvedValue({});
  mockVocabEntryCreateMany.mockResolvedValue({ count: SAMPLE_VOCABULARY.length });
  mockCreateSegmentsAndQueueAudio.mockResolvedValue(undefined);
  mockLearnerVocabUpsert.mockResolvedValue({});
  mockLoadAndRender.mockReturnValue('You are a quiz generator.');
  mockGenerateResponse.mockResolvedValue({
    content: SAMPLE_QUESTIONS_JSON,
    inputTokens: 50,
    outputTokens: 150,
    model: 'm',
  });
  mockClassSectionCreate.mockResolvedValue({ id: 'section-1' });
  mockLessonQuestionCreateMany.mockResolvedValue({ count: 4 });
}

// ---- Tests ----

describe('generateClassListening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('happy path', () => {
    it('returns { sectionId, podcastId } on success', async () => {
      setupHappyPath();

      const result = await generateClassListening(PARAMS);

      expect(result).toEqual({ sectionId: 'section-1', podcastId: 'podcast-1' });
    });

    it('creates a CLASS-source PRIVATE podcast for the user', async () => {
      setupHappyPath();

      await generateClassListening(PARAMS);

      expect(mockPodcastCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'u1',
            source: 'CLASS',
            visibility: 'PRIVATE',
            language: 'es',
            status: 'PENDING',
          }),
        }),
      );
    });

    it('calls generateScript with CLASS source, targetLanguage, conversational_mix and forLearning', async () => {
      setupHappyPath();

      await generateClassListening(PARAMS);

      expect(mockGenerateScript).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'CLASS',
          targetLanguage: 'es',
          languageMode: 'conversational_mix',
          forLearning: true,
          mustIncludeVocabulary: PARAMS.mustIncludeVocab,
        }),
      );
    });

    it('persists script and vocabulary inside a $transaction', async () => {
      setupHappyPath();

      await generateClassListening(PARAMS);

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockScriptCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            podcastId: 'podcast-1',
            turns: SAMPLE_TURNS,
            markdown: SAMPLE_SCRIPT_RESULT.markdown,
          }),
        }),
      );
      expect(mockVocabEntryCreateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ podcastId: 'podcast-1', word: 'hola', translation: 'hello' }),
            expect.objectContaining({ podcastId: 'podcast-1', word: 'gracias', translation: 'thank you' }),
          ]),
        }),
      );
    });

    it('calls createSegmentsAndQueueAudio with podcastId and the turns', async () => {
      setupHappyPath();

      await generateClassListening(PARAMS);

      expect(mockCreateSegmentsAndQueueAudio).toHaveBeenCalledWith('podcast-1', SAMPLE_TURNS);
    });

    it('upserts each generated vocabulary word into learnerVocab', async () => {
      setupHappyPath();

      await generateClassListening(PARAMS);

      expect(mockLearnerVocabUpsert).toHaveBeenCalledTimes(SAMPLE_VOCABULARY.length);
      for (const v of SAMPLE_VOCABULARY) {
        expect(mockLearnerVocabUpsert).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { courseId_lemma: { courseId: 'course-1', lemma: v.word } },
            create: expect.objectContaining({
              courseId: 'course-1',
              lemma: v.word,
              translation: v.translation,
              firstSeenClassId: 'class-1',
            }),
            update: {},
          }),
        );
      }
    });

    it('creates a LISTENING ClassSection with the podcastId and status READY', async () => {
      setupHappyPath();

      await generateClassListening(PARAMS);

      expect(mockClassSectionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            classId: 'class-1',
            skill: 'LISTENING',
            status: 'READY',
            podcastId: 'podcast-1',
          }),
        }),
      );
    });

    it('creates LessonQuestion rows for the generated comprehension questions', async () => {
      setupHappyPath();

      await generateClassListening(PARAMS);

      expect(mockLessonQuestionCreateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              sectionId: 'section-1',
              skill: 'LISTENING',
              order: 1,
              question: 'What does "hola" mean?',
              correctIndex: 0,
            }),
          ]),
        }),
      );
    });

    it('logs usage for both script and quiz generation steps', async () => {
      setupHappyPath();

      await generateClassListening(PARAMS);

      expect(mockLogUsage).toHaveBeenCalledTimes(2);
      expect(mockLogUsage).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'class-listening-script', userId: 'u1', podcastId: 'podcast-1' }),
      );
      expect(mockLogUsage).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'class-listening-quiz', userId: 'u1', podcastId: 'podcast-1' }),
      );
    });
  });

  describe('error paths', () => {
    it('throws when there is no BYOK key and no local agent configured', async () => {
      mockGetAiKey.mockResolvedValue(null);
      const prev = process.env.AI_PROVIDER;
      process.env.AI_PROVIDER = '';
      try {
        await expect(generateClassListening(PARAMS)).rejects.toThrow(/AI provider/i);
      } finally {
        process.env.AI_PROVIDER = prev;
      }
    });

    it('throws when the provider has no default model', async () => {
      mockGetAiKey.mockResolvedValue({ provider: 'anthropic', apiKey: 'k' });
      mockGetAiProviderMeta.mockReturnValue({ defaultModel: null });

      await expect(generateClassListening(PARAMS)).rejects.toThrow(/No default AI model/);
    });

    it('marks podcast FAILED and re-throws when generateScript throws', async () => {
      mockGetAiKey.mockResolvedValue({ provider: 'anthropic', apiKey: 'k' });
      mockGetAiProviderMeta.mockReturnValue({ defaultModel: 'm' });
      mockPodcastCreate.mockResolvedValue({ id: 'podcast-1' });
      mockPodcastUpdate.mockResolvedValue({});
      mockGenerateScript.mockRejectedValue(new Error('AI timeout'));

      await expect(generateClassListening(PARAMS)).rejects.toThrow('AI timeout');
      expect(mockPodcastUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'podcast-1' }, data: { status: 'FAILED' } }),
      );
    });

    it('throws when quiz LLM response is malformed JSON', async () => {
      setupHappyPath();
      mockGenerateResponse.mockResolvedValue({
        content: 'not json at all',
        inputTokens: 10,
        outputTokens: 10,
        model: 'm',
      });

      await expect(generateClassListening(PARAMS)).rejects.toThrow(/malformed output/);
      // Podcast should be marked FAILED on error
      expect(mockPodcastUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'FAILED' } }),
      );
    });

    it('throws when quiz response produces no usable questions', async () => {
      setupHappyPath();
      // Valid JSON but no properly-shaped entries
      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify([{ question: 42, options: 'nope', correctIndex: 'x' }]),
        inputTokens: 10,
        outputTokens: 10,
        model: 'm',
      });

      await expect(generateClassListening(PARAMS)).rejects.toThrow(/no usable questions/);
    });
  });

  describe('vocabulary edge cases', () => {
    it('skips vocabulary persistence when the result has no vocabulary array', async () => {
      setupHappyPath();
      mockGenerateScript.mockResolvedValue({ ...SAMPLE_SCRIPT_RESULT, vocabulary: [] });

      await generateClassListening(PARAMS);

      // createMany should not be called when vocabulary is empty
      expect(mockVocabEntryCreateMany).not.toHaveBeenCalled();
      expect(mockLearnerVocabUpsert).not.toHaveBeenCalled();
    });

    it('skips learnerVocab upsert entries whose word is falsy', async () => {
      setupHappyPath();
      mockGenerateScript.mockResolvedValue({
        ...SAMPLE_SCRIPT_RESULT,
        vocabulary: [
          { ...SAMPLE_VOCABULARY[0], word: '' }, // falsy — should be skipped
          SAMPLE_VOCABULARY[1],
        ],
      });

      await generateClassListening(PARAMS);

      // Only the non-empty word should be upserted
      expect(mockLearnerVocabUpsert).toHaveBeenCalledTimes(1);
      expect(mockLearnerVocabUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { courseId_lemma: { courseId: 'course-1', lemma: 'gracias' } },
        }),
      );
    });
  });
});

describe('composeListeningContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const CONTENT_PARAMS: ListeningContentParams = {
    userId: 'u1',
    courseId: 'course-1',
    level: 'A1',
    nativeLang: 'en',
    targetLang: 'es',
    objective: 'Learn greetings',
    mustIncludeVocab: [{ word: 'hola', translation: 'hello' }],
  };

  it('returns the podcast id + comprehension questions without persisting a class section', async () => {
    setupHappyPath();

    const content = await composeListeningContent(CONTENT_PARAMS);

    expect(content.podcastId).toBe('podcast-1');
    expect(content.comprehensionQuestions.length).toBeGreaterThan(0);
    expect(content.comprehensionQuestions[0]).toMatchObject({
      question: expect.any(String),
      options: expect.any(Array),
      correctIndex: expect.any(Number),
    });
    // The content core must NOT create class rows — that is the caller's job.
    expect(mockClassSectionCreate).not.toHaveBeenCalled();
    expect(mockLessonQuestionCreateMany).not.toHaveBeenCalled();
  });

  it('upserts generated vocab with a null firstSeenClassId (practice provenance)', async () => {
    setupHappyPath();

    await composeListeningContent(CONTENT_PARAMS);

    expect(mockLearnerVocabUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ firstSeenClassId: null }),
      }),
    );
  });
});
