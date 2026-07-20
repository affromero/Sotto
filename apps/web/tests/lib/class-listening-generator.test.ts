import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Hoisted mock handles (vi.hoisted so they are available before vi.mock calls) ----

const {
  mockEpisodeCreate,
  mockEpisodeUpdate,
  mockScriptCreate,
  mockVocabEntryCreateMany,
  mockLearnerVocabUpsert,
  mockClassSectionCreate,
  mockLessonQuestionCreateMany,
  mockUserFindUnique,
  mockTransaction,
} = vi.hoisted(() => {
  const episodeCreate = vi.fn();
  const episodeUpdate = vi.fn();
  const scriptCreate = vi.fn();
  const vocabEntryCreateMany = vi.fn();
  const learnerVocabUpsert = vi.fn();
  const classSectionCreate = vi.fn();
  const lessonQuestionCreateMany = vi.fn();
  const userFindUnique = vi.fn();
  const transaction = vi.fn();

  return {
    mockEpisodeCreate: episodeCreate,
    mockEpisodeUpdate: episodeUpdate,
    mockScriptCreate: scriptCreate,
    mockVocabEntryCreateMany: vocabEntryCreateMany,
    mockLearnerVocabUpsert: learnerVocabUpsert,
    mockClassSectionCreate: classSectionCreate,
    mockLessonQuestionCreateMany: lessonQuestionCreateMany,
    mockUserFindUnique: userFindUnique,
    mockTransaction: transaction,
  };
});

const { mockGenerateScript } = vi.hoisted(() => ({ mockGenerateScript: vi.fn() }));
const { mockCreateSegmentsAndQueueAudio } = vi.hoisted(() => ({
  mockCreateSegmentsAndQueueAudio: vi.fn(),
}));
const { mockPersistGeneratedReferences } = vi.hoisted(() => ({
  mockPersistGeneratedReferences: vi.fn(),
}));
const { mockVerifyEpisodeReferences } = vi.hoisted(() => ({
  mockVerifyEpisodeReferences: vi.fn(),
}));
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
    episode: {
      create: (...args: unknown[]) => mockEpisodeCreate(...args),
      update: (...args: unknown[]) => mockEpisodeUpdate(...args),
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
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
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

vi.mock('@/lib/references', () => ({
  persistGeneratedReferences: (...args: unknown[]) => mockPersistGeneratedReferences(...args),
}));

vi.mock('@/lib/reference-verification/verify-episode', () => ({
  verifyEpisodeReferences: (...args: unknown[]) => mockVerifyEpisodeReferences(...args),
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

const mockGetConfiguredTtsProviderId = vi.fn(() => null as string | null);
vi.mock('@/lib/providers/tts', () => ({
  getConfiguredTtsProviderId: () => mockGetConfiguredTtsProviderId(),
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
  { speaker: 'HOST', text: 'Hola, bienvenidos al episode.' },
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
  markdown: '## Episode\n\nHola, bienvenidos.',
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
  mockUserFindUnique.mockResolvedValue({ preferredTtsModel: null });
  mockEpisodeCreate.mockResolvedValue({ id: 'episode-1' });
  mockEpisodeUpdate.mockResolvedValue({});
  mockGenerateScript.mockResolvedValue(SAMPLE_SCRIPT_RESULT);

  // $transaction receives a callback; execute it with a tx proxy that delegates to the mocks
  mockTransaction.mockImplementation(
    async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = {
        script: { create: (...args: unknown[]) => mockScriptCreate(...args) },
        vocabularyEntry: { createMany: (...args: unknown[]) => mockVocabEntryCreateMany(...args) },
      };
      return cb(tx);
    }
  );

  mockScriptCreate.mockResolvedValue({});
  mockVocabEntryCreateMany.mockResolvedValue({ count: SAMPLE_VOCABULARY.length });
  mockCreateSegmentsAndQueueAudio.mockResolvedValue(undefined);
  mockPersistGeneratedReferences.mockResolvedValue(undefined);
  mockVerifyEpisodeReferences.mockResolvedValue(true);
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
    mockUserFindUnique.mockResolvedValue({ preferredTtsModel: null });
  });

  describe('happy path', () => {
    it('returns { sectionId, episodeId } on success', async () => {
      setupHappyPath();

      const result = await generateClassListening(PARAMS);

      expect(result).toEqual({ sectionId: 'section-1', episodeId: 'episode-1' });
    });

    it('creates a CLASS-source PRIVATE episode for the user', async () => {
      setupHappyPath();

      await generateClassListening(PARAMS);

      expect(mockEpisodeCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'u1',
            source: 'CLASS',
            visibility: 'PRIVATE',
            language: 'es',
            status: 'PENDING',
          }),
        })
      );
    });

    it('seeds the CLASS episode with the configured local TTS provider (TTS_PROVIDER=kokoro)', async () => {
      setupHappyPath();
      mockGetConfiguredTtsProviderId.mockReturnValue('kokoro');

      await generateClassListening(PARAMS);

      expect(mockEpisodeCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ttsProvider: 'kokoro' }),
        })
      );
    });

    it('calls generateScript with targetLanguage, conversational_mix and forLearning', async () => {
      setupHappyPath();

      await generateClassListening(PARAMS);

      expect(mockGenerateScript).toHaveBeenCalledWith(
        expect.objectContaining({
          targetLanguage: 'es',
          languageMode: 'conversational_mix',
          forLearning: true,
          mustIncludeVocabulary: PARAMS.mustIncludeVocab,
        })
      );
    });

    it('persists script and vocabulary inside a $transaction', async () => {
      setupHappyPath();

      await generateClassListening(PARAMS);

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockScriptCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            episodeId: 'episode-1',
            turns: SAMPLE_TURNS,
            markdown: SAMPLE_SCRIPT_RESULT.markdown,
          }),
        })
      );
      expect(mockVocabEntryCreateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ episodeId: 'episode-1', word: 'hola', translation: 'hello' }),
            expect.objectContaining({
              episodeId: 'episode-1',
              word: 'gracias',
              translation: 'thank you',
            }),
          ]),
        })
      );
    });

    it('calls createSegmentsAndQueueAudio with episodeId and the turns', async () => {
      setupHappyPath();

      await generateClassListening(PARAMS);

      expect(mockCreateSegmentsAndQueueAudio).toHaveBeenCalledWith('episode-1', SAMPLE_TURNS);
    });

    it('marks the episode as generating audio before queueing segment audio', async () => {
      setupHappyPath();

      await generateClassListening(PARAMS);

      expect(mockEpisodeUpdate).toHaveBeenCalledWith({
        where: { id: 'episode-1' },
        data: { status: 'GENERATING_AUDIO' },
      });
      expect(mockEpisodeUpdate.mock.invocationCallOrder[0]).toBeLessThan(
        mockCreateSegmentsAndQueueAudio.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER
      );
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
          })
        );
      }
    });

    it('creates a LISTENING ClassSection with the episodeId and status READY', async () => {
      setupHappyPath();

      await generateClassListening(PARAMS);

      expect(mockClassSectionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            classId: 'class-1',
            skill: 'LISTENING',
            status: 'READY',
            episodeId: 'episode-1',
          }),
        })
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
        })
      );
    });

    it('logs usage for both script and quiz generation steps', async () => {
      setupHappyPath();

      await generateClassListening(PARAMS);

      expect(mockLogUsage).toHaveBeenCalledTimes(2);
      expect(mockLogUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'class-listening-script',
          userId: 'u1',
          episodeId: 'episode-1',
        })
      );
      expect(mockLogUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'class-listening-quiz',
          userId: 'u1',
          episodeId: 'episode-1',
        })
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

    it('marks episode FAILED and re-throws when generateScript throws', async () => {
      mockGetAiKey.mockResolvedValue({ provider: 'anthropic', apiKey: 'k' });
      mockGetAiProviderMeta.mockReturnValue({ defaultModel: 'm' });
      mockEpisodeCreate.mockResolvedValue({ id: 'episode-1' });
      mockEpisodeUpdate.mockResolvedValue({});
      mockGenerateScript.mockRejectedValue(new Error('AI timeout'));

      await expect(generateClassListening(PARAMS)).rejects.toThrow('AI timeout');
      expect(mockEpisodeUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'episode-1' }, data: { status: 'FAILED' } })
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
      // Episode should be marked FAILED on error
      expect(mockEpisodeUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'FAILED' } })
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
        })
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

  it('returns the episode id + comprehension questions without persisting a class section', async () => {
    setupHappyPath();

    const content = await composeListeningContent(CONTENT_PARAMS);

    expect(content.episodeId).toBe('episode-1');
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
      })
    );
  });

  describe('curriculum class (no sourceContent)', () => {
    it('lets generateScript run with web search and persists no references', async () => {
      setupHappyPath();

      await composeListeningContent(CONTENT_PARAMS);

      expect(mockGenerateScript).toHaveBeenCalledWith(
        expect.objectContaining({ sourceContent: undefined, webSearchEnabled: true })
      );
      expect(mockPersistGeneratedReferences).toHaveBeenCalledWith('episode-1', []);
      expect(mockVerifyEpisodeReferences).not.toHaveBeenCalled();
    });
  });

  describe('sourced class (with sourceContent)', () => {
    const SOURCED_PARAMS: ListeningContentParams = {
      ...CONTENT_PARAMS,
      sourceContent: 'Una vez un científico descubrió algo importante. [1]',
      sourceMetadata: { title: 'Discovery', author: 'A. Researcher', siteName: 'example.org' },
      sourceUrl: 'https://example.org/article',
    };

    const SOURCED_REFERENCES = [
      {
        number: 1,
        title: 'The Real Discovery',
        authors: ['A. Researcher'],
        year: 2020,
        url: 'https://example.org/article',
        type: 'ARTICLE' as const,
        publisher: 'example.org',
        doi: null,
      },
    ];

    it('passes sourceContent + sourceMetadata and disables web search', async () => {
      setupHappyPath();
      mockGenerateScript.mockResolvedValue({
        ...SAMPLE_SCRIPT_RESULT,
        references: SOURCED_REFERENCES,
      });

      await composeListeningContent(SOURCED_PARAMS);

      expect(mockGenerateScript).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceContent: SOURCED_PARAMS.sourceContent,
          sourceMetadata: SOURCED_PARAMS.sourceMetadata,
          webSearchEnabled: false,
        })
      );
    });

    it('verifies generated references before creating audio segments', async () => {
      setupHappyPath();
      mockGenerateScript.mockResolvedValue({
        ...SAMPLE_SCRIPT_RESULT,
        references: SOURCED_REFERENCES,
      });

      await composeListeningContent(SOURCED_PARAMS);

      expect(mockPersistGeneratedReferences).toHaveBeenCalledWith('episode-1', SOURCED_REFERENCES);
      expect(mockVerifyEpisodeReferences).toHaveBeenCalledWith(
        'episode-1',
        CONTENT_PARAMS.userId,
        CONTENT_PARAMS.objective,
        SAMPLE_SCRIPT_RESULT.turns
      );
      expect(mockVerifyEpisodeReferences.mock.invocationCallOrder[0]).toBeLessThan(
        mockCreateSegmentsAndQueueAudio.mock.invocationCallOrder[0]
      );
    });

    it('does not create audio when a cited claim cannot be verified', async () => {
      setupHappyPath();
      mockGenerateScript.mockResolvedValue({
        ...SAMPLE_SCRIPT_RESULT,
        references: SOURCED_REFERENCES,
      });
      mockVerifyEpisodeReferences.mockResolvedValue(false);

      await expect(composeListeningContent(SOURCED_PARAMS)).rejects.toThrow(
        'Class reference verification failed'
      );
      expect(mockCreateSegmentsAndQueueAudio).not.toHaveBeenCalled();
    });

    it('still creates segments exactly once (no double-queue)', async () => {
      setupHappyPath();
      mockGenerateScript.mockResolvedValue({
        ...SAMPLE_SCRIPT_RESULT,
        references: SOURCED_REFERENCES,
      });

      await composeListeningContent(SOURCED_PARAMS);

      expect(mockCreateSegmentsAndQueueAudio).toHaveBeenCalledTimes(1);
      expect(mockCreateSegmentsAndQueueAudio).toHaveBeenCalledWith('episode-1', SAMPLE_TURNS);
    });
  });
});
