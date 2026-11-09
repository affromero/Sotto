import type { runAssessmentAudioObservationTransaction } from '@/lib/learning/classes/audio/assessment-audio-claim';
import type {
  SottoJobExecutionCapability,
  SottoJobExecutionOperation,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { expect, vi } from 'vitest';
import { assessmentProviderRequest } from '@/lib/learning/classes/provider/assessment-provider-request';
import { authorAssessmentSection } from '@/lib/learning/classes/generation/assessment-authoring';
import { requireCompleteAssessmentProviderStage } from '@/lib/learning/classes/provider/assessment-provider-journal';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import type { requirePendingAssessmentWork } from '@/lib/learning/classes/generation/assessment-work';
import { initialA1MaterialHash } from '@/lib/classes/lesson/initial-a1-provenance';
import { admitAssessmentWork } from '@/lib/learning/classes/generation/assessment-admission';
import { learningScriptHash } from '@/lib/learning/script-hash';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { createSkillRequirements } from '@sotto/shared';
import { randomUUID } from 'node:crypto';
import { authorizedLearnerExecution } from '../../../../../helpers/runtime/provider-execution';
import type {
  SharedTestIdentity,
  SharedTestInstance,
} from '../../../../../helpers/setup/shared-instance';

interface AudioSetupContext {
  instance: SharedTestInstance;
  identity: SharedTestIdentity;
  classId: string;
  completionMode: string;
}

export async function setupAssessmentAudio({
  instance,
  identity,
  classId,
  completionMode,
}: AudioSetupContext) {
  const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
  const requirements = createSkillRequirements({
    scope: 'CLASS',
    nativeLang: 'es',
    targetLang: 'ru',
    level: 'A1',
    ttsProvider: 'local',
    sttProvider: 'local',
  });
  await instance.database.courseClass.update({
    where: { id: classId },
    data: { skillRequirements: requirements },
  });
  const turns = [{ speaker: 'HOST', text: 'Привет' }];
  const formativeAudio = await instance.database.episode.create({
    data: {
      userId: identity.ownerId,
      title: 'Formative',
      topic: 'Greetings',
      status: 'READY',
      audioUrl: '/audio',
      script: { create: { turns, markdown: 'Привет' } },
    },
  });
  const listening = await instance.database.classSection.create({
    data: {
      classId,
      skill: 'LISTENING',
      status: 'READY',
      seed: 'listening',
      episodeId: formativeAudio.id,
      spec: { scriptHash: learningScriptHash(turns) },
    },
  });
  await instance.database.lessonQuestion.createMany({
    data: Array.from({ length: 4 }, (_, index) => ({
      sectionId: listening.id,
      order: index,
      skill: 'LISTENING' as const,
      question: `Listen ${index}`,
      options: ['a', 'b', 'c', 'd'],
      correctIndex: 0,
      explanation: 'Reason',
    })),
  });
  const speaking = await instance.database.classSection.create({
    data: {
      classId,
      skill: 'SPEAKING',
      status: 'READY',
      seed: 'speaking',
      spec: {},
    },
  });
  await instance.database.speakingPrompt.createMany({
    data: Array.from({ length: 4 }, (_, index) => ({
      sectionId: speaking.id,
      order: index,
      targetPhrase: `Слово ${index}`,
      translation: 'Palabra',
      referenceTtsUrl: '/reference',
    })),
  });
  const materialHash = await sottoTransaction(instance.database, (tx) =>
    initialA1MaterialHash(tx, classId, identity.ownerId)
  );
  const receiptId = randomUUID();
  await instance.database.courseClass.update({
    where: { id: classId },
    data: {
      prerequisiteGate: {
        version: 1,
        receiptId,
        classId,
        courseId: cls.courseId,
        userId: identity.ownerId,
        attempt: cls.attempt,
        materialHash,
        acknowledgment: { userId: identity.ownerId, receiptId, materialHash },
      },
    },
  });
  const execution = authorizedLearnerExecution(identity.ownerId);
  const selection = {
    provider: 'openai',
    model: 'fixture-model',
    credentialFingerprint: null,
    moderationCredentialFingerprint: null,
  };
  const record = await sottoTransaction(instance.database, (tx) =>
    admitAssessmentWork(tx, {
      id: randomUUID(),
      revision: randomUUID(),
      assessmentId: randomUUID(),
      classId,
      classAttempt: cls.attempt,
      assessmentAttempt: 1,
      ...(completionMode === 'worker' ? { materialVersion: 2 as const } : {}),
      expiresAt: Date.now() + 300_000,
      selection,
      execution,
    })
  );
  return { cls, requirements, execution, selection, record };
}

interface AudioAdapterContext {
  instance: SharedTestInstance;
  operation: { id: string; fingerprint: string };
  execution: SottoProviderExecution;
  selection: Parameters<typeof admitAssessmentWork>[1]['selection'];
  captured: Awaited<ReturnType<typeof requirePendingAssessmentWork>>;
  speakingDraft: unknown;
  completionMode: string;
  actualProvider: typeof import('@/lib/providers/ai').createAIProvider;
}

export async function checkAssessmentAudioAdapter({
  instance,
  operation,
  execution,
  selection,
  captured,
  speakingDraft,
  completionMode,
  actualProvider,
}: AudioAdapterContext) {
  const adapterInput = {
    identity: operation,
    execution,
    stage: 'AUTHOR_SPEAKING' as const,
    inputDigest: '3'.repeat(64),
    selection,
    signal: new AbortController().signal,
    unresolved: () => {
      throw new Error('Unexpected unresolved call');
    },
  };
  const requests: string[] = [];
  const runAdapter = async (replayOnly = false) => {
    const journal = assessmentProviderRequest({ ...adapterInput, replayOnly });
    const fetcher: typeof fetch = async (resource, init) => {
      const request = new Request(resource, init);
      return journal(request, async () => {
        if (replayOnly) throw new Error('Replay attempted provider dispatch');
        requests.push(new URL(request.url).pathname);
        if (request.url.endsWith('/moderations'))
          return Response.json({
            results: [{ categories: {}, category_scores: {}, flagged: false }],
          });
        return Response.json({
          id: 'fixture',
          choices: [
            {
              message: { role: 'assistant', content: JSON.stringify(speakingDraft) },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        });
      });
    };
    const authored = await authorAssessmentSection(
      {
        source: captured.source.source,
        prerequisite: captured.source.prerequisite,
        requirements: captured.source.requirements,
        skill: 'SPEAKING',
        materialVersion: completionMode === 'worker' ? 2 : 1,
      },
      async (request) =>
        (
          await actualProvider('openai').generateResponse(
            request.system,
            [{ role: 'user', content: request.payload }],
            {
              apiKeyOverride: 'fixture-key',
              model: 'fixture-model',
              fetch: fetcher,
              moderation: { fetch: fetcher, bypassCache: true },
              signal: adapterInput.signal,
              jsonSchema: { name: 'assessment_speaking', schema: request.schema },
            }
          )
        ).content
    );
    await sottoTransaction(instance.database, (tx) =>
      requireCompleteAssessmentProviderStage(tx, adapterInput, journal.consumedCalls())
    );
    return authored;
  };
  expect(await runAdapter()).toEqual(speakingDraft);
  const offlineAdapter = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('Replay attempted network access');
  });
  try {
    expect(await runAdapter(true)).toEqual(speakingDraft);
  } finally {
    offlineAdapter.mockRestore();
  }
  expect(requests).toEqual(['/v1/moderations', '/v1/chat/completions']);
}

export function createAssessmentAudioFailureFixtures(
  instance: SharedTestInstance,
  audioQueue: typeof import('@/lib/queue') | undefined
) {
  async function failQueuedAudio(operationId: string) {
    if (!audioQueue) throw new Error('Private assessment audio queue is unavailable');
    const { Worker, UnrecoverableError } = await import('bullmq');
    const redisUrl = new URL(process.env.SOTTO_TEST_PRIVATE_REDIS_URL!);
    const terminalWorker = new Worker(
      audioQueue.audioGenerationQueue.name,
      async (): Promise<void> => {
        throw new UnrecoverableError('Terminal observation fixture');
      },
      {
        autorun: false,
        connection: {
          host: redisUrl.hostname,
          port: Number(redisUrl.port),
          maxRetriesPerRequest: null,
        },
      }
    );
    const terminal = new Promise<void>((resolve, reject) => {
      terminalWorker.on('failed', (job) => {
        if (job?.id === operationId) resolve();
      });
      terminalWorker.on('error', reject);
    });
    const workerRun = terminalWorker.run();
    try {
      await terminal;
    } finally {
      await terminalWorker.close();
      await workerRun;
    }
    const terminalJob = await audioQueue.audioGenerationQueue.getJob(operationId);
    if (!terminalJob) throw new Error('Terminal assessment delivery missing');
    return terminalJob;
  }

  async function captureFailedAudio(
    context: { capability: SottoJobExecutionCapability; operation: SottoJobExecutionOperation },
    identity: Parameters<typeof runAssessmentAudioObservationTransaction>[0]['identity'] & {
      nonce: string;
    }
  ) {
    if (!audioQueue) throw new Error('Private assessment audio queue is unavailable');
    const terminalJob = await failQueuedAudio(identity.operationId);
    try {
      const { captureFailedAssessmentAudioEvidence } =
        await import('@/lib/learning/classes/audio/assessment-audio-failure');
      return await captureFailedAssessmentAudioEvidence({
        database: instance.database,
        queue: audioQueue.audioGenerationQueue,
        identity,
        ...context,
      });
    } finally {
      await terminalJob.retry();
    }
  }
  return { failQueuedAudio, captureFailedAudio };
}
