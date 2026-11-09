import { expect, vi, type Mock } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { checkCompletedAssessmentAudio } from './retained';
import { checkAssessmentAudioDrain } from './drain';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  LocalStorageCleanup,
  StorageBackendRegistry,
  StorageReferenceRegistry,
  prepareStorageBackend,
  prepareStorageReference,
} from 'thesidedoor-core/storage';
import { Prisma } from '@/generated/prisma/client';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { AssessmentFenceConflict } from '@/lib/learning/classes/lifecycle/assessment-fence';
import { stageAssessmentSection } from '@/lib/learning/classes/generation/assessment-draft';
import { bindAssessmentAudioIdentity } from '@/lib/learning/classes/audio/assessment-audio-lineage';
import {
  beginAssessmentAudioAttempt,
  publishAssessmentAudioAttempt,
  verifyRetainedAssessmentAudioPublication,
} from '@/lib/learning/classes/audio/assessment-audio-attempt';
import { learningAudioIdentitySchema } from '@/lib/learning-map/evidence/media-protocol';
import { captureEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import { capturedLocalBackend } from '@/lib/storage/sidedoor/captured-local';
import { LOCAL_STORAGE_URL_PREFIX } from '@/lib/r2';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { invalidateServerInfra } from '@/lib/server-config';
import { captureInitialStitchInputs } from '@/lib/sidedoor/jobs/initial/initial-stitch-inputs';
import {
  commitInitialStitch,
  prepareInitialStitch,
} from '@/lib/sidedoor/jobs/initial/initial-stitch-admission';
import { initialStitchPayloadSchema } from '@/lib/sidedoor/jobs/initial/initial-stitch-contract';
import {
  readInitialStitchOutcome,
  verifyInitialStitchPublication,
} from '@/lib/sidedoor/jobs/initial/initial-stitch-outcome';
import {
  generateAssessmentReview,
  verifyAssessmentReview,
  prepareAssessmentReviewProof,
  verifyAssessmentReviewProof,
} from '@/lib/learning/classes/review/assessment-review-generation';
import { invokeAssessmentProviderStage } from '@/lib/learning/classes/provider/assessment-provider-stage';
import { relocateStorageFixture } from '../../../../../helpers/runtime/relocate-storage';
import type {
  SharedTestInstance,
  SharedTestIdentity,
} from '../../../../../helpers/setup/shared-instance';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import type { runAssessmentAudioObservationTransaction } from '@/lib/learning/classes/audio/assessment-audio-claim';
import type { captureFailedAssessmentAudioEvidence } from '@/lib/learning/classes/audio/assessment-audio-failure';
import type {
  SottoJobExecutionCapability,
  SottoJobExecutionOperation,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import type { requirePendingAssessmentWork } from '@/lib/learning/classes/generation/assessment-work';

type ObservationContext = {
  capability: SottoJobExecutionCapability;
  operation: SottoJobExecutionOperation;
};
type ObservationIdentity = Parameters<
  typeof runAssessmentAudioObservationTransaction
>[0]['identity'];
interface AudioIdentityContext {
  instance: SharedTestInstance;
  identity: SharedTestIdentity;
  classId: string;
  questionId: string;
  audioQueue: typeof import('@/lib/queue') | undefined;
  boundary: { execution: SottoProviderExecution | null };
  provider: { generate: Mock };
  operation: { id: string; fingerprint: string };
  execution: SottoProviderExecution;
  captured: Awaited<ReturnType<typeof requirePendingAssessmentWork>>;
  assessment: string;
  cls: { courseId: string; createdAt: Date };
  heldOut: { episodeId: string | null };
  audioSegment: { id: string; version: number };
  generationKey: string;
  listeningResult: { sectionId: string };
  finalizedReading: unknown;
  speakingDraft: unknown;
  completionMode: string;
  speechObservation: Awaited<ReturnType<typeof beginAssessmentAudioAttempt>> | undefined;
  speechAttempt:
    | { episodeId: string; segmentId: string; generationKey: string; operationId: string }
    | undefined;
  boundAudioJob: import('bullmq').Job<import('@/lib/queue').GenerateAudioPayload> | undefined;
  runBoundAudio: ((signal?: AbortSignal, onCleanup?: () => void) => Promise<void>) | undefined;
  startAudioExecution:
    (() => Promise<ObservationContext & { finish: () => Promise<void> }>) | undefined;
  observationTransaction: <Result>(
    context: ObservationContext,
    identity: ObservationIdentity,
    run: (tx: import('@/generated/prisma/client').Prisma.TransactionClient) => Promise<Result>
  ) => Promise<Result>;
  captureFailedAudio: (
    context: ObservationContext,
    identity: ObservationIdentity & { nonce: string }
  ) => ReturnType<typeof captureFailedAssessmentAudioEvidence>;
  failQueuedAudio: (operationId: string) => Promise<unknown>;
  durableQueueOperationId: typeof import('@/lib/sidedoor/jobs/core/durable-queue').durableQueueOperationId;
  audioInput: { episodeId: string };
}

export async function checkAssessmentAudioIdentity({
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
}: AudioIdentityContext) {
  const root = await mkdtemp(join(tmpdir(), 'sotto-assessment-identity-'));
  try {
    await instance.configureInfrastructure({
      ttsProvider: 'local',
      sttProvider: 'local',
      ttsBaseUrl: 'http://127.0.0.1:34991',
      sttBaseUrl: 'http://127.0.0.1:34992',
      ttsVoices: 'fixture-voice',
      storageProvider: 'local',
      localStorageRoot: root,
    });
    invalidateServerInfra();
    vi.stubEnv('DATABASE_URL', process.env.SIDEDOOR_TEST_DATABASE_URL!);
    const bytes = await readFile(join(process.cwd(), 'src/assets/sfx/intro-warm.mp3'));
    if (speechObservation) {
      if (!speechAttempt || !startAudioExecution)
        throw new Error('Assessment audio execution missing');
      const child = await sottoTransaction(instance.database, (tx) =>
        sottoJobOutbox(tx).read(speechAttempt!.operationId)
      );
      if (!child) throw new Error('Assessment audio child missing');
      await instance.database.sidedoorState.deleteMany({
        where: {
          id: { contains: ':assessment-audio-attempt:', endsWith: speechAttempt.operationId },
        },
      });
      const publicationExecution = await startAudioExecution();
      try {
        speechObservation = await beginAssessmentAudioAttempt(
          instance.database,
          { ...speechAttempt, fingerprint: child.fingerprint },
          publicationExecution.operation
        );
        speechObservation.onDispatch();
        speechObservation.onSettled();
        const publication = {
          database: instance.database,
          observation: speechObservation,
          audio: bytes,
          duration: 1,
          wordTimings: null,
          signal: new AbortController().signal,
        };
        await expect(
          publishAssessmentAudioAttempt({
            ...publication,
            observation: { ...speechObservation },
          })
        ).rejects.toThrow();
        const { recordObservedFailedAssessmentAudio } =
          await import('@/lib/learning/classes/audio/assessment-audio-failure');
        let releaseSettlement!: () => void;
        let settlementReady!: () => void;
        const settlementGate = new Promise<void>((resolve) => {
          releaseSettlement = resolve;
        });
        const settlementSnapshot = new Promise<void>((resolve) => {
          settlementReady = resolve;
        });
        const staleSettlement = instance.database
          .$transaction(
            async (tx) => {
              await sottoJobOutbox(tx).read(child.job.id);
              settlementReady();
              await settlementGate;
              return recordObservedFailedAssessmentAudio(tx, {}, publicationExecution.operation);
            },
            { isolationLevel: 'Serializable', timeout: 30000 }
          )
          .then(
            () => null,
            (error: unknown) => error
          );
        await settlementSnapshot;
        const originalBytes = Buffer.from(bytes);
        const publishing = publishAssessmentAudioAttempt(publication);
        bytes.fill(0);
        let reference: string;
        try {
          reference = await publishing;
        } finally {
          releaseSettlement();
        }
        expect(await staleSettlement).toBeInstanceOf(AssessmentFenceConflict);
        expect(await readFile(join(root, reference.replace('/api/v1/storage/', '')))).toEqual(
          originalBytes
        );
        originalBytes.copy(bytes);
        await expect(publishAssessmentAudioAttempt(publication)).rejects.toThrow();
        expect(() => speechObservation!.onDispatch()).toThrow();
      } finally {
        await publicationExecution.finish();
      }
    } else {
      const backend = await capturedLocalBackend(
        await LocalStorageCleanup.capture(root),
        root,
        LOCAL_STORAGE_URL_PREFIX,
        () => {}
      );
      const registration = prepareStorageBackend(SIDEDOOR_STATE_ID, backend.descriptor);
      const key = `${randomUUID()}.mp3`;
      const reference = await backend.writeBuffer(key, bytes, 'audio/mpeg');
      await sottoTransaction(instance.database, async (tx) => {
        const executor = {
          query: (sql: string, values: readonly unknown[]) =>
            tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        };
        await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(
          registration
        );
        const episodeStorage = await captureEpisodeStorage(tx, heldOut.episodeId!);
        await new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).replaceMany({
          consumers: [{ consumer: `segment:${audioSegment.id}:audio`, previousReference: null }],
          next: prepareStorageReference({
            namespace: SIDEDOOR_STATE_ID,
            operationId: randomUUID(),
            reference,
            localRoutePrefix: LOCAL_STORAGE_URL_PREFIX,
            target: { backendId: registration.id, binding: registration.binding, key },
            scopes: episodeStorage.scopes,
          }),
        });
        await tx.segment.update({
          where: { id: audioSegment.id },
          data: { audioUrl: reference, duration: 1 },
        });
      });
    }
    if (speechAttempt && speechObservation) {
      await checkCompletedAssessmentAudio({
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
        bytes,
        generationKey,
      });
    }
    const inputs = await sottoTransaction(instance.database, (tx) =>
      captureInitialStitchInputs(tx, execution.authorize, heldOut.episodeId!, generationKey)
    );
    const prepared = prepareInitialStitch(inputs, 'none');
    const stitch = await sottoTransaction(instance.database, (tx) =>
      commitInitialStitch(tx, execution.authorize, inputs, 'none', prepared, 'GENERATING_AUDIO')
    );
    const { processDurableInitialAudioStitching } =
      await import('@/workers/durable/audio/durable-initial-audio-stitching');
    const job = {
      id: stitch.job.id,
      name: 'audio-stitching.v2',
      data: { operationId: stitch.job.id, fingerprint: stitch.fingerprint },
      updateProgress: async () => {},
    };
    await processDurableInitialAudioStitching(job);
    await processDurableInitialAudioStitching(job);
    if (boundAudioJob && runBoundAudio) {
      const fetcher = vi.spyOn(globalThis, 'fetch');
      try {
        await runBoundAudio();
        expect(fetcher).not.toHaveBeenCalled();
      } finally {
        fetcher.mockRestore();
      }
    }
    const published = learningAudioIdentitySchema.parse(
      (
        await instance.database.classAssessmentSection.findUniqueOrThrow({
          where: { id: listeningResult.sectionId },
        })
      ).audioIdentity
    );
    await sottoTransaction(instance.database, async (tx) => {
      await bindAssessmentAudioIdentity(tx, published);
      const completed = await sottoJobOutbox(tx).read(stitch.job.id);
      if (!completed) throw new Error('Completed stitch missing');
      expect(await readInitialStitchOutcome(tx, completed)).toMatchObject({
        kind: 'READY',
        effects: [],
      });
      expect(await verifyInitialStitchPublication(tx, completed)).toMatchObject({
        kind: 'READY',
      });
      const { outputs } = initialStitchPayloadSchema.parse(completed.job.payload);
      for (const id of [
        outputs.readyNotification,
        outputs.readyStatus,
        outputs.pdf,
        outputs.waveform,
      ])
        expect(await sottoJobOutbox(tx).read(id)).toBeNull();
    });
    if (audioQueue) {
      await checkAssessmentAudioDrain({
        instance,
        operation,
        execution,
        captured,
        classId,
        assessment,
        durableQueueOperationId,
        audioQueue,
        heldOut,
        audioSegment,
        generationKey,
        cls,
        completionMode,
        failQueuedAudio,
        startAudioExecution,
        observationTransaction,
        captureFailedAudio,
        identity,
      });
    }
    await sottoTransaction(instance.database, async (tx) => {
      await stageAssessmentSection(tx, operation, execution, finalizedReading);
      await stageAssessmentSection(tx, operation, execution, speakingDraft);
      await stageAssessmentSection(tx, operation, execution, {
        skill: 'WRITING',
        items: Array.from({ length: 3 }, (_, index) => ({
          task: `Independent writing ${index}`,
          rubric: 'Criteria',
          guidance: 'Guidance',
        })),
      });
    });
    let reviewDispatches = 0;
    let invalidateDuringReview = true;
    let tamperAfterReplay = false;
    provider.generate.mockImplementation(async () => {
      const request = boundary.execution?.providerRequest;
      if (!request) throw new Error('Missing journaled review request');
      const response = await request(
        new Request('https://provider.example.test/review', {
          method: 'POST',
          body: 'stable review request',
        }),
        async () => {
          reviewDispatches += 1;
          if (invalidateDuringReview) {
            invalidateDuringReview = false;
            await expect(
              instance.database.lessonQuestion.update({
                where: { id: questionId },
                data: { explanation: 'Changed during independent review' },
              })
            ).rejects.toThrow(/Class teaching is frozen/);
          }
          return Response.json({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    taught: true,
                    independent: true,
                    correct: true,
                    unambiguous: true,
                    appropriate: true,
                    rubricsSound: true,
                    answersConcealed: true,
                    issues: [],
                  }),
                },
                finish_reason: 'stop',
              },
            ],
          });
        }
      );
      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      if (tamperAfterReplay) {
        tamperAfterReplay = false;
        const row = await instance.database.classAssessmentProviderCall.findFirstOrThrow({
          where: { assessmentId: assessment, stage: 'REVIEW', role: 'MODEL' },
        });
        if (
          !row.responseMetadata ||
          typeof row.responseMetadata !== 'object' ||
          Array.isArray(row.responseMetadata)
        )
          throw new Error('Review response metadata missing');
        await instance.database.classAssessmentProviderCall.update({
          where: { id: row.id },
          data: { responseMetadata: { ...row.responseMetadata, statusText: 'Changed' } },
        });
      }
      return {
        content: data.choices[0]!.message.content,
        model: 'fixture',
        inputTokens: 1,
        outputTokens: 1,
      };
    });
    const reviewInput = {
      identity: operation,
      execution,
      unresolved: () => {
        throw new Error('Unexpected unresolved review');
      },
    };
    const review = await generateAssessmentReview(reviewInput);
    expect(review).toMatchObject({ status: 'REVIEWED' });
    if (review.status !== 'REVIEWED') throw new Error('Expected completed review');
    expect(await generateAssessmentReview(reviewInput)).toEqual(review);
    expect(reviewDispatches).toBe(1);
    const offline = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('Replay attempted network access');
    });
    try {
      expect(await verifyAssessmentReview({ identity: operation, execution })).toEqual(review);
      expect(reviewDispatches).toBe(1);
    } finally {
      offline.mockRestore();
    }
    const reviewRow = await instance.database.classAssessmentProviderCall.findFirstOrThrow({
      where: { assessmentId: assessment, stage: 'REVIEW', role: 'MODEL' },
    });
    if (
      !reviewRow.responseMetadata ||
      typeof reviewRow.responseMetadata !== 'object' ||
      Array.isArray(reviewRow.responseMetadata)
    )
      throw new Error('Review response metadata missing');
    tamperAfterReplay = true;
    await expect(
      prepareAssessmentReviewProof({ identity: operation, execution })
    ).rejects.toThrow();
    await instance.database.classAssessmentProviderCall.update({
      where: { id: reviewRow.id },
      data: { responseMetadata: reviewRow.responseMetadata },
    });
    const reviewProof = await prepareAssessmentReviewProof({ identity: operation, execution });
    expect(
      await sottoTransaction(instance.database, (tx) =>
        verifyAssessmentReviewProof(tx, reviewProof)
      )
    ).toEqual({
      materialDigest: review.materialDigest,
    });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        verifyAssessmentReviewProof(tx, { ...reviewProof })
      )
    ).rejects.toThrow();
    let releaseProof!: () => void;
    let proofLocked!: () => void;
    const proofGate = new Promise<void>((resolve) => {
      releaseProof = resolve;
    });
    const proofStarted = new Promise<void>((resolve) => {
      proofLocked = resolve;
    });
    const verifying = sottoTransaction(instance.database, async (tx) => {
      await verifyAssessmentReviewProof(tx, reviewProof);
      proofLocked();
      await proofGate;
    });
    await proofStarted;
    const writer = instance.database.classAssessmentProviderCall
      .update({
        where: { id: reviewRow.id },
        data: {
          responseMetadata: { ...reviewRow.responseMetadata, statusText: 'Changed later' },
        },
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
      releaseProof();
    }
    await verifying;
    expect(await writer).toBe('written');
    await expect(
      sottoTransaction(instance.database, (tx) => verifyAssessmentReviewProof(tx, reviewProof))
    ).rejects.toThrow();
    await instance.database.classAssessmentProviderCall.update({
      where: { id: reviewRow.id },
      data: { responseMetadata: reviewRow.responseMetadata },
    });
    const stageInput = {
      identity: operation,
      execution,
      current: captured.current,
      stage: 'AUTHOR_WRITING' as const,
      sourceDigest: 'a'.repeat(64),
      unresolved: reviewInput.unresolved,
      request: {
        system: 'Original instruction',
        payload: 'Original material',
        schema: {},
        schemaName: 'fixture',
      },
    };
    await expect(
      invokeAssessmentProviderStage({ ...stageInput, replayOnly: true })
    ).rejects.toThrow();
    expect(
      await instance.database.classAssessmentProviderCall.count({
        where: { assessmentId: assessment, stage: 'AUTHOR_WRITING' },
      })
    ).toBe(0);
    const stage = await invokeAssessmentProviderStage(stageInput);
    await sottoTransaction(instance.database, (tx) => stage.verify(tx));
    await invokeAssessmentProviderStage({ ...stageInput, replayOnly: true });
    expect(reviewDispatches).toBe(2);
    const savedReview = await instance.database.classAssessment.findUniqueOrThrow({
      where: { id: assessment },
    });
    if (
      !savedReview.reviewReceipt ||
      typeof savedReview.reviewReceipt !== 'object' ||
      Array.isArray(savedReview.reviewReceipt)
    )
      throw new Error('Saved review receipt missing');
    await instance.database.classAssessment.update({
      where: { id: assessment },
      data: { reviewReceipt: { ...savedReview.reviewReceipt, responseSha256: '0'.repeat(64) } },
    });
    await expect(verifyAssessmentReview({ identity: operation, execution })).rejects.toThrow();
    await expect(
      sottoTransaction(instance.database, (tx) => verifyAssessmentReviewProof(tx, reviewProof))
    ).rejects.toThrow();
    await instance.database.classAssessment.update({
      where: { id: assessment },
      data: { reviewReceipt: savedReview.reviewReceipt },
    });
    const reviewCall = await instance.database.classAssessmentProviderCall.findFirstOrThrow({
      where: { assessmentId: assessment, stage: 'REVIEW', role: 'MODEL' },
    });
    const rejectedReview = Buffer.from(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                taught: true,
                independent: true,
                correct: true,
                unambiguous: true,
                appropriate: true,
                rubricsSound: true,
                answersConcealed: false,
                issues: ['Answer disclosed'],
              }),
            },
            finish_reason: 'stop',
          },
        ],
      })
    );
    await instance.database.classAssessmentProviderCall.update({
      where: { id: reviewCall.id },
      data: {
        responseBytes: rejectedReview,
        responseSha256: createHash('sha256').update(rejectedReview).digest('hex'),
      },
    });
    await expect(verifyAssessmentReview({ identity: operation, execution })).rejects.toThrow(
      'independent review'
    );
    await instance.database.classAssessmentProviderCall.update({
      where: { id: reviewCall.id },
      data: {
        responseBytes: reviewCall.responseBytes,
        responseSha256: reviewCall.responseSha256,
      },
    });
    await expect(
      invokeAssessmentProviderStage({
        ...stageInput,
        request: { ...stageInput.request, system: 'Changed instruction' },
      })
    ).rejects.toThrow();
    await expect(
      invokeAssessmentProviderStage({
        ...stageInput,
        request: { ...stageInput.request, schema: { type: 'object' } },
      })
    ).rejects.toThrow();
    expect(reviewDispatches).toBe(2);
    expect(
      (
        await instance.database.classAssessment.findUniqueOrThrow({
          where: { id: assessment },
        })
      ).reviewReceipt
    ).toMatchObject({
      decision: 'ACCEPTED',
      assessmentId: assessment,
      materialDigest: review.materialDigest,
    });
    const reviewQuestion = await instance.database.classAssessmentQuestion.findFirstOrThrow({
      where: { assessmentId: assessment, section: { skill: 'READING' } },
    });
    await expect(
      instance.database.classAssessmentQuestion.update({
        where: { id: reviewQuestion.id },
        data: { explanation: 'Changed after review' },
      })
    ).rejects.toThrow(/frozen by admitted audio/);
    expect(await verifyAssessmentReview({ identity: operation, execution })).toEqual(review);
    await instance.database.classAssessmentSection.update({
      where: { id: listeningResult.sectionId },
      data: { audioIdentity: Prisma.DbNull },
    });
    await expect(
      sottoTransaction(instance.database, async (tx) => {
        const completed = await sottoJobOutbox(tx).read(stitch.job.id);
        if (!completed) throw new Error('Completed stitch missing');
        return verifyInitialStitchPublication(tx, completed);
      })
    ).rejects.toThrow();
    await instance.database.classAssessmentSection.update({
      where: { id: listeningResult.sectionId },
      data: { audioIdentity: published },
    });
    expect(
      (
        await instance.database.classAssessmentSection.findUniqueOrThrow({
          where: { id: listeningResult.sectionId },
        })
      ).audioIdentity
    ).toEqual(published);
    await expect(
      sottoTransaction(instance.database, (tx) =>
        bindAssessmentAudioIdentity(tx, { ...published, contentSha256: '0'.repeat(64) })
      )
    ).rejects.toThrow();
    const { outputs } = initialStitchPayloadSchema.parse(stitch.job.payload);
    const moved = await relocateStorageFixture({
      database: instance.database,
      directory: root,
      reference: published.reference.reference,
      consumers: [
        `episode:${heldOut.episodeId}:audio`,
        `episode-version:${outputs.versionId}:audio`,
      ],
      publish: async (tx, audioUrl) => {
        await tx.episode.update({ where: { id: heldOut.episodeId! }, data: { audioUrl } });
        await tx.episodeVersion.update({
          where: { id: outputs.versionId },
          data: { audioUrl },
        });
      },
    });
    const verifyRecovered = () =>
      sottoTransaction(instance.database, async (tx) => {
        const completed = await sottoJobOutbox(tx).read(stitch.job.id);
        if (!completed) throw new Error('Completed stitch missing');
        return verifyInitialStitchPublication(tx, completed);
      });
    expect(await verifyRecovered()).toMatchObject({ kind: 'READY' });
    const { captureSealedAssessmentCandidate } =
      await import('@/lib/learning/classes/material/assessment-snapshot');
    let movedDigest: string | undefined;
    const captureSealed = () =>
      sottoTransaction(instance.database, async (tx) => {
        await tx.classAssessment.update({
          where: { id: assessment },
          data: { status: 'READY', sealedAt: new Date() },
        });
        const candidate = await captureSealedAssessmentCandidate(tx, execution, {
          classId,
          assessmentId: assessment,
          classAttempt: captured.current.classAttempt,
          assessmentAttempt: captured.current.assessmentAttempt,
          ...(captured.current.materialVersion === 2 ? { materialVersion: 2 as const } : {}),
          generationOperationId: operation.id,
          ownership: captured.current.ownership,
        });
        if (candidate.status !== 'CAPTURED') throw new Error('Sealed audio is unavailable');
        if (completionMode === 'worker') {
          expect(candidate.material.version).toBe(2);
          const speaking = candidate.material.sections.find(
            (section) => section.skill === 'SPEAKING'
          );
          expect(speaking?.items[0]).toMatchObject({
            privateCriteria: [{ id: 'meaning', modality: 'TRANSCRIPT' }],
          });
        }
        movedDigest = candidate.digest;
        throw new Error('Roll back sealed fixture');
      });
    await expect(captureSealed()).rejects.toThrow('Roll back sealed fixture');
    expect(movedDigest).toBe(review.materialDigest);
    const movedAgain = await relocateStorageFixture({
      database: instance.database,
      directory: root,
      reference: moved,
      consumers: [
        `episode:${heldOut.episodeId}:audio`,
        `episode-version:${outputs.versionId}:audio`,
      ],
      publish: async (tx, audioUrl) => {
        await tx.episode.update({ where: { id: heldOut.episodeId! }, data: { audioUrl } });
        await tx.episodeVersion.update({
          where: { id: outputs.versionId },
          data: { audioUrl },
        });
      },
    });
    await expect(captureSealed()).rejects.toThrow('Roll back sealed fixture');
    expect(movedDigest).toBe(review.materialDigest);
    const changedIdentity = { ...published, contentSha256: '0'.repeat(64) };
    await sottoTransaction(instance.database, async (tx) => {
      await tx.classAssessmentSection.update({
        where: { id: listeningResult.sectionId },
        data: { audioIdentity: changedIdentity },
      });
      await tx.$executeRaw`UPDATE "Episode" SET "learningAudioIdentity" = ${JSON.stringify(changedIdentity)}::jsonb WHERE id = ${heldOut.episodeId}`;
    });
    await expect(verifyRecovered()).rejects.toThrow('Assessment audio recovery storage changed');
    await expect(captureSealed()).rejects.not.toThrow('Roll back sealed fixture');
    await sottoTransaction(instance.database, async (tx) => {
      await tx.classAssessmentSection.update({
        where: { id: listeningResult.sectionId },
        data: { audioIdentity: published },
      });
      await tx.$executeRaw`UPDATE "Episode" SET "learningAudioIdentity" = ${JSON.stringify(published)}::jsonb WHERE id = ${heldOut.episodeId}`;
    });
    if (completionMode === 'worker') {
      if (!speechAttempt) throw new Error('Assessment audio attempt missing');
      const child = await sottoTransaction(instance.database, (tx) =>
        sottoJobOutbox(tx).read(speechAttempt!.operationId)
      );
      if (!child) throw new Error('Assessment audio child missing');
      const segment = await instance.database.segment.findUniqueOrThrow({
        where: { id: speechAttempt.segmentId },
      });
      if (!segment.audioUrl) throw new Error('Assessment segment audio missing');
      const attempt = {
        ...speechAttempt,
        classId,
        courseId: cls.courseId,
        userId: identity.ownerId,
        classGeneration: cls.createdAt.getTime(),
        scopes: child.job.scopes,
        assessmentId: assessment,
        parentOperationId: operation.id,
        fingerprint: child.fingerprint,
        segmentVersion: segment.version,
      };
      const verifySegment = () =>
        sottoTransaction(instance.database, (tx) =>
          verifyRetainedAssessmentAudioPublication(tx, attempt)
        );
      const original = await verifySegment();
      const relocated = await relocateStorageFixture({
        database: instance.database,
        directory: root,
        reference: segment.audioUrl,
        consumers: [`segment:${segment.id}:audio`],
        publish: (tx, audioUrl) =>
          tx.segment.update({ where: { id: segment.id }, data: { audioUrl } }),
      });
      expect(await verifySegment()).toEqual(original);
      await relocateStorageFixture({
        database: instance.database,
        directory: root,
        reference: relocated,
        consumers: [`segment:${segment.id}:audio`],
        recordProof: false,
        publish: (tx, audioUrl) =>
          tx.segment.update({ where: { id: segment.id }, data: { audioUrl } }),
      });
      await expect(verifySegment()).rejects.toThrow();
    }
    await relocateStorageFixture({
      database: instance.database,
      directory: root,
      reference: movedAgain,
      recordProof: false,
      consumers: [
        `episode:${heldOut.episodeId}:audio`,
        `episode-version:${outputs.versionId}:audio`,
      ],
      publish: async (tx, audioUrl) => {
        await tx.episode.update({ where: { id: heldOut.episodeId! }, data: { audioUrl } });
        await tx.episodeVersion.update({
          where: { id: outputs.versionId },
          data: { audioUrl },
        });
      },
    });
    await expect(verifyRecovered()).rejects.toThrow();
    await expect(captureSealed()).rejects.not.toThrow('Roll back sealed fixture');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
