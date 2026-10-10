import { vi } from 'vitest';
import type { ClassListeningParams } from '@/lib/class-listening-generator';
import { authorizedLearnerExecution } from './provider-execution';
import {
  emptyTeachingCriticFixture,
  novelFindingCorroborationFixture,
  shapeTeachingProviderFixture,
} from '../../lib/classes/quality/intro-provider-fixture';

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
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: async (userId: string, execution: { signal?: AbortSignal }) => {
    const key = await mockGetAiKey();
    if (key) {
      const model = mockGetAiProviderMeta(key.provider)?.defaultModel;
      if (!model) throw new Error(`No default AI model configured for provider "${key.provider}".`);
      return {
        provider: key.provider,
        model,
        apiKey: key.apiKey,
        execution: { ...execution, userId },
      };
    }
    if (process.env.AI_PROVIDER === 'claude-code')
      return {
        provider: 'claude-code',
        model: 'claude-sonnet-4-6',
        execution: { ...execution, userId },
      };
    throw new Error('No AI provider available');
  },
  capturedLearningAiOptions: async (ai: { model: string; apiKey?: string }) => ({
    model: ai.model,
    apiKeyOverride: ai.apiKey,
  }),
}));
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
const { mockTeachingResponse, mockTeachingCriticResponse, mockBlindResponse } = vi.hoisted(() => ({
  mockTeachingResponse: vi.fn(),
  mockTeachingCriticResponse: vi.fn(),
  mockBlindResponse: vi.fn(),
}));
const { mockCreateAIProvider, mockGenerateResponse } = vi.hoisted(() => {
  const generateResponse = vi.fn();
  return {
    mockCreateAIProvider: vi.fn((provider: string) => {
      if (!provider) throw new Error('A provider must be explicitly selected.');
      return {
        generateResponse: async (
          system: string,
          messages: Array<{ content: string }>,
          options: unknown
        ) => {
          const corroboration = novelFindingCorroborationFixture(messages, options);
          if (corroboration) return corroboration;
          const name = (options as { jsonSchema?: { name: string } })?.jsonSchema?.name;
          if (name === 'class_teaching_critic')
            return shapeTeachingProviderFixture(
              system,
              messages,
              options,
              await mockTeachingCriticResponse(system, messages, options)
            );
          if (name === 'class_teaching_adjudicator')
            return shapeTeachingProviderFixture(
              system,
              messages,
              options,
              await mockTeachingResponse(system, messages, options)
            );
          return name === 'class_section_quality'
            ? mockBlindResponse(system, messages, options)
            : generateResponse(system, messages, options);
        },
      };
    }),
    mockGenerateResponse: generateResponse,
  };
});
const { mockLoadAndRender } = vi.hoisted(() => ({ mockLoadAndRender: vi.fn() }));
const { mockLogUsage } = vi.hoisted(() => ({ mockLogUsage: vi.fn() }));

// ---- Module mocks ----

vi.mock('@/lib/prisma', () => {
  const database = {
    $queryRaw: async () => [],
    courseClass: {
      findUnique: async () => ({ status: 'GENERATING', attempt: 1, course: { userId: 'u1' } }),
    },
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
  };
  return {
    prisma: database,
    prismaUnfiltered: {
      ...database,
      $transaction: async (write: (db: typeof database) => Promise<unknown>) => write(database),
    },
  };
});

vi.mock('@/lib/script-generator', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/script-generator')>()),
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
  createAIProvider: (provider: string) => mockCreateAIProvider(provider),
}));

const mockGetConfiguredTtsProviderId = vi.fn(() => null as string | null);
const mockResolveTtsProvider = vi.fn();
const mockGetServerInfra = vi.fn().mockResolvedValue({});
vi.mock('@/lib/server-config', () => ({
  getServerInfra: () => mockGetServerInfra(),
}));
vi.mock('@/lib/providers/tts', async (importOriginal) => ({
  selectTtsProviderId: (await importOriginal<typeof import('@/lib/providers/tts')>())
    .selectTtsProviderId,
  selectedTtsModel: (await importOriginal<typeof import('@/lib/providers/tts')>()).selectedTtsModel,
  isSpeechDisabled: (await importOriginal<typeof import('@/lib/providers/tts')>()).isSpeechDisabled,
  getConfiguredTtsProviderId: () => mockGetConfiguredTtsProviderId(),
  resolveTtsProvider: (...args: unknown[]) => mockResolveTtsProvider(...args),
}));

vi.mock('@/lib/prompt-loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/prompt-loader')>()),
  loadAndRender: (...args: unknown[]) => mockLoadAndRender(...args),
}));

vi.mock('@/lib/usage-logger', () => ({
  logUsage: (...args: unknown[]) => mockLogUsage(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

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

const SAMPLE_QUESTIONS_JSON = JSON.stringify({
  questions: [
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
  ],
});

const PARAMS: ClassListeningParams = {
  userId: 'u1',
  execution: authorizedLearnerExecution('u1'),
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
  mockGetServerInfra.mockResolvedValue({});
  mockTeachingCriticResponse.mockImplementation((_system, messages) =>
    emptyTeachingCriticFixture(messages)
  );
  mockTeachingResponse.mockImplementation(async (...args) => ({
    content: JSON.stringify({
      items: JSON.parse(args[1][0].content).items.map((item: { index: number }) => ({
        index: item.index,
        acceptable: true,
        issues: [],
        feedback: [],
      })),
    }),
    model: 'm',
  }));
  mockBlindResponse.mockResolvedValue({
    content: JSON.stringify({
      passageFindings: [],
      issues: [],
      questions: [0, 2, 0, 2].map((key, index) => ({
        index,
        acceptableOptionIndices: [key],
        issues: [],
      })),
    }),
    model: 'm',
  });

  mockGetConfiguredTtsProviderId.mockReturnValue('kokoro');
  mockResolveTtsProvider.mockImplementation(async (context: { requestedProvider: string }) => ({
    providerId: context.requestedProvider,
    provider: { getModelId: () => 'configured-model' },
  }));
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
  mockVerifyEpisodeReferences.mockResolvedValue({ total: 1, verified: 1, allVerified: true });
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

export {
  mockEpisodeCreate,
  mockEpisodeUpdate,
  mockScriptCreate,
  mockVocabEntryCreateMany,
  mockLearnerVocabUpsert,
  mockClassSectionCreate,
  mockLessonQuestionCreateMany,
  mockUserFindUnique,
  mockTransaction,
  mockGenerateScript,
  mockGetAiKey,
  mockGetAiProviderMeta,
  mockCreateSegmentsAndQueueAudio,
  mockPersistGeneratedReferences,
  mockVerifyEpisodeReferences,
  mockTeachingResponse,
  mockTeachingCriticResponse,
  mockBlindResponse,
  mockCreateAIProvider,
  mockGenerateResponse,
  mockLoadAndRender,
  mockLogUsage,
  mockGetConfiguredTtsProviderId,
  mockResolveTtsProvider,
  mockGetServerInfra,
  SAMPLE_TURNS,
  SAMPLE_VOCABULARY,
  SAMPLE_SCRIPT_RESULT,
  SAMPLE_QUESTIONS_JSON,
  PARAMS,
  setupHappyPath,
};
