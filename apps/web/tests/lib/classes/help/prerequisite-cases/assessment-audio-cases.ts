import { Prisma } from '@/generated/prisma/client';
import { validatePreparationAudio } from '@/lib/classes/preparation-audio';
import {
  beginAssessmentAudioAttempt,
  readAssessmentAudioAttemptStatus,
} from '@/lib/learning/classes/audio/assessment-audio-attempt';
import { runAssessmentAudioObservationTransaction } from '@/lib/learning/classes/audio/assessment-audio-claim';
import { registerAssessmentAudioLineage } from '@/lib/learning/classes/audio/assessment-audio-lineage';
import { stageAssessmentSection } from '@/lib/learning/classes/generation/assessment-draft';
import {
  generateAssessmentSection,
  prepareAssessmentAuthorProof,
  prepareOrGenerateAssessmentAuthorProof,
  verifyAssessmentAuthorProof,
} from '@/lib/learning/classes/generation/assessment-generation';
import {
  requirePendingAssessmentWork,
  startAssessmentWork,
} from '@/lib/learning/classes/generation/assessment-work';
import { assessmentWorkSchema } from '@/lib/learning/classes/lifecycle/assessment-fence';
import { learningSpeechFingerprint } from '@/lib/learning/speech-configuration';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  runSottoExecutionOperation,
  sottoJobExecutions,
  withSottoJobExecution,
  type SottoJobExecutionCapability,
  type SottoJobExecutionOperation,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { randomUUID } from 'node:crypto';
import { removeExecutionWorkspace } from 'thesidedoor-core/storage';
import { isSerializationConflict } from 'thesidedoor-core/storage/sql';
import { expect, it, vi, type Mock } from 'vitest';
import type {
  SharedTestIdentity,
  SharedTestInstance,
} from '../../../../helpers/setup/shared-instance';
import {
  checkAssessmentAudioAdmission,
  checkAssessmentAudioClaims,
  checkAssessmentAudioContention,
} from './audio/claims';
import { checkAssessmentAudioFailure, checkAssessmentAudioUnresolved } from './audio/failure';
import { checkAssessmentAudioIdentity } from './audio/identity';
import { checkAssessmentAudioQueue } from './audio/queue';
import { checkRetainedAssessmentAudio } from './audio/retained';
import {
  setupAssessmentAudio,
  checkAssessmentAudioAdapter,
  createAssessmentAudioFailureFixtures,
} from './audio/setup';
import { checkAssessmentAudioWait } from './audio/wait';
import { checkAssessmentAudioYield } from './audio/yield';

interface AssessmentAudioContext {
  instance: SharedTestInstance;
  identity: SharedTestIdentity;
  classId: string;
  questionId: string;
  audioQueue: typeof import('@/lib/queue') | undefined;
  queuedAudio: string[];
  boundary: { execution: SottoProviderExecution | null };
  provider: { generate: Mock };
}

export function registerAssessmentAudioCases(getContext: () => AssessmentAudioContext) {
  it.each([
    'worker_wait',
    'worker',
    'observer',
    'reconciler',
    'unresolved',
    'expired_child',
    'yield',
    'yield_failure',
    'yield_missing',
    'yield_lost',
    'yield_cancel',
    'yield_stale',
    'review_oversize',
  ] as const)(
    'stages private listening and speaking drafts with an attached audio reservation (%s completion)',
    async (completionMode) => {
      const {
        instance,
        identity,
        classId,
        questionId,
        audioQueue,
        queuedAudio,
        boundary,
        provider,
      } = getContext();
      function observationTransaction<Result>(
        context: { capability: SottoJobExecutionCapability; operation: SottoJobExecutionOperation },
        identity: Parameters<typeof runAssessmentAudioObservationTransaction>[0]['identity'],
        run: (tx: Prisma.TransactionClient) => Promise<Result>
      ) {
        return runAssessmentAudioObservationTransaction(
          { database: instance.database, identity, ...context },
          run
        );
      }

      const { failQueuedAudio, captureFailedAudio } = createAssessmentAudioFailureFixtures(
        instance,
        audioQueue
      );

      await instance.configureInfrastructure({
        ttsProvider: 'local',
        sttProvider: 'local',
        ttsBaseUrl: 'http://127.0.0.1:34991',
        sttBaseUrl: 'http://127.0.0.1:34992',
        ttsVoices: 'fixture-voice',
      });
      const { cls, requirements, execution, selection, record } = await setupAssessmentAudio({
        instance,
        identity,
        classId,
        completionMode,
      });
      const operation = { id: record.job.id, fingerprint: record.fingerprint };
      if (completionMode === 'worker_wait') {
        await checkAssessmentAudioWait({
          instance,
          audioQueue,
          boundary,
          provider,
          operation,
          record,
        });
        return;
      }
      await sottoTransaction(instance.database, (tx) =>
        startAssessmentWork(tx, operation, execution)
      );
      const { createAIProvider: actualProvider } =
        await vi.importActual<typeof import('@/lib/providers/ai')>('@/lib/providers/ai');
      const captured = await sottoTransaction(instance.database, (tx) =>
        requirePendingAssessmentWork(tx, operation, execution, 'RUNNING')
      );
      const speakingDraft = {
        skill: 'SPEAKING',
        items: Array.from({ length: 4 }, (_, index) => ({
          task: `Speak ${index}`,
          mode: 'COMMUNICATIVE',
          translation: 'Translation',
          rubric: 'Criteria',
          guidance: 'Guidance',
          ...(completionMode === 'worker'
            ? {
                criteria: [
                  { id: 'meaning', description: 'Conveys meaning', modality: 'TRANSCRIPT' },
                ],
              }
            : {}),
        })),
      };
      if (completionMode === 'worker') {
        const legacyDraft = {
          ...speakingDraft,
          items: speakingDraft.items.map(({ task, mode, translation, rubric, guidance }) => ({
            task,
            mode,
            translation,
            rubric,
            guidance,
          })),
        };
        await expect(
          sottoTransaction(instance.database, (tx) =>
            stageAssessmentSection(tx, operation, execution, legacyDraft)
          )
        ).rejects.toThrow(/already active/);
      }
      await checkAssessmentAudioAdapter({
        instance,
        operation,
        execution,
        selection,
        captured,
        speakingDraft,
        completionMode,
        actualProvider,
      });
      const grammarDraft = {
        skill: 'GRAMMAR',
        items: Array.from({ length: 5 }, (_, index) => ({
          question: `Independent grammar ${index}`,
          options: ['a', 'b', 'c', 'd'],
          correctIndex: 1,
          explanation: 'Reason',
        })),
      };
      let modelDispatches = 0;
      provider.generate.mockImplementation(async () => {
        const request = boundary.execution?.providerRequest;
        if (!request) throw new Error('Missing journaled provider request');
        const response = await request(
          new Request('https://provider.example.test/author', {
            method: 'POST',
            body: 'stable request',
          }),
          async () => {
            modelDispatches += 1;
            return Response.json({
              choices: [
                { message: { content: JSON.stringify(grammarDraft) }, finish_reason: 'stop' },
              ],
            });
          }
        );
        const data = (await response.json()) as {
          choices: Array<{ message: { content: string } }>;
        };
        return {
          content: data.choices[0]!.message.content,
          model: 'fixture',
          inputTokens: 1,
          outputTokens: 1,
        };
      });
      const generationInput = {
        identity: operation,
        execution,
        skill: 'GRAMMAR' as const,
        unresolved: () => {
          throw new Error('Unexpected unresolved call');
        },
      };
      const classScope = record.job.scopes.find((scope) => scope.subjectId === `class:${classId}`);
      if (!classScope) throw new Error('Assessment class execution scope missing');
      expect(() =>
        prepareOrGenerateAssessmentAuthorProof({ ...generationInput, capability: {} })
      ).toThrow();
      expect(modelDispatches).toBe(0);
      const resumeAuthor = () =>
        withSottoJobExecution({
          database: instance.database,
          parentId: operation.id,
          fingerprint: operation.fingerprint,
          signal: new AbortController().signal,
          capabilityScope: classScope,
          isCleanupFailure: () => false,
          validate: async () => true,
          run: async ({ capability }) => {
            if (!capability) throw new Error('Assessment execution capability missing');
            return prepareOrGenerateAssessmentAuthorProof({ ...generationInput, capability });
          },
        });
      const initialProof = await resumeAuthor();
      if (!initialProof) throw new Error('Assessment author proof missing');
      const generated = { sectionId: initialProof.sectionId };
      expect(await resumeAuthor()).toMatchObject({ skill: 'GRAMMAR', ...generated });
      expect(modelDispatches).toBe(1);
      const authorProof = await prepareAssessmentAuthorProof(generationInput);
      await expect(
        instance.database.$transaction((tx) => verifyAssessmentAuthorProof(tx, authorProof))
      ).rejects.toThrow('Assessment author proof requires a Serializable transaction');
      expect(
        await sottoTransaction(instance.database, (tx) =>
          verifyAssessmentAuthorProof(tx, authorProof)
        )
      ).toEqual({ skill: 'GRAMMAR', sectionId: generated.sectionId });
      await expect(
        sottoTransaction(instance.database, (tx) =>
          verifyAssessmentAuthorProof(tx, { ...authorProof })
        )
      ).rejects.toThrow();
      const stagedSection = await instance.database.classAssessmentSection.findUniqueOrThrow({
        where: { id: generated.sectionId },
      });
      const savedCalls = await instance.database.classAssessmentProviderCall.findMany({
        where: { assessmentId: stagedSection.assessmentId, stage: 'AUTHOR_GRAMMAR' },
      });
      if (!savedCalls[0]) throw new Error('Authoring call missing');
      const extraCall = await instance.database.classAssessmentProviderCall.create({
        data: {
          assessmentId: stagedSection.assessmentId,
          stage: 'AUTHOR_GRAMMAR',
          ordinal: savedCalls.length,
          role: 'MODEL',
          inputDigest: savedCalls[0].inputDigest,
        },
      });
      await expect(resumeAuthor()).rejects.toThrow();
      expect(modelDispatches).toBe(1);
      await expect(
        sottoTransaction(instance.database, (tx) => verifyAssessmentAuthorProof(tx, authorProof))
      ).rejects.toThrow();
      await instance.database.classAssessmentProviderCall.delete({ where: { id: extraCall.id } });
      const authoredQuestion = await instance.database.classAssessmentQuestion.findFirstOrThrow({
        where: { sectionId: generated.sectionId },
      });
      await instance.database.classAssessmentQuestion.update({
        where: { id: authoredQuestion.id },
        data: { explanation: 'Changed after authoring' },
      });
      await expect(
        sottoTransaction(instance.database, (tx) => verifyAssessmentAuthorProof(tx, authorProof))
      ).rejects.toThrow();
      await instance.database.classAssessmentQuestion.update({
        where: { id: authoredQuestion.id },
        data: { explanation: authoredQuestion.explanation },
      });
      expect(
        await sottoTransaction(instance.database, (tx) =>
          verifyAssessmentAuthorProof(tx, authorProof)
        )
      ).toEqual({ skill: 'GRAMMAR', sectionId: generated.sectionId });
      expect(modelDispatches).toBe(1);
      expect(
        await instance.database.classAssessmentQuestion.count({
          where: { sectionId: generated.sectionId },
        })
      ).toBe(5);
      const truncated = { skill: 'READING', passage: 'Текст', items: grammarDraft.items };
      const finalizedReading = {
        skill: 'READING',
        passage: 'Новый короткий текст.',
        items: Array.from({ length: 5 }, (_, index) => ({
          question: `Independent reading ${index}`,
          options: ['a', 'b', 'c', 'd'],
          correctIndex: 1,
          explanation: 'Reason',
        })),
      };
      provider.generate.mockImplementation(async () => {
        const request = boundary.execution?.providerRequest;
        if (!request) throw new Error('Missing journaled provider request');
        const response = await request(
          new Request('https://provider.example.test/truncated', {
            method: 'POST',
            body: 'stable request',
          }),
          async () =>
            Response.json({
              choices: [
                { message: { content: JSON.stringify(truncated) }, finish_reason: 'length' },
              ],
            })
        );
        const data = (await response.json()) as {
          choices: Array<{ message: { content: string } }>;
        };
        return {
          content: data.choices[0]!.message.content,
          model: 'fixture',
          inputTokens: 1,
          outputTokens: 1,
        };
      });
      await expect(
        generateAssessmentSection({ ...generationInput, skill: 'READING' })
      ).rejects.toThrow(/already active/);
      const assessment = assessmentWorkSchema.parse(record.job.payload).fence.assessmentId;
      const readingSection = await instance.database.classAssessmentSection.findUniqueOrThrow({
        where: { assessmentId_skill: { assessmentId: assessment, skill: 'READING' } },
      });
      expect(readingSection.authoredDraft).toBeNull();
      const listeningDraft = {
        skill: 'LISTENING',
        turns: [{ speaker: 'HOST', text: 'Добрый день' }],
        items: Array.from({ length: 4 }, (_, index) => ({
          question: `Held-out listening ${index}`,
          options: ['a', 'b', 'c', 'd'],
          correctIndex: 1,
          explanation: 'Reason',
        })),
      };
      const listeningResult = await sottoTransaction(instance.database, (tx) =>
        stageAssessmentSection(tx, operation, execution, listeningDraft)
      );
      expect(
        await sottoTransaction(instance.database, (tx) =>
          stageAssessmentSection(tx, operation, execution, listeningDraft)
        )
      ).toEqual(listeningResult);
      const heldOut = await instance.database.classAssessmentSection.findUniqueOrThrow({
        where: { id: listeningResult.sectionId },
        include: { episode: { include: { script: true } } },
      });
      expect(heldOut.episode).toMatchObject({
        status: 'SCRIPT_READY',
        assessmentAudioOperationId: operation.id,
        script: { turns: listeningDraft.turns },
      });
      if (!heldOut.episodeId) throw new Error('Held-out episode missing');
      const { durableQueueOperationId } = await import('@/lib/sidedoor/jobs/core/durable-queue');
      const generationKey = audioQueue
        ? durableQueueOperationId('assessment-audio', `${operation.id}:${heldOut.episodeId}`)
        : randomUUID();
      const speechFingerprint = await sottoTransaction(instance.database, (tx) =>
        learningSpeechFingerprint(tx, execution.authorize, requirements)
      );
      const audioInput = {
        identity: operation,
        execution,
        episodeId: heldOut.episodeId,
        generationKey,
        speechFingerprint,
      };
      let audioSegment;
      let boundAudioJob:
        import('bullmq').Job<import('@/lib/queue').GenerateAudioPayload> | undefined;
      let runBoundAudio:
        ((signal?: AbortSignal, onCleanup?: () => void) => Promise<void>) | undefined;
      let audioWorkspace: string | undefined;
      let startAudioExecution:
        | (() => Promise<{
            operation: SottoJobExecutionOperation;
            capability: SottoJobExecutionCapability;
            finish: () => Promise<void>;
          }>)
        | undefined;
      let speechObservation: Awaited<ReturnType<typeof beginAssessmentAudioAttempt>> | undefined;
      let speechAttempt:
        | { episodeId: string; segmentId: string; generationKey: string; operationId: string }
        | undefined;
      if (audioQueue) {
        if (
          await checkAssessmentAudioQueue({
            instance,
            audioQueue,
            operation,
            execution,
            completionMode,
            truncated,
            finalizedReading,
            speakingDraft,
            heldOut,
            authoredQuestion,
            assessment,
            queuedAudio,
            generationKey,
            durableQueueOperationId,
          })
        )
          return;
        const segments = await instance.database.segment.findMany({
          where: { episodeId: heldOut.episodeId },
        });
        expect(segments).toHaveLength(1);
        audioSegment = segments[0]!;
        speechAttempt = {
          episodeId: heldOut.episodeId,
          segmentId: audioSegment.id,
          generationKey,
          operationId: durableQueueOperationId(
            audioQueue.audioGenerationQueue.name,
            `audio-${heldOut.episodeId}-${audioSegment.id}-v${audioSegment.version}-${generationKey}`
          ),
        };
        const audioRecord = await sottoTransaction(instance.database, (tx) =>
          sottoJobOutbox(tx).read(speechAttempt!.operationId)
        );
        if (!audioRecord) throw new Error('Assessment audio child missing');
        const {
          bindDurableQueueJob,
          bindDurableQueueExecution,
          bindDurableQueueCleanup,
          durableQueueExecution,
          durableJobProviderExecution,
          durableEnvelopeSchema,
          durableQueueJobIdentity,
        } = await import('@/lib/sidedoor/jobs/core/durable-queue');
        const envelope = durableEnvelopeSchema.parse(audioRecord.job.payload);
        const unbound = {
          id: 'untrusted-redis-id',
          data: envelope.payload,
          updateProgress: async () => {},
        } as unknown as import('bullmq').Job<import('@/lib/queue').GenerateAudioPayload>;
        expect(() => durableQueueJobIdentity(unbound)).toThrow();
        const bound = bindDurableQueueJob(unbound, unbound.data, {
          operationId: audioRecord.job.id,
          fingerprint: audioRecord.fingerprint,
          payload: envelope,
        });
        boundAudioJob = bound;
        expect(durableQueueJobIdentity(bound)).toEqual({
          operationId: speechAttempt.operationId,
          fingerprint: audioRecord.fingerprint,
        });
        const attemptStatus = (fingerprint = audioRecord.fingerprint) =>
          sottoTransaction(instance.database, (tx) =>
            readAssessmentAudioAttemptStatus(tx, { ...speechAttempt!, fingerprint })
          );
        expect(await attemptStatus()).toBe('ABSENT');
        await expect(attemptStatus('0'.repeat(64))).rejects.toThrow();
        const { processAudioGeneration } = await import('@/workers/audio-generation.worker');
        const audioScope = audioRecord.job.scopes.find(
          (scope) => scope.subjectId === `episode:${speechAttempt!.episodeId}`
        );
        if (!audioScope) throw new Error('Assessment audio execution scope missing');
        const recoverStoppedTestExecution = async (parentId: string) => {
          const inventory = await sottoTransaction(instance.database, (tx) =>
            sottoJobExecutions(tx).listUnresolved(audioScope)
          );
          const retained = inventory.executions.find((item) => item.parentId === parentId);
          if (!retained?.workspace || !('directory' in retained.workspace))
            throw new Error('Uncertain audio execution workspace missing');
          expect(retained.status).toBe('cleanup-unconfirmed');
          const binding = {
            id: retained.id,
            parentId: retained.parentId,
            fingerprint: retained.fingerprint,
            executorId: retained.executorId,
          };
          await removeExecutionWorkspace(retained.workspace, retained.workspace.locationId);
          await sottoTransaction(instance.database, async (tx) => {
            await sottoJobExecutions(tx).releaseWorkspace(binding, retained.workspace!);
            await sottoJobExecutions(tx).settle(binding);
          });
        };
        startAudioExecution = async () => {
          let release!: () => void;
          let ready!: (value: {
            operation: SottoJobExecutionOperation;
            capability: SottoJobExecutionCapability;
          }) => void;
          const stop = new Promise<void>((resolve) => {
            release = resolve;
          });
          const started = new Promise<{
            operation: SottoJobExecutionOperation;
            capability: SottoJobExecutionCapability;
          }>((resolve) => {
            ready = resolve;
          });
          const expected = { parentId: audioRecord.job.id, fingerprint: audioRecord.fingerprint };
          const execution = withSottoJobExecution({
            database: instance.database,
            parentId: expected.parentId,
            fingerprint: expected.fingerprint,
            signal: new AbortController().signal,
            capabilityScope: audioScope,
            isCleanupFailure: () => false,
            validate: async (tx) => {
              const current = await sottoJobOutbox(tx).read(expected.parentId);
              return Boolean(current && !current.complete);
            },
            run: async ({ capability }) => {
              if (!capability) throw new Error('Assessment audio execution capability missing');
              await runSottoExecutionOperation(capability, expected, async (operation) => {
                ready({ operation, capability });
                await stop;
              });
            },
          });
          const result = execution.then(
            () => null,
            (error: unknown) => error
          );
          const capturedExecution = await Promise.race([
            started,
            result.then((error) => {
              throw error ?? new Error('Audio execution ended before starting');
            }),
          ]);
          return {
            ...capturedExecution,
            finish: async () => {
              release();
              const error = await result;
              if (error) throw error;
            },
          };
        };
        runBoundAudio = async (signal = new AbortController().signal, onCleanup) => {
          await withSottoJobExecution({
            database: instance.database,
            parentId: audioRecord.job.id,
            fingerprint: audioRecord.fingerprint,
            signal,
            capabilityScope: audioScope,
            isCleanupFailure: () => false,
            validate: async (tx) => {
              const current = await sottoJobOutbox(tx).read(audioRecord.job.id);
              return Boolean(current && !current.complete);
            },
            run: async ({ capability, markCleanupUnconfirmed, directory }) => {
              if (!capability) throw new Error('Assessment audio execution capability missing');
              audioWorkspace = directory;
              const job = bindDurableQueueJob(unbound, unbound.data, {
                operationId: audioRecord.job.id,
                fingerprint: audioRecord.fingerprint,
                payload: envelope,
              });
              bindDurableQueueExecution(job, capability, directory);
              bindDurableQueueCleanup(job, () => {
                markCleanupUnconfirmed();
                onCleanup?.();
              });
              await processAudioGeneration(job, signal);
            },
          });
        };
        if (
          completionMode === 'yield' ||
          completionMode === 'yield_failure' ||
          completionMode === 'yield_missing' ||
          completionMode === 'yield_lost' ||
          completionMode === 'yield_cancel' ||
          completionMode === 'yield_stale'
        ) {
          await checkAssessmentAudioYield({
            instance,
            operation,
            execution,
            truncated,
            speakingDraft,
            classScope,
            provider,
            completionMode,
            record,
            assessment,
          });
          return;
        }
        if (completionMode === 'unresolved' || completionMode === 'expired_child') {
          await checkAssessmentAudioUnresolved({
            instance,
            audioQueue,
            audioRecord,
            operation,
            record,
            completionMode,
            assessment,
            startAudioExecution,
            failQueuedAudio,
            runBoundAudio,
          });
          return;
        }
        await checkAssessmentAudioFailure({
          instance,
          audioQueue,
          audioRecord,
          speechAttempt,
          attemptStatus,
          durableQueueExecution,
          durableQueueJobIdentity,
          durableJobProviderExecution,
          identity,
          queuedAudio,
          audioScope,
          processAudioGeneration,
          unbound,
          getAudioWorkspace: () => audioWorkspace,
          runBoundAudio,
          recoverStoppedTestExecution,
        });
        const { claimAssessmentAudioObservation, releaseAssessmentAudioObservation } =
          await import('@/lib/learning/classes/audio/assessment-audio-claim');
        const claimInput = {
          classId,
          classGeneration: cls.createdAt.getTime(),
          assessmentId: assessment,
          operationId: speechAttempt.operationId,
          fingerprint: audioRecord.fingerprint,
        };
        await checkAssessmentAudioClaims({
          instance,
          audioQueue,
          assessment,
          speechAttempt,
          bound,
          processAudioGeneration,
          claimInput,
          claimAssessmentAudioObservation,
          releaseAssessmentAudioObservation,
          startAudioExecution,
          observationTransaction,
          captureFailedAudio,
          attemptStatus,
        });
        await checkAssessmentAudioContention({
          instance,
          audioQueue,
          assessment,
          speechAttempt,
          bound,
          processAudioGeneration,
          claimInput,
          claimAssessmentAudioObservation,
          releaseAssessmentAudioObservation,
          startAudioExecution,
          observationTransaction,
          captureFailedAudio,
          attemptStatus,
          classId,
          audioRecord,
        });
        speechObservation = await checkAssessmentAudioAdmission({
          instance,
          audioQueue,
          assessment,
          speechAttempt,
          bound,
          processAudioGeneration,
          claimInput,
          claimAssessmentAudioObservation,
          releaseAssessmentAudioObservation,
          startAudioExecution,
          observationTransaction,
          captureFailedAudio,
          attemptStatus,
          classId,
          cls,
          identity,
          heldOut,
          audioSegment,
          audioRecord,
        });
      } else {
        await instance.database.episode.update({
          where: { id: heldOut.episodeId },
          data: {
            status: 'GENERATING_AUDIO',
            audioGenerationKey: generationKey,
            ttsProvider: 'local',
            ttsModel: 'fixture-model',
          },
        });
        await instance.database.episodeVoice.create({
          data: {
            episodeId: heldOut.episodeId,
            speaker: 'HOST',
            provider: 'local',
            voiceId: 'fixture-voice',
          },
        });
        await sottoTransaction(instance.database, (tx) =>
          registerAssessmentAudioLineage(tx, audioInput)
        );
        await sottoTransaction(instance.database, (tx) =>
          registerAssessmentAudioLineage(tx, audioInput)
        );
        audioSegment = await instance.database.segment.create({
          data: {
            episodeId: audioInput.episodeId,
            order: 0,
            speaker: 'HOST',
            text: 'Добрый день',
          },
        });
      }
      await sottoTransaction(instance.database, (tx) =>
        validatePreparationAudio(tx, audioInput.episodeId, generationKey)
      );
      await expect(
        instance.database.script.update({
          where: { episodeId: audioInput.episodeId },
          data: {
            soundCues: [
              {
                type: 'effect',
                prompt: 'Unreviewed sound',
                durationSeconds: 1,
                insertAfterTurn: 0,
              },
            ],
          },
        })
      ).rejects.toThrow(/Assessment script is frozen/);
      await sottoTransaction(instance.database, (tx) =>
        validatePreparationAudio(tx, audioInput.episodeId, generationKey)
      );
      await expect(
        sottoTransaction(instance.database, (tx) =>
          validatePreparationAudio(tx, audioInput.episodeId, 'wrong-key')
        )
      ).rejects.toThrow();
      await instance.database.segment.update({
        where: { id: audioSegment.id },
        data: { ttsProvider: 'local' },
      });
      await expect(
        sottoTransaction(instance.database, (tx) =>
          validatePreparationAudio(tx, audioInput.episodeId, generationKey)
        )
      ).rejects.toThrow();
      await instance.database.segment.update({
        where: { id: audioSegment.id },
        data: { ttsProvider: null },
      });
      await instance.database.episodeVoice.update({
        where: { episodeId_speaker: { episodeId: audioInput.episodeId, speaker: 'HOST' } },
        data: { voiceId: 'changed-voice' },
      });
      await expect(
        sottoTransaction(instance.database, (tx) =>
          validatePreparationAudio(tx, audioInput.episodeId, generationKey)
        )
      ).rejects.toThrow();
      await instance.database.episodeVoice.update({
        where: { episodeId_speaker: { episodeId: audioInput.episodeId, speaker: 'HOST' } },
        data: { voiceId: 'fixture-voice' },
      });
      let releaseVerifier!: () => void;
      let verifierReady!: () => void;
      const verifierGate = new Promise<void>((resolve) => {
        releaseVerifier = resolve;
      });
      const verifierStarted = new Promise<void>((resolve) => {
        verifierReady = resolve;
      });
      const verifier = instance.database.$transaction(
        async (tx) => {
          await validatePreparationAudio(tx, audioInput.episodeId, generationKey);
          verifierReady();
          await verifierGate;
          await validatePreparationAudio(tx, audioInput.episodeId, generationKey);
        },
        { isolationLevel: 'Serializable', timeout: 15000 }
      );
      await verifierStarted;
      const writer = instance.database.episodeVoice
        .update({
          where: { episodeId_speaker: { episodeId: audioInput.episodeId, speaker: 'HOST' } },
          data: { voiceId: 'waiting-voice' },
        })
        .then(() => 'written');
      try {
        expect(
          await Promise.race([
            writer,
            new Promise((resolve) => setTimeout(() => resolve('waiting'), 50)),
          ])
        ).toBe('waiting');
      } finally {
        releaseVerifier();
      }
      await verifier;
      expect(await writer).toBe('written');
      await instance.database.episodeVoice.update({
        where: { episodeId_speaker: { episodeId: audioInput.episodeId, speaker: 'HOST' } },
        data: { voiceId: 'fixture-voice' },
      });
      let releaseSnapshot!: () => void;
      let snapshotReady!: () => void;
      const snapshotGate = new Promise<void>((resolve) => {
        releaseSnapshot = resolve;
      });
      const snapshotStarted = new Promise<void>((resolve) => {
        snapshotReady = resolve;
      });
      const stale = instance.database
        .$transaction(
          async (tx) => {
            await tx.user.findUniqueOrThrow({ where: { id: identity.ownerId } });
            snapshotReady();
            await snapshotGate;
            await validatePreparationAudio(tx, audioInput.episodeId, generationKey);
          },
          { isolationLevel: 'Serializable' }
        )
        .then(
          () => null,
          (error: unknown) => error
        );
      await snapshotStarted;
      try {
        await instance.database.episodeVoice.update({
          where: { episodeId_speaker: { episodeId: audioInput.episodeId, speaker: 'HOST' } },
          data: { voiceId: 'concurrent-voice' },
        });
      } finally {
        releaseSnapshot();
      }
      expect(isSerializationConflict(await stale)).toBe(true);
      await instance.database.episodeVoice.update({
        where: { episodeId_speaker: { episodeId: audioInput.episodeId, speaker: 'HOST' } },
        data: { voiceId: 'fixture-voice' },
      });
      await expect(
        instance.database.script.update({
          where: { episodeId: audioInput.episodeId },
          data: { turns: [{ speaker: 'HOST', text: 'Changed' }] },
        })
      ).rejects.toThrow(/frozen by admitted audio/);
      await expect(
        instance.database.lessonQuestion.update({
          where: { id: questionId },
          data: { explanation: 'Changed after admission' },
        })
      ).rejects.toThrow(/Class teaching is frozen/);
      await sottoTransaction(instance.database, (tx) =>
        validatePreparationAudio(tx, audioInput.episodeId, generationKey)
      );
      const { readAssessmentAudioSettlementLineage } =
        await import('@/lib/learning/classes/audio/assessment-audio-lineage');
      expect(
        await sottoTransaction(instance.database, (tx) =>
          readAssessmentAudioSettlementLineage(tx, audioInput.episodeId, generationKey)
        )
      ).toMatchObject({
        lineage: { assessmentId: assessment, identity: operation },
        current: { status: 'RUNNING' },
      });
      await expect(
        sottoTransaction(instance.database, (tx) =>
          readAssessmentAudioSettlementLineage(tx, audioInput.episodeId, 'wrong-generation')
        )
      ).rejects.toThrow();
      if (speechAttempt) {
        await checkRetainedAssessmentAudio({
          speechAttempt,
          instance,
          audioInput,
          classId,
          cls,
          identity,
          assessment,
          operation,
          startAudioExecution,
          observationTransaction,
          captureFailedAudio,
        });
      }
      await checkAssessmentAudioIdentity({
        instance,
        identity,
        classId,
        questionId,
        audioQueue,
        boundary,
        provider,
        operation,
        execution,
        captured,
        assessment,
        cls,
        heldOut,
        audioSegment,
        generationKey,
        listeningResult,
        finalizedReading,
        speakingDraft,
        completionMode,
        speechObservation,
        speechAttempt,
        boundAudioJob,
        runBoundAudio,
        startAudioExecution,
        observationTransaction,
        captureFailedAudio,
        failQueuedAudio,
        durableQueueOperationId,
        audioInput,
      });
      await instance.configureInfrastructure({
        ttsProvider: 'local',
        sttProvider: 'local',
        ttsBaseUrl: 'http://127.0.0.1:34991',
        sttBaseUrl: 'http://127.0.0.1:34992',
        ttsVoices: 'changed-config',
      });
      await expect(
        sottoTransaction(instance.database, (tx) =>
          validatePreparationAudio(tx, audioInput.episodeId, generationKey)
        )
      ).rejects.toThrow();
      const speakingResult = await sottoTransaction(instance.database, (tx) =>
        stageAssessmentSection(tx, operation, execution, speakingDraft)
      );
      expect(
        await sottoTransaction(instance.database, (tx) =>
          stageAssessmentSection(tx, operation, execution, speakingDraft)
        )
      ).toEqual(speakingResult);
      const prompt = await instance.database.speakingPrompt.findFirstOrThrow({
        where: { assessmentSectionId: speakingResult.sectionId, order: 0 },
      });
      expect(prompt).toMatchObject({
        assessmentTaskMode: 'COMMUNICATIVE',
        assessmentRubric: 'Criteria',
        assessmentGuidance: 'Guidance',
        referenceTtsUrl: null,
        assessmentCriteria:
          completionMode === 'worker'
            ? [{ id: 'meaning', description: 'Conveys meaning', modality: 'TRANSCRIPT' }]
            : null,
      });
    },
    120000
  );
}
