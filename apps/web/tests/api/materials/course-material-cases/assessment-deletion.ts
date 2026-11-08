import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  StorageBackendRegistry,
  StorageReferenceRegistry,
  StorageWriteJournal,
  prepareStorageBackend,
  prepareStorageReference,
  prepareStorageTombstone,
} from 'thesidedoor-core/storage';
import { deleteCourseCompletely } from '@/lib/course-deletion';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { inspectStorageMigrationConsumer } from '@/lib/sidedoor/storage/migration/storage-migration-plan';
import { captureStorageBackend, LOCAL_STORAGE_URL_PREFIX } from '@/lib/r2';
import { captureEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import {
  captureSpeakingPromptStorage,
  captureSpeakingRecordingStorage,
} from '@/lib/sidedoor/storage/core/speaking-storage';
import { speakingGradingPayloadSchema } from '@/lib/sidedoor/jobs/stitch/speaking-grading-work';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { visitStorageDeletionReferences } from '@/lib/storage/sidedoor/deletion-targets';
import type {
  SharedTestIdentity,
  SharedTestInstance,
} from '../../../helpers/setup/shared-instance';

interface AssessmentDeletionContext {
  instance: SharedTestInstance;
  identity: SharedTestIdentity;
  courseId: string;
  boundary: { beforeCourseDeletion: (() => Promise<void>) | null };
}

export function registerAssessmentDeletionCase(getContext: () => AssessmentDeletionContext) {
  it('preserves unbound assessment references when course deletion is refused', async () => {
    const { instance, identity, courseId, boundary } = getContext();
    const course = await instance.database.course.findUniqueOrThrow({ where: { id: courseId } });
    const lesson = await instance.database.lesson.create({
      data: {
        curriculumId: course.curriculumId,
        slug: 'assessment-deletion',
        level: 'A1',
        order: 1,
        title: 'First lesson',
        objective: 'Greet',
        grammarPoints: [],
        targetVocab: [],
        vocabThemes: [],
      },
    });
    const cls = await instance.database.courseClass.create({
      data: { courseId, lessonId: lesson.id, order: 1 },
    });
    const operationId = randomUUID();
    const assessment = await instance.database.classAssessment.create({
      data: {
        classId: cls.id,
        courseId,
        userId: identity.ownerId,
        classAttempt: 1,
        assessmentAttempt: 1,
        requirements: {},
        formativeRevision: 'revision',
        teachingKind: 'BASE',
        teachingReceiptId: randomUUID(),
        generationOperationId: operationId,
      },
    });
    const listening = await instance.database.classAssessmentSection.create({
      data: {
        assessmentId: assessment.id,
        skill: 'LISTENING',
        passThreshold: 0.7,
      },
    });
    const episode = await sottoTransaction(instance.database, async (tx) => {
      const created = await tx.episode.create({
        data: {
          userId: identity.ownerId,
          title: 'Assessment',
          topic: 'Test',
          assessmentAudioAssessmentId: assessment.id,
          assessmentAudioSectionId: listening.id,
          assessmentAudioOperationId: operationId,
        },
      });
      await tx.classAssessmentSection.update({
        where: { id: listening.id },
        data: {
          episodeId: created.id,
          audioReservationEpisodeId: created.id,
          audioReservationOperationId: operationId,
        },
      });
      return created;
    });
    const speaking = await instance.database.classAssessmentSection.create({
      data: { assessmentId: assessment.id, skill: 'SPEAKING', passThreshold: 0.7 },
    });
    const prompt = await instance.database.speakingPrompt.create({
      data: {
        assessmentSectionId: speaking.id,
        assessmentTaskMode: 'READ_ALOUD',
        order: 1,
        targetPhrase: 'Hallo',
        translation: 'Hello',
        assessmentRubric: 'Pronounce the greeting',
        referenceTtsUrl: 'https://external.example/reference.mp3',
      },
    });
    const recording = await instance.database.speakingRecording.create({
      data: {
        assessmentSectionId: speaking.id,
        promptId: prompt.id,
        userId: identity.ownerId,
        audioUrl: 'https://external.example/recording.mp3',
      },
    });
    for (const scope of [
      { kind: 'course' as const, id: courseId, episodeIds: [episode.id] },
      { kind: 'profile' as const, id: identity.ownerId },
    ]) {
      const sources: string[] = [];
      await sottoTransaction(instance.database, (database) =>
        visitStorageDeletionReferences(database, scope, async (page) => {
          sources.push(...page.rows.map((row) => `${page.source}:${row.id}`));
        })
      );
      expect(sources).toContain(`prompt:${prompt.id}`);
      expect(sources).toContain(`recording:${recording.id}`);
    }
    const other = await identity.household('Other learner');
    await instance.database.episode.update({
      where: { id: episode.id },
      data: { userId: other.id },
    });
    await expect(deleteCourseCompletely(courseId)).rejects.toThrow(
      'Assessment episode ownership changed during deletion'
    );
    expect(await instance.database.course.findUnique({ where: { id: courseId } })).not.toBeNull();
    expect(
      await instance.database.episode.findUnique({ where: { id: episode.id } })
    ).not.toBeNull();
    await instance.database.episode.update({
      where: { id: episode.id },
      data: { userId: identity.ownerId },
    });
    const otherCurriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'es' } },
      create: { nativeLang: 'en', targetLang: 'es', title: 'Spanish' },
      update: {},
    });
    const otherCourse = await instance.database.course.create({
      data: {
        userId: identity.ownerId,
        nativeLang: course.nativeLang,
        targetLang: 'es',
        curriculumId: otherCurriculum.id,
      },
    });
    let started!: () => void;
    let release!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    boundary.beforeCourseDeletion = async () => {
      boundary.beforeCourseDeletion = null;
      started();
      await releasePromise;
    };
    const deletion = deleteCourseCompletely(courseId);
    await Promise.race([
      startedPromise,
      deletion.then(() => {
        throw new Error('Deletion completed before the test barrier');
      }),
    ]);
    try {
      await expect(
        instance.database.practiceSession.create({
          data: {
            courseId: otherCourse.id,
            kind: 'LISTENING',
            items: [],
            seed: 'seed',
            episodeId: episode.id,
          },
        })
      ).rejects.toThrow('Assessment audio cannot be used by another activity');
      await instance.database.episode.update({
        where: { id: episode.id },
        data: { userId: other.id },
      });
    } finally {
      release();
    }
    await expect(deletion).rejects.toThrow(
      'An assessment request is already active or needs recovery'
    );
    expect(
      await instance.database.episode.findUnique({ where: { id: episode.id } })
    ).not.toBeNull();
    await instance.database.episode.update({
      where: { id: episode.id },
      data: { userId: identity.ownerId },
    });
    await expect(
      instance.database.course.update({ where: { id: courseId }, data: { userId: other.id } })
    ).rejects.toThrow('Assessment ownership and attempt cannot change');
    const backend = await captureStorageBackend();
    const registeredBackend = prepareStorageBackend(SIDEDOOR_STATE_ID, backend.descriptor);
    const assets = [
      { consumer: `episode:${episode.id}:audio`, key: `assessment/${randomUUID()}-listening.wav` },
      {
        consumer: `speaking-prompt:${prompt.id}:reference`,
        key: `assessment/${randomUUID()}-reference.wav`,
      },
      {
        consumer: `recording:${recording.id}:audio`,
        key: `assessment/${randomUUID()}-recording.wav`,
      },
    ];
    const references = await Promise.all(
      assets.map((asset) =>
        backend.writeBuffer(asset.key, Buffer.from(asset.consumer), 'audio/wav')
      )
    );
    await sottoTransaction(instance.database, async (database) => {
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(
        registeredBackend
      );
      const scopes = (await captureEpisodeStorage(database, episode.id)).scopes;
      const promptOwnership = await captureSpeakingPromptStorage(database, prompt.id);
      const recordingOwnership = await captureSpeakingRecordingStorage(database, recording.id);
      expect(speakingGradingPayloadSchema.shape.ownership.parse(recordingOwnership)).toEqual(
        recordingOwnership
      );
      expect(promptOwnership.associations.parents).toContainEqual(
        expect.objectContaining({ kind: 'assessment', id: speaking.id, parentId: assessment.id })
      );
      await database.courseClass.update({ where: { id: cls.id }, data: { attempt: 2 } });
      const historical = await captureSpeakingPromptStorage(database, prompt.id);
      expect(historical.associations.parents).toContainEqual(
        expect.objectContaining({
          kind: 'assessment',
          assessment: expect.objectContaining({ classAttempt: 1, currentClassAttempt: 2 }),
        })
      );
      await database.courseClass.update({ where: { id: cls.id }, data: { attempt: 1 } });
      const otherProfile = await database.user.findUniqueOrThrow({ where: { id: other.id } });
      const registry = new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID);
      for (const [index, asset] of assets.entries()) {
        await registry.replaceMany({
          consumers: [
            { consumer: asset.consumer, previousReference: null },
            ...(index === 1
              ? [{ consumer: `profile:${other.id}:avatar`, previousReference: null }]
              : []),
          ],
          next: prepareStorageReference({
            namespace: SIDEDOOR_STATE_ID,
            operationId: randomUUID(),
            reference: references[index]!,
            localRoutePrefix: LOCAL_STORAGE_URL_PREFIX,
            target: {
              backendId: registeredBackend.id,
              binding: registeredBackend.binding,
              key: asset.key,
            },
            scopes: [
              ...(index === 0
                ? scopes
                : index === 1
                  ? promptOwnership.scopes
                  : recordingOwnership.scopes),
              ...(index === 1
                ? [
                    {
                      subjectId: `profile:${other.id}`,
                      generation: otherProfile.createdAt.getTime(),
                    },
                  ]
                : []),
            ],
          }),
        });
      }
      await database.episode.update({
        where: { id: episode.id },
        data: { audioUrl: references[0] },
      });
      await database.speakingPrompt.update({
        where: { id: prompt.id },
        data: { referenceTtsUrl: references[1] },
      });
      await database.speakingRecording.delete({ where: { id: recording.id } });
      await database.speakingRecording.create({
        data: {
          id: recording.id,
          assessmentSectionId: speaking.id,
          promptId: prompt.id,
          userId: identity.ownerId,
          audioUrl: references[2]!,
        },
      });
      await database.user.update({ where: { id: other.id }, data: { image: references[1] } });
    });
    await sottoTransaction(instance.database, async (database) => {
      const registry = new StorageReferenceRegistry(
        {
          query: (sql, values) =>
            database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        },
        'postgres',
        SIDEDOOR_STATE_ID
      );
      for (const [index, asset] of assets.entries()) {
        const resolved = await registry.resolve({
          consumer: asset.consumer,
          reference: references[index]!,
        });
        if (!resolved) throw new Error('Missing fixture storage reference');
        const inspection = await inspectStorageMigrationConsumer(
          database,
          asset.consumer,
          resolved.prepared
        );
        expect(inspection.reason).toBe(index === 2 ? 'unsupported-consumer' : null);
      }
    });
    await expect(
      sottoTransaction(instance.database, async (database) => {
        const scope = (await captureSpeakingPromptStorage(database, prompt.id)).scopes.find(
          (item) => item.subjectId === `class:${cls.id}`
        );
        if (!scope) throw new Error('Missing assessment class scope');
        await new StorageWriteJournal(
          {
            query: (sql, values) =>
              database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
          },
          'postgres',
          SIDEDOOR_STATE_ID
        ).forbidWrites(
          prepareStorageTombstone({ namespace: SIDEDOOR_STATE_ID, ...scope, jobId: randomUUID() })
        );
        await expect(captureSpeakingPromptStorage(database, prompt.id)).rejects.toThrow(
          'Speaking storage ownership or associations changed'
        );
        await expect(captureSpeakingRecordingStorage(database, recording.id)).rejects.toThrow(
          'Speaking storage ownership or associations changed'
        );
        throw new Error('rollback test tombstone');
      })
    ).rejects.toThrow('rollback test tombstone');
    await instance.database.classAssessment.update({
      where: { id: assessment.id },
      data: {
        status: 'READY',
        generationOperationId: operationId,
        reviewOperationId: 'deletion-review',
        reviewedMaterialDigest: 'a'.repeat(64),
        reviewReceipt: {},
        sealedAt: new Date(),
      },
    });
    await expect(deleteCourseCompletely(courseId)).rejects.toThrow(
      'An assessment request is already active or needs recovery'
    );
    for (const asset of assets) expect(await backend.has(asset.key)).toBe(true);
    await sottoTransaction(instance.database, async (database) => {
      const registry = new StorageReferenceRegistry(
        {
          query: (sql, values) =>
            database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        },
        'postgres',
        SIDEDOOR_STATE_ID
      );
      for (const [index, asset] of assets.entries())
        expect(
          await registry.resolve({ consumer: asset.consumer, reference: references[index]! })
        ).not.toBeNull();
      expect(
        await registry.resolve({
          consumer: `profile:${other.id}:avatar`,
          reference: references[1]!,
        })
      ).not.toBeNull();
    });
    expect(
      await instance.database.episode.findUnique({ where: { id: episode.id } })
    ).not.toBeNull();
    expect(
      await instance.database.classAssessment.findUnique({ where: { id: assessment.id } })
    ).not.toBeNull();
  });
}
