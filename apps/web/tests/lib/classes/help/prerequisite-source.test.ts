// @vitest-environment private-redis
import { afterAll, beforeAll, beforeEach, describe, vi } from 'vitest';
import { createSkillRequirements } from '@sotto/shared';
import type { PrismaClient } from '@/generated/prisma/client';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../../helpers/setup/shared-instance';
import { sampleTeaching } from '../../../helpers/learning/class-teaching';
import { registerWorksheetDeletionCases } from './prerequisite-cases/worksheet-deletion';
import { registerAssessmentExecutionCase } from './prerequisite-cases/assessment-execution';
import { registerAssessmentCliJournalCase } from './prerequisite-cases/assessment-cli-journal';
import { registerSavedSourceCases } from './prerequisite-cases/saved-source-cases';
import { registerAssessmentOutcomeCases } from './prerequisite-cases/assessment-outcome-cases';
import { registerAssessmentAudioCases } from './prerequisite-cases/assessment-audio-cases';
import {
  registerLearnerAssessmentAdmissionCase,
  registerUnavailableAssessmentCase,
} from './prerequisite-cases/admission-cases';
import { registerAssessmentAuthoringCases } from './prerequisite-cases/assessment-authoring-cases';

const boundary = vi.hoisted(() => ({
  database: null as PrismaClient | null,
  execution: null as SottoProviderExecution | null,
  speakingFixture: false,
}));
const provider = vi.hoisted(() => ({ generate: vi.fn() }));
const cliBoundary = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@/lib/learning-ai', () => ({
  captureLearningModerationCredential: async () => null,
  resolveCapturedLearningAi: async (...args: [string, unknown]) => {
    boundary.execution = args[1] as SottoProviderExecution;
    if (boundary.execution.learningSelection?.provider === 'codex')
      return {
        provider: 'codex',
        model: boundary.execution.learningSelection.model,
        execution: { ...boundary.execution, userId: args[0] },
      };
    return { provider: 'fixture', model: 'fixture', execution: args[1] };
  },
  capturedLearningAiOptions: async (ai: {
    provider: string;
    model: string;
    execution: SottoProviderExecution;
  }) => ({
    model: ai.model,
    ...(ai.provider === 'codex'
      ? {
          moderation: {
            fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
              if (!ai.execution.providerRequest) throw new Error('Missing provider journal');
              return ai.execution.providerRequest(new Request(input, init), async () =>
                Response.json({ results: [{ categories: {}, category_scores: {} }] })
              );
            },
          },
        }
      : {}),
  }),
}));
vi.mock('@/lib/learning/preparation/provider-invocation', async (load) => ({
  ...(await load<typeof import('@/lib/learning/preparation/provider-invocation')>()),
  executeLearningCliOnce: (...args: unknown[]) => cliBoundary.execute(...args),
}));
vi.mock('@/lib/agent-usage/providers/codex', async (load) => ({
  ...(await load<typeof import('@/lib/agent-usage/providers/codex')>()),
  captureCodexMaterialBinding: async () => ({
    fingerprint: '9'.repeat(64),
    selection: { configurationSha256: 'revision' },
  }),
}));
vi.mock('@/lib/providers/ai', async (load) => {
  const actual = await load<typeof import('@/lib/providers/ai')>();
  const { prerequisiteDirectionFixture } =
    await import('../../../helpers/learning/prerequisite-provider');
  return {
    ...actual,
    aiProviderRules: (...args: Parameters<typeof actual.aiProviderRules>) =>
      boundary.speakingFixture
        ? [{ origin: 'https://provider.example', pathPrefix: '/' }]
        : actual.aiProviderRules(...args),
    createAIProvider: () => ({
      generateResponse: (
        system: string,
        messages: Array<{ content: string }>,
        options?: { jsonSchema?: { name?: string }; apiKeyOverride?: string; fetch?: typeof fetch }
      ) => {
        if (options?.apiKeyOverride === 'SOTTO_OFFLINE_RESPONSE_REPLAY') {
          if (!options.fetch) throw new Error('Missing offline fetch');
          return options
            .fetch('https://provider.example.test/REVIEW', { method: 'POST', body: 'REVIEW' })
            .then((response) => response.json())
            .then((value: { choices: Array<{ message: { content: string } }> }) => ({
              content: value.choices[0]!.message.content,
              model: 'fixture',
            }));
        }
        return (
          prerequisiteDirectionFixture(messages, options) ??
          provider.generate(system, messages, options)
        );
      },
    }),
  };
});
vi.mock('@/lib/providers/stt', async (load) => {
  const actual = await load<typeof import('@/lib/providers/stt')>();
  return {
    ...actual,
    resolveCapturedSttProvider: async (
      input: Parameters<typeof actual.resolveCapturedSttProvider>[0]
    ) => {
      if (!boundary.speakingFixture) return actual.resolveCapturedSttProvider(input);
      return {
        selection: {
          providerId: 'openai',
          model: 'fixture',
          baseUrl: null,
          credentialFingerprint: null,
        },
        provider: {
          transcribe: async () => {
            if (!input.execution.providerRequest)
              throw new Error('Missing speaking provider request');
            await input.execution.providerRequest(
              new Request('https://provider.example/stt'),
              async () => Response.json({ text: 'Привет' })
            );
            return { text: 'Привет', words: [] };
          },
        },
      };
    },
  };
});
vi.mock('@/lib/sidedoor/credentials/runtime/provider-execution', async (load) => {
  const actual =
    await load<typeof import('@/lib/sidedoor/credentials/runtime/provider-execution')>();
  return {
    ...actual,
    createSottoProviderTransport: async (
      ...args: Parameters<typeof actual.createSottoProviderTransport>
    ) => {
      if (!boundary.speakingFixture) return actual.createSottoProviderTransport(...args);
      const execution = args[0];
      return {
        authenticatedFetch: async (request: RequestInfo | URL, init?: RequestInit) => {
          if (!execution.providerRequest) throw new Error('Missing speaking provider request');
          return execution.providerRequest(new Request(request, init), async () =>
            Response.json({ result: 'scored' })
          );
        },
      };
    },
  };
});
vi.mock('@/lib/pronunciation/scorer', async (load) => {
  const actual = await load<typeof import('@/lib/pronunciation/scorer')>();
  return {
    ...actual,
    resolvePronunciationScorer: (
      context: Parameters<typeof actual.resolvePronunciationScorer>[0]
    ) => {
      if (!boundary.speakingFixture) return actual.resolvePronunciationScorer(context);
      return {
        score: async (input: { transcript: string; fetch: typeof fetch }) => {
          await input.fetch('https://provider.example/score');
          return {
            transcript: input.transcript,
            overallScore: 0.8,
            rubricScores: { accuracy: 0.8, completeness: 0.8 },
            phonemeScores: [],
            feedback: 'Bien.',
          };
        },
      };
    },
  };
});
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('saved prerequisite source', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let classId: string;
  let questionId: string;
  let audioQueue: typeof import('@/lib/queue') | undefined;
  const queuedAudio: string[] = [];

  beforeAll(async () => {
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'prerequisite-source-test-key');
    if (process.env.SOTTO_TEST_PRIVATE_REDIS_URL) {
      audioQueue = await import('@/lib/queue');
      const client = (await import('@/lib/redis')).getSharedQueueRedisClient();
      if (client.options.port !== Number(new URL(process.env.SOTTO_TEST_PRIVATE_REDIS_URL).port))
        throw new Error('Assessment queue is not connected to its private Redis');
    }
    instance = await createSharedTestInstance('prerequisite_source');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    provider.generate.mockReset();
    cliBoundary.execute.mockReset();
    boundary.execution = null;
    boundary.speakingFixture = false;
    identity = await instance.reset();
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'es', targetLang: 'ru' } },
      create: { nativeLang: 'es', targetLang: 'ru', title: 'Russian' },
      update: {},
    });
    const lesson = await instance.database.lesson.create({
      data: {
        curriculumId: curriculum.id,
        slug: `first-${identity.ownerId}`,
        level: 'A1',
        order:
          (await instance.database.lesson.count({ where: { curriculumId: curriculum.id } })) + 1,
        title: 'First words',
        objective: 'Make a request',
        grammarPoints: [],
        targetVocab: [],
        vocabThemes: [],
      },
    });
    const course = await instance.database.course.create({
      data: {
        userId: identity.ownerId,
        curriculumId: curriculum.id,
        nativeLang: 'es',
        targetLang: 'ru',
      },
    });
    const cls = await instance.database.courseClass.create({
      data: {
        courseId: course.id,
        lessonId: lesson.id,
        order: 1,
        status: 'IN_PROGRESS',
        learnerAnswers: { secret: 1 },
        writingDrafts: { private: 'PRIVATE_DRAFT' },
        skillRequirements: createSkillRequirements({
          scope: 'CLASS',
          nativeLang: 'es',
          targetLang: 'ru',
          level: 'A1',
          ttsProvider: null,
          sttProvider: null,
        }),
        adaptiveSeed: {
          teaching: {
            ...sampleTeaching,
            guidedPractice: {
              ...sampleTeaching.guidedPractice,
              answer: 'PRIVATE_GUIDED_ANSWER',
              explanation: 'PRIVATE_GUIDED_EXPLANATION',
            },
          },
        },
      },
    });
    classId = cls.id;
    const section = await instance.database.classSection.create({
      data: { classId, skill: 'GRAMMAR', attempt: 1, status: 'READY', seed: 'seed', spec: {} },
    });
    const question = await instance.database.lessonQuestion.create({
      data: {
        sectionId: section.id,
        order: 1,
        skill: 'GRAMMAR',
        question: 'Pide té con cortesía.',
        options: ['Чай, пожалуйста', 'Спасибо', 'Привет', 'До свидания'],
        correctIndex: 0,
        explanation: 'PRIVATE_ASSESSMENT_EXPLANATION',
      },
    });
    questionId = question.id;
    await instance.database.lessonQuestion.createMany({
      data: Array.from({ length: 4 }, (_, index) => ({
        sectionId: section.id,
        order: index + 2,
        skill: 'GRAMMAR' as const,
        question: `Pregunta ${index + 2}`,
        options: ['Uno', 'Dos', 'Tres', 'Cuatro'],
        correctIndex: 0,
        explanation: 'Explicación.',
      })),
    });
    const reading = await instance.database.classSection.create({
      data: { classId, skill: 'READING', attempt: 1, status: 'READY', seed: 'seed', spec: {} },
    });
    await instance.database.lessonQuestion.createMany({
      data: Array.from({ length: 5 }, (_, index) => ({
        sectionId: reading.id,
        order: index + 1,
        skill: 'READING' as const,
        question: `Lectura ${index + 1}`,
        options: ['Uno', 'Dos', 'Tres', 'Cuatro'],
        correctIndex: 0,
        explanation: 'Explicación.',
        passageText: 'Un texto para leer.',
      })),
    });
    const writing = await instance.database.classSection.create({
      data: { classId, skill: 'WRITING', attempt: 1, status: 'READY', seed: 'seed', spec: {} },
    });
    await instance.database.writingPrompt.create({
      data: {
        sectionId: writing.id,
        order: 1,
        task: 'Escribe una petición.',
        guidance: 'Usa cortesía.',
        ideas: ['PRIVATE_OPTIONAL_OPENING'],
      },
    });
    await instance.database.writingPrompt.createMany({
      data: [
        { sectionId: writing.id, order: 2, task: 'Escribe otro saludo.' },
        { sectionId: writing.id, order: 3, task: 'Escribe un mensaje.' },
      ],
    });
  });
  afterAll(async () => {
    try {
      if (audioQueue) {
        try {
          for (const jobId of queuedAudio)
            await (await audioQueue.audioGenerationQueue.getJob(jobId))?.remove();
        } finally {
          try {
            await audioQueue.audioGenerationQueue.close();
          } finally {
            await (await import('@/lib/redis')).closeRedis();
          }
        }
      }
    } finally {
      boundary.database = null;
      await instance?.close();
      vi.unstubAllEnvs();
    }
  });

  registerWorksheetDeletionCases(() => ({ instance, identity, classId }));

  registerAssessmentAuthoringCases(() => ({ instance, identity, classId, questionId, provider }));
  registerLearnerAssessmentAdmissionCase(() => ({ instance, identity, classId }));

  registerAssessmentOutcomeCases(() => ({
    instance,
    identity,
    classId,
    audioQueue,
    boundary,
    provider,
  }));

  registerUnavailableAssessmentCase(() => ({ instance, identity, classId }));

  registerAssessmentExecutionCase(() => ({ instance, identity, classId, questionId }));

  registerAssessmentCliJournalCase(() => ({ instance, identity, classId, cliBoundary }));

  registerAssessmentAudioCases(() => ({
    instance,
    identity,
    classId,
    questionId,
    audioQueue,
    queuedAudio,
    boundary,
    provider,
  }));

  registerSavedSourceCases(() => ({ instance, identity, classId, questionId, provider }));
});
