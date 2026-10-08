import { randomUUID } from 'node:crypto';
import type { Job } from 'bullmq';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  StorageWriteJournal,
  prepareStorageTombstone,
  StorageCleanupJournal,
  StorageBackendRegistry,
  prepareStorageBackend,
  prepareStorageCleanup,
  storageBackendBinding,
} from 'thesidedoor-core/storage';
import { JobRetentionCleanup, prepareJob } from 'thesidedoor-core/runtime/outbox';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoJobOutbox, sottoJobSnapshot } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  classPreparationStore,
  requestClassPreparation,
  readClassPreparation,
  readPreparationActivity,
  recordClassPreparationFailure,
  recoverClassPreparation,
  settleCancelledPreparation,
} from '@/lib/classes/preparation';
import { registerPreparationAudio } from '@/lib/classes/preparation-audio';
import { readPristineRegenerationSnapshot } from '@/lib/classes/regeneration/pristine';
import { captureEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { preparationSchema, type ClassPreparation } from '@/lib/classes/preparation-state';
import { processClassPreparation } from '@/workers/classes/class-preparation.worker';
import {
  readLearningFailure,
  writeLearningFailure,
  learningFailureReason,
  type LearningFailure,
} from '@/lib/classes/quality/teaching-failure-store';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import {
  captureSottoCredentialOwner,
  sottoCredentialStorage,
} from '@/lib/sidedoor/credentials/runtime/provider-credentials';
import { preparationProviderRequest } from '@/lib/classes/preparation-provider';
import { resolveCapturedLearningAi } from '@/lib/learning-ai';
import { createAIProvider } from '@/lib/providers/ai';
import { reviewTeachingContent } from '@/lib/classes/quality/teaching-quality';
import { captureGenerationFailure } from '@/lib/classes/quality/generation-failure';
import type { SharedTestInstance } from '../../../helpers/setup/shared-instance';

interface PreparationFailureContext {
  instance: SharedTestInstance;
  courseId: string;
  execution: SottoProviderExecution;
  running: (maxProviderRequests?: number) => Promise<ClassPreparation>;
  lesson: () => Promise<{ id: string }>;
}

/** Register evidence cases using the owning suite's real database and admission fixture. */
export function registerPreparationFailureTests(context: () => PreparationFailureContext) {
  let instance: SharedTestInstance;
  let courseId: string;
  let execution: SottoProviderExecution;
  const running = (maxProviderRequests?: number) => context().running(maxProviderRequests);
  const lesson = () => context().lesson();
  beforeEach(() => {
    ({ instance, courseId, execution } = context());
  });
  const privateFailure: LearningFailure = {
    category: 'teaching_rejected',
    teachingFailure: {
      kind: 'intro',
      reviews: [
        {
          candidate: '[{"purpose":"private-candidate-sentinel"}]',
          verdict: {
            items: [
              {
                index: 0,
                acceptable: false,
                issues: ['incorrect'],
                feedback: ['private-feedback-sentinel'],
              },
            ],
          },
        },
      ],
    },
  };

  async function failureFixture(maxProviderRequests?: number) {
    const operation = await running(maxProviderRequests);
    const lessonRecord = await lesson();
    const cls = await instance.database.courseClass.create({
      data: {
        courseId,
        lessonId: lessonRecord.id,
        status: 'GENERATING',
        order: (await instance.database.courseClass.count({ where: { courseId } })) + 1,
      },
    });
    const current = await sottoTransaction(instance.database, (database) =>
      classPreparationStore(database, courseId).transact((state) => {
        if (!state) throw new Error('Missing preparation fixture');
        state.classId = cls.id;
        return state;
      })
    );
    const parent = await sottoTransaction(instance.database, (database) =>
      sottoJobOutbox(database).read(operation.id)
    );
    if (!parent) throw new Error('Missing fixture outbox');
    return { operation: current, parent };
  }

  it.each([1, 2])(
    'keeps protocol correction within the admitted parent cap of %i and preserves known failure evidence',
    async (cap) => {
      await sottoTransaction(instance.database, async (database) => {
        const storage = await sottoCredentialStorage(database, 'ai', 'openai');
        const owner = await captureSottoCredentialOwner(database, execution.userId);
        const target = { ...storage.slot, owner };
        const head = await storage.owned.head(target);
        await storage.owned.remove(target, head.revision, randomUUID());
      });
      const endpoint = 'http://localhost:8000/v1';
      await instance.configureInfrastructure({
        aiProvider: 'local',
        aiModel: 'protocol-fixture',
        aiBaseUrl: endpoint,
      });
      await instance.seedAiCredential(execution.userId, 'local', 'protocol-fixture-secret');
      await instance.database.user.update({
        where: { id: execution.userId },
        data: { preferredAiProvider: 'local', preferredAiModel: 'local:protocol-fixture' },
      });
      const { operation, parent } = await failureFixture(cap);
      const retained = await instance.database.classSection.create({
        data: {
          classId: operation.classId!,
          skill: 'READING',
          status: 'READY',
          attempt: 1,
          seed: randomUUID(),
          spec: { passage: 'Retained learner material' },
        },
      });
      const vocabulary = await instance.database.learnerVocab.create({
        data: { courseId, lemma: 'Reise', translation: 'journey', mastery: 0.75, reps: 3 },
      });
      const sent: Record<string, unknown>[] = [];
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        expect(request.url).toBe(endpoint + '/chat/completions');
        expect(request.headers.get('authorization')).toBe('Bearer protocol-fixture-secret');
        sent.push(await request.json());
        return Response.json({
          id: 'protocol-response',
          object: 'chat.completion',
          created: 1,
          model: 'protocol-fixture',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content:
                  sent.length === 1
                    ? '{}'
                    : JSON.stringify({ items: [{ index: 0, findings: [] }] }),
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        });
      });
      const ai = await resolveCapturedLearningAi(execution.userId, {
        ...execution,
        learningSelection: operation.selection,
        providerRequest: preparationProviderRequest(operation, new AbortController().signal, () => {
          throw new Error('Unexpected uncertain provider outcome');
        }),
      });
      const items = [{ targetPhrase: 'Ich bin hier.', translation: 'I am here.', ipa: null }];
      let failure: unknown;
      try {
        await reviewTeachingContent({
          ai,
          provider: createAIProvider(ai.provider),
          userId: execution.userId,
          level: 'A2',
          nativeLang: 'en',
          targetLang: 'de',
          kind: 'speaking',
          items,
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({ cause: { code: 'budget' } });
      expect(sent).toHaveLength(cap);
      for (const body of sent)
        expect(body.response_format).toMatchObject({
          json_schema: { name: 'class_teaching_critic' },
        });
      const diagnostic = captureGenerationFailure(failure);
      expect(diagnostic).toMatchObject({
        category: 'generation_failed',
        protocolEvidence: [
          {
            kind: 'speaking',
            role: 'critic',
            offset: 0,
            reason: 'schema',
            pathCodes: ['response'],
            payload: { omitted: null },
          },
        ],
      });
      expect(diagnostic.protocolEvidence).toHaveLength(1);
      const evidence = diagnostic.protocolEvidence![0];
      expect(JSON.parse(evidence.payload.json!)).toEqual({
        candidate: { items: [{ index: 0, content: items[0] }] },
        response: '{}',
      });
      if (cap === 2) {
        const messages = sent[1].messages as { role: string; content: string }[];
        expect(JSON.parse(messages.find(({ role }) => role === 'user')!.content)).toEqual({
          items: [{ index: 0, content: items[0] }],
          priorProtocolOutput: evidence,
        });
      }
      await sottoTransaction(instance.database, (database) =>
        recordClassPreparationFailure(
          database,
          operation,
          parent.fingerprint,
          false,
          'generation_failed',
          diagnostic
        )
      );
      const failed = await classPreparationStore(instance.database, courseId).read();
      expect(failed).toMatchObject({ status: 'FAILED', failure: 'generation_failed' });
      expect(
        await sottoTransaction(instance.database, (database) =>
          readLearningFailure(database, failed!)
        )
      ).toEqual(diagnostic);
      const activity = await readPreparationActivity(courseId, execution);
      expect(activity).toMatchObject({
        status: 'FAILED',
        maxProviderRequests: cap,
        providerRequestsAdmitted: cap,
      });
      expect(activity?.events.filter(({ type }) => type === 'succeeded')).toHaveLength(cap);
      expect(JSON.stringify(activity)).not.toMatch(
        /protocolEvidence|Ich bin hier|protocol-fixture-secret/
      );
      expect(
        await instance.database.classSection.findUniqueOrThrow({
          where: { id: retained.id },
        })
      ).toEqual(retained);
      expect(
        await instance.database.learnerVocab.findUniqueOrThrow({
          where: { id: vocabulary.id },
        })
      ).toEqual(vocabulary);
    }
  );

  it.each(
    (['generation_failed', 'source_unreadable'] as const).flatMap((failure) => [
      ...[false, true].map((activeAudio) => ({ failure, activeAudio, settlement: 'recovery' })),
      ...['progress', 'activity'].map((settlement) => ({ failure, activeAudio: true, settlement })),
    ])
  )(
    'preserves known $failure through $settlement cleanup while fencing active audio ($activeAudio)',
    async ({ failure, activeAudio, settlement }) => {
      const lessonRecord = await lesson();
      const cls = await instance.database.courseClass.create({
        data: { courseId, lessonId: lessonRecord.id, order: 1, status: 'AVAILABLE' },
      });
      const originalProfile = await instance.database.user.findUniqueOrThrow({
        where: { id: execution.userId },
      });
      const retainedVocabulary = await instance.database.learnerVocab.create({
        data: { courseId, lemma: 'Reise', translation: 'journey', mastery: 0.75, reps: 3 },
      });
      const snapshot = await readPristineRegenerationSnapshot(cls.id, execution);
      const operation = await requestClassPreparation(courseId, execution, {
        maxProviderRequests: 2,
        intent: {
          kind: 'REGENERATE',
          classId: cls.id,
          expectedAttempt: 1,
          pristineSnapshot: snapshot,
        },
      });
      await sottoTransaction(instance.database, (database) =>
        classPreparationStore(database, courseId).transact((state) => {
          if (!state) throw new Error('Missing admitted fixture');
          state.status = 'RUNNING';
        })
      );
      const episode = await instance.database.episode.create({
        data: {
          userId: execution.userId,
          title: 'Pending lesson audio',
          topic: 'Travel',
          source: 'CLASS',
          status: 'GENERATING_AUDIO',
          audioGenerationKey: randomUUID(),
        },
      });
      await instance.database.classSection.create({
        data: {
          classId: cls.id,
          skill: 'LISTENING',
          status: 'READY',
          seed: randomUUID(),
          spec: {},
          attempt: operation.intent!.attempt,
          episodeId: episode.id,
        },
      });
      const child = await sottoTransaction(instance.database, async (database) => {
        await registerPreparationAudio(
          database,
          operation,
          episode.id,
          episode.audioGenerationKey!
        );
        const storage = await captureEpisodeStorage(database, episode.id);
        return sottoJobOutbox(database).enqueue(
          prepareJob({
            id: randomUUID(),
            namespace: SIDEDOOR_STATE_ID,
            handler: 'audio-generation',
            version: 1,
            payload: {
              type: 'generate-audio',
              payload: { episodeId: episode.id },
              authority: {
                kind: 'episode',
                episodeId: episode.id,
                ownerUserId: execution.userId,
                userId: execution.userId,
                pipelineGeneration: null,
                preparationAudioGenerationKey: episode.audioGenerationKey!,
                snapshot: storage,
              },
            },
            scopes: storage.scopes,
            delivery: { attempts: 1, priority: 0, availableAt: Date.now() },
          })
        );
      });
      const binding = {
        id: randomUUID(),
        parentId: child.job.id,
        fingerprint: child.fingerprint,
        executorId: randomUUID(),
      };
      await sottoTransaction(instance.database, async (database) => {
        if (activeAudio) await sottoJobExecutions(database).begin(binding);
        const parent = await sottoJobOutbox(database).read(operation.id);
        if (!parent) throw new Error('Missing parent fixture');
        await recordClassPreparationFailure(
          database,
          operation,
          parent.fingerprint,
          false,
          failure,
          failure === 'generation_failed' ? privateFailure : undefined
        );
      });
      const unresolved = await classPreparationStore(instance.database, courseId).read();
      expect(unresolved).toMatchObject({ id: operation.id, status: 'UNRESOLVED', failure });
      if (failure === 'generation_failed')
        expect(
          await sottoTransaction(instance.database, (database) =>
            readLearningFailure(database, unresolved!)
          )
        ).toEqual(privateFailure);
      const retainedSections = await instance.database.classSection.findMany({
        where: { classId: cls.id },
        orderBy: { id: 'asc' },
      });
      const parent = await sottoTransaction(instance.database, (database) =>
        sottoJobOutbox(database).read(operation.id)
      );
      if (!parent) throw new Error('Missing parent fixture');
      const job = {
        id: operation.id,
        name: 'class-preparation.v1',
        data: { operationId: operation.id, fingerprint: parent.fingerprint },
      } as Job<unknown>;
      await sottoTransaction(instance.database, (database) =>
        settleCancelledPreparation(database, unresolved!)
      );
      if (activeAudio) {
        expect((await classPreparationStore(instance.database, courseId).read())?.status).toBe(
          'UNRESOLVED'
        );
        await expect(requestClassPreparation(courseId, execution)).rejects.toThrow();
        await expect(
          recoverClassPreparation(courseId, execution, { acknowledgeUnknownOutcome: true })
        ).rejects.toThrow(/cleanup/);
        expect(
          (await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })).status
        ).toBe('GENERATING');
        if (settlement !== 'recovery') {
          expect((await readClassPreparation(courseId, execution.userId))?.status).toBe(
            'UNRESOLVED'
          );
          expect((await readPreparationActivity(courseId, execution))?.status).toBe('UNRESOLVED');
          expect(await readClassPreparation(courseId, 'another-learner')).toBeNull();
          expect(await classPreparationStore(instance.database, courseId).read()).toEqual(
            unresolved
          );
        }
        await sottoTransaction(instance.database, (database) =>
          sottoJobExecutions(database).settle(binding)
        );
        if (settlement === 'recovery')
          await recoverClassPreparation(courseId, execution, { acknowledgeUnknownOutcome: true });
        else {
          const reconciled =
            settlement === 'progress'
              ? await readClassPreparation(courseId, execution.userId)
              : await readPreparationActivity(courseId, execution);
          expect(reconciled?.status).toBe('FAILED');
        }
      }
      const recovered = await classPreparationStore(instance.database, courseId).read();
      expect(recovered).toMatchObject({ id: operation.id, status: 'FAILED', failure });
      if (settlement !== 'recovery') {
        expect((await readClassPreparation(courseId, execution.userId))?.status).toBe('FAILED');
        const activity = await readPreparationActivity(courseId, execution);
        expect(activity?.status).toBe('FAILED');
        expect(JSON.stringify(activity)).not.toMatch(
          /private-candidate-sentinel|private-feedback-sentinel/
        );
        expect(await classPreparationStore(instance.database, courseId).read()).toEqual(recovered);
      }
      expect(
        (await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })).status
      ).toBe('FAILED');
      expect(
        await sottoTransaction(instance.database, (database) =>
          sottoJobOutbox(database).read(child.job.id)
        )
      ).toMatchObject({ complete: true });
      await processClassPreparation(job);
      expect(await classPreparationStore(instance.database, courseId).read()).toEqual(recovered);
      expect(
        await instance.database.classSection.findMany({
          where: { classId: cls.id },
          orderBy: { id: 'asc' },
        })
      ).toEqual(retainedSections);
      expect(await instance.database.learnerVocab.findMany({ where: { courseId } })).toEqual([
        retainedVocabulary,
      ]);
      expect(
        await instance.database.episode.findUniqueOrThrow({ where: { id: episode.id } })
      ).toEqual(episode);
      const freshSnapshot = await readPristineRegenerationSnapshot(cls.id, execution);
      const next = await requestClassPreparation(courseId, execution, {
        maxProviderRequests: 2,
        intent: {
          kind: 'REGENERATE',
          classId: cls.id,
          expectedAttempt: operation.intent!.attempt,
          pristineSnapshot: freshSnapshot,
        },
      });
      expect(next.id).not.toBe(operation.id);
      expect(next.intent?.attempt).toBe(operation.intent!.attempt + 1);
      expect(
        await instance.database.user.findUniqueOrThrow({ where: { id: execution.userId } })
      ).toEqual(originalProfile);
      if (failure === 'generation_failed')
        expect(
          await sottoTransaction(instance.database, (database) =>
            readLearningFailure(database, recovered!)
          )
        ).toEqual(privateFailure);
    }
  );

  it('keeps interrupted regeneration fenced on both reads after local execution has drained', async () => {
    const target = await lesson();
    const cls = await instance.database.courseClass.create({
      data: { courseId, lessonId: target.id, order: 1, status: 'AVAILABLE' },
    });
    const operation = await requestClassPreparation(courseId, execution, {
      maxProviderRequests: 2,
      intent: { kind: 'REGENERATE', classId: cls.id, expectedAttempt: 1 },
    });
    await sottoTransaction(instance.database, async (database) => {
      await classPreparationStore(database, courseId).transact((current) => {
        if (!current) throw new Error('Missing interrupted fixture');
        current.status = 'RUNNING';
      });
      const parent = await sottoJobOutbox(database).read(operation.id);
      if (!parent) throw new Error('Missing interrupted parent');
      await recordClassPreparationFailure(database, operation, parent.fingerprint, true);
      await sottoJobExecutions(database).requireParentDrained(operation.id, parent.fingerprint);
    });
    const interrupted = await classPreparationStore(instance.database, courseId).read();
    expect(interrupted).toMatchObject({ status: 'UNRESOLVED', failure: 'interrupted' });
    expect((await readClassPreparation(courseId, execution.userId))?.status).toBe('UNRESOLVED');
    expect((await readPreparationActivity(courseId, execution))?.status).toBe('UNRESOLVED');
    expect(await classPreparationStore(instance.database, courseId).read()).toEqual(interrupted);
    expect(
      (await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })).status
    ).toBe('GENERATING');
  });

  it.each([
    { activeAudio: false, unknownOutcome: false },
    { activeAudio: true, unknownOutcome: false },
    { activeAudio: false, unknownOutcome: true },
  ])(
    'settles known worker failures while fencing active audio ($activeAudio) and unknown outcomes ($unknownOutcome)',
    async ({ activeAudio, unknownOutcome }) => {
      const target = await lesson();
      const cls = await instance.database.courseClass.create({
        data: { courseId, lessonId: target.id, order: 1, status: 'AVAILABLE' },
      });
      const operation = await requestClassPreparation(courseId, execution, {
        maxProviderRequests: 2,
        intent: {
          kind: 'REGENERATE',
          classId: cls.id,
          expectedAttempt: 1,
          pristineSnapshot: await readPristineRegenerationSnapshot(cls.id, execution),
        },
      });
      const parent = await sottoTransaction(instance.database, (database) =>
        sottoJobOutbox(database).read(operation.id)
      );
      if (!parent) throw new Error('Missing worker fixture');
      const episode = await instance.database.episode.create({
        data: {
          userId: execution.userId,
          title: 'Retained partial audio',
          topic: 'Travel',
          source: 'CLASS',
          audioGenerationKey: randomUUID(),
        },
      });
      const retained = await instance.database.classSection.create({
        data: {
          classId: cls.id,
          skill: 'READING',
          status: 'READY',
          seed: randomUUID(),
          spec: {},
          attempt: 1,
        },
      });
      let childBinding:
        | {
            id: string;
            parentId: string;
            fingerprint: string;
            executorId: string;
          }
        | undefined;
      vi.stubGlobal('fetch', async () => {
        await sottoTransaction(instance.database, async (database) => {
          await registerPreparationAudio(
            database,
            operation,
            episode.id,
            episode.audioGenerationKey!
          );
          if (activeAudio && !childBinding) {
            const storage = await captureEpisodeStorage(database, episode.id);
            const child = await sottoJobOutbox(database).enqueue(
              prepareJob({
                id: randomUUID(),
                namespace: SIDEDOOR_STATE_ID,
                handler: 'audio-generation',
                version: 1,
                payload: {
                  type: 'generate-audio',
                  payload: { episodeId: episode.id },
                  authority: {
                    kind: 'episode',
                    episodeId: episode.id,
                    ownerUserId: execution.userId,
                    userId: execution.userId,
                    pipelineGeneration: null,
                    preparationAudioGenerationKey: episode.audioGenerationKey!,
                    snapshot: storage,
                  },
                },
                scopes: storage.scopes,
                delivery: { attempts: 1, priority: 0, availableAt: Date.now() },
              })
            );
            childBinding = {
              id: randomUUID(),
              parentId: child.job.id,
              fingerprint: child.fingerprint,
              executorId: randomUUID(),
            };
            await sottoJobExecutions(database).begin(childBinding);
          }
        });
        if (unknownOutcome) throw new Error('Fixture connection lost after provider admission');
        return new Response(JSON.stringify({ error: { message: 'Rejected fixture request' } }), {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        });
      });
      const job = {
        id: operation.id,
        name: 'class-preparation.v1',
        data: { operationId: operation.id, fingerprint: parent.fingerprint },
      } as Job<unknown>;
      if (unknownOutcome) {
        await expect(processClassPreparation(job)).rejects.toThrow();
        expect(await classPreparationStore(instance.database, courseId).read()).toMatchObject({
          id: operation.id,
          status: 'UNRESOLVED',
          failure: 'interrupted',
          audioEpisodeIds: [episode.id],
        });
        expect(
          (await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })).status
        ).toBe('GENERATING');
        const interrupted = await classPreparationStore(instance.database, courseId).read();
        expect((await readClassPreparation(courseId, execution.userId))?.status).toBe('UNRESOLVED');
        expect((await readPreparationActivity(courseId, execution))?.status).toBe('UNRESOLVED');
        expect(await classPreparationStore(instance.database, courseId).read()).toEqual(
          interrupted
        );
        await expect(
          recoverClassPreparation(courseId, execution, { acknowledgeUnknownOutcome: true })
        ).rejects.toThrow(/cleanup/);
        expect(
          await instance.database.classSection.findUniqueOrThrow({ where: { id: retained.id } })
        ).toEqual(retained);
        return;
      }
      await processClassPreparation(job);
      const failed = await classPreparationStore(instance.database, courseId).read();
      expect(failed).toMatchObject({
        id: operation.id,
        status: activeAudio ? 'UNRESOLVED' : 'FAILED',
        failure: 'generation_failed',
        audioEpisodeIds: [episode.id],
      });
      expect(
        (await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })).status
      ).toBe(activeAudio ? 'GENERATING' : 'FAILED');
      if (childBinding) {
        await sottoTransaction(instance.database, (database) =>
          sottoJobExecutions(database).settle(childBinding!)
        );
        expect(
          await recoverClassPreparation(courseId, execution, { acknowledgeUnknownOutcome: true })
        ).toMatchObject({ id: operation.id, status: 'FAILED', failure: 'generation_failed' });
      }
      const settled = await classPreparationStore(instance.database, courseId).read();
      await processClassPreparation(job);
      expect(await classPreparationStore(instance.database, courseId).read()).toEqual(settled);
      expect(
        await instance.database.classSection.findUniqueOrThrow({ where: { id: retained.id } })
      ).toEqual(retained);
      expect(
        await instance.database.episode.findUniqueOrThrow({ where: { id: episode.id } })
      ).toEqual(episode);
    }
  );

  it('commits private review evidence with failure while keeping rollback readers and learner activity compatible', async () => {
    const { operation, parent } = await failureFixture();
    await sottoTransaction(instance.database, (database) =>
      recordClassPreparationFailure(
        database,
        operation,
        parent.fingerprint,
        false,
        'generation_failed',
        privateFailure
      )
    );
    const failed = await classPreparationStore(instance.database, courseId).read();
    expect(preparationSchema.parse(failed)).toMatchObject({
      status: 'FAILED',
      failure: 'generation_failed',
    });
    expect(
      await sottoTransaction(instance.database, (database) =>
        readLearningFailure(database, failed!)
      )
    ).toEqual(privateFailure);
    const activity = await readPreparationActivity(courseId, execution);
    expect(activity).toMatchObject({
      status: 'FAILED',
      failureReason: learningFailureReason(privateFailure),
      maxProviderRequests: 2,
      providerRequestsAdmitted: 0,
    });
    expect(JSON.stringify(activity)).not.toMatch(
      /private-candidate-sentinel|private-feedback-sentinel|teachingFailure/
    );
    await instance.database.courseClass.update({
      where: { id: operation.classId! },
      data: { attempt: 2 },
    });
    expect(
      await sottoTransaction(instance.database, (database) =>
        readLearningFailure(database, failed!)
      )
    ).toEqual(privateFailure);
    const next = await requestClassPreparation(courseId, execution);
    expect(next.id).not.toBe(operation.id);
    expect(
      await sottoTransaction(instance.database, (database) =>
        readLearningFailure(database, failed!)
      )
    ).toEqual(privateFailure);
  });

  it('rolls back evidence and failure together when their owning transaction fails', async () => {
    const { operation, parent } = await failureFixture();
    await expect(
      sottoTransaction(instance.database, async (database) => {
        await recordClassPreparationFailure(
          database,
          operation,
          parent.fingerprint,
          false,
          'generation_failed',
          privateFailure
        );
        throw new Error('fixture publication rollback');
      })
    ).rejects.toThrow(/rollback/);
    expect(await classPreparationStore(instance.database, courseId).read()).toMatchObject({
      status: 'RUNNING',
      failure: null,
    });
    expect(
      await sottoTransaction(instance.database, (database) =>
        readLearningFailure(database, operation)
      )
    ).toBeNull();
    expect(
      (
        await sottoTransaction(instance.database, (database) =>
          sottoJobOutbox(database).read(operation.id)
        )
      )?.complete
    ).toBe(false);
  });

  it.each(['profile', 'course'] as const)(
    'denies private evidence reads and writes once the captured %s scope is tombstoned',
    async (kind) => {
      const { operation, parent } = await failureFixture();
      await sottoTransaction(instance.database, (database) =>
        new StorageWriteJournal(
          {
            query: (sql, values) =>
              database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
          },
          'postgres',
          SIDEDOOR_STATE_ID
        ).forbidWrites(
          prepareStorageTombstone({
            namespace: SIDEDOOR_STATE_ID,
            subjectId: `${kind}:${kind === 'profile' ? operation.userId : operation.courseId}`,
            generation: kind === 'profile' ? operation.userCreatedAt : operation.courseCreatedAt,
            jobId: randomUUID(),
          })
        )
      );
      await expect(
        sottoTransaction(instance.database, (database) => readLearningFailure(database, operation))
      ).rejects.toThrow(/being erased/);
      await expect(
        sottoTransaction(instance.database, (database) =>
          writeLearningFailure(
            database,
            { ...operation, status: 'FAILED' },
            parent.fingerprint,
            privateFailure
          )
        )
      ).rejects.toThrow(/being erased/);
      await expect(
        sottoTransaction(instance.database, (database) =>
          sottoJobSnapshot(database).read(operation.id, parent.fingerprint, 0)
        )
      ).rejects.toThrow('Snapshot is missing');
    }
  );

  it('erases private review evidence through the owning course cleanup policy', async () => {
    const { operation, parent } = await failureFixture();
    await sottoTransaction(instance.database, (database) =>
      recordClassPreparationFailure(
        database,
        operation,
        parent.fingerprint,
        false,
        'generation_failed',
        privateFailure
      )
    );
    const deletion = prepareStorageCleanup({
      namespace: SIDEDOOR_STATE_ID,
      subjectId: `course:${courseId}`,
      generation: operation.courseCreatedAt,
      retentionPolicy: 'job-id-snapshots-v1',
    });
    const executor = (database: import('@/generated/prisma/client').Prisma.TransactionClient) => ({
      query: (sql: string, values: readonly unknown[]) =>
        database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
    });
    await sottoTransaction(instance.database, async (database) => {
      const location = {
        kind: 'object' as const,
        endpoint: 'https://storage.example',
        bucket: 'failure-retention',
      };
      const backend = prepareStorageBackend(SIDEDOOR_STATE_ID, {
        kind: 'object',
        location,
        binding: storageBackendBinding(location),
      });
      await new StorageBackendRegistry(executor(database), 'postgres', SIDEDOOR_STATE_ID).register(
        backend
      );
      const journal = new StorageCleanupJournal(executor(database), 'postgres', SIDEDOOR_STATE_ID);
      await journal.createJob(deletion);
      await journal.registerCollectors(deletion.id, 0, [
        { id: 'inventory', kind: 'inventory', backendIds: [backend.id], scope: 'retention/' },
      ]);
      const waiting = await journal.transition(deletion.id, 0);
      await journal.recordDrainedIntents(deletion.id, waiting.epoch, null);
    });
    await expect(
      sottoTransaction(instance.database, (database) => readLearningFailure(database, operation))
    ).rejects.toThrow(/being erased/);
    let complete = false;
    for (let step = 0; step < 10 && !complete; step++)
      complete = (
        await sottoTransaction(instance.database, (database) =>
          new JobRetentionCleanup(executor(database), 'postgres', SIDEDOOR_STATE_ID).step(
            deletion.id
          )
        )
      ).complete;
    expect(complete).toBe(true);
    expect(
      await sottoTransaction(instance.database, (database) =>
        sottoJobOutbox(database).receipt(operation.id)
      )
    ).toMatchObject({ status: 'erased' });
    const rows = await instance.database.$queryRawUnsafe<Array<{ count: number }>>(
      'SELECT COUNT(*)::int AS count FROM "SidedoorState" WHERE state::text LIKE \'%private-candidate-sentinel%\''
    );
    expect(rows[0]?.count).toBe(0);
    await expect(
      sottoTransaction(instance.database, (database) => readLearningFailure(database, operation))
    ).rejects.toThrow();
  });

  it('rejects forged owner, operation, fingerprint and class attempt bindings without retaining private material', async () => {
    const { operation, parent } = await failureFixture();
    const failed = { ...operation, status: 'FAILED' as const };
    for (const forged of [
      { ...failed, userId: 'another-learner' },
      { ...failed, courseId: 'another-course' },
      { ...failed, id: randomUUID() },
    ])
      await expect(
        sottoTransaction(instance.database, (database) =>
          writeLearningFailure(database, forged, parent.fingerprint, privateFailure)
        )
      ).rejects.toThrow();
    await expect(
      sottoTransaction(instance.database, (database) =>
        writeLearningFailure(database, failed, 'a'.repeat(64), privateFailure)
      )
    ).rejects.toThrow();
    await instance.database.courseClass.update({
      where: { id: failed.classId! },
      data: { attempt: 2 },
    });
    await expect(
      sottoTransaction(instance.database, (database) =>
        writeLearningFailure(database, failed, parent.fingerprint, privateFailure)
      )
    ).rejects.toThrow(/attempt/);
    expect(
      await sottoTransaction(instance.database, (database) =>
        readLearningFailure(database, operation)
      )
    ).toBeNull();
  });

  it('does not replace completed publication or overwrite a sealed diagnostic', async () => {
    const { operation, parent } = await failureFixture();
    await sottoTransaction(instance.database, async (database) => {
      await classPreparationStore(database, courseId).transact((state) => {
        if (!state) throw new Error('Missing fixture');
        state.status = 'COMPLETED';
      });
      await sottoJobOutbox(database).complete(operation.id, parent.fingerprint);
      await recordClassPreparationFailure(
        database,
        operation,
        parent.fingerprint,
        false,
        'generation_failed',
        privateFailure
      );
    });
    expect(
      await sottoTransaction(instance.database, (database) =>
        readLearningFailure(database, operation)
      )
    ).toBeNull();
    await expect(
      sottoTransaction(instance.database, (database) =>
        writeLearningFailure(
          database,
          { ...operation, status: 'FAILED' },
          parent.fingerprint,
          privateFailure
        )
      )
    ).rejects.toThrow(/completed/);
    const second = await failureFixture();
    await sottoTransaction(instance.database, (database) =>
      recordClassPreparationFailure(
        database,
        second.operation,
        second.parent.fingerprint,
        false,
        'generation_failed',
        privateFailure
      )
    );
    await sottoTransaction(instance.database, (database) =>
      writeLearningFailure(
        database,
        { ...second.operation, status: 'FAILED' },
        second.parent.fingerprint,
        privateFailure
      )
    );
    await expect(
      sottoTransaction(instance.database, (database) =>
        writeLearningFailure(
          database,
          { ...second.operation, status: 'FAILED' },
          second.parent.fingerprint,
          { category: 'database_conflict' }
        )
      )
    ).rejects.toThrow(/sealed/);
    expect(
      await sottoTransaction(instance.database, (database) =>
        readLearningFailure(database, second.operation)
      )
    ).toEqual(privateFailure);
    expect(
      (
        await sottoTransaction(instance.database, (database) =>
          sottoJobSnapshot(database).read(second.operation.id, second.parent.fingerprint, 0)
        )
      ).pages
    ).toBe(1);
  });
}
