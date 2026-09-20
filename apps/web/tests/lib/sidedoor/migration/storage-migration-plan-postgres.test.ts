// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  StorageBackendRegistry,
  StorageReferenceRegistry,
  StorageWriteJournal,
  prepareStorageBackend,
  prepareStorageReference,
  prepareStorageTombstone,
  storageBackendBinding,
} from 'thesidedoor-core/storage';
import type { Prisma } from '@/generated/prisma/client';
import { readStorageMigrationAssetPage } from '@/lib/sidedoor/storage/migration/storage-migration-plan';
import { readStorageMigrationReferencePage } from '@/lib/sidedoor/storage/migration/storage-migration-references';
import { planSottoStorageMigration } from '@/lib/sidedoor/storage/migration/storage-migration-dry-run';
import {
  readStorageConsumerReference,
  replaceStorageConsumerReference,
} from '@/lib/sidedoor/storage/core/storage-consumers';
import {
  captureSpeakingRecordingStorage,
  SpeakingStorageChangedError,
} from '@/lib/sidedoor/storage/core/speaking-storage';
import { admitSottoStorageCopy } from '@/lib/sidedoor/storage/migration/storage-migration-copy';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';
import { SHARED_SESSION_COOKIE } from '@/lib/sidedoor/access/core/session-identity';
import { SIDEDOOR_STATE_ID, sottoStorageInstance } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../../helpers/setup/shared-instance';

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
const configuration = {
  aiProvider: null,
  aiModel: null,
  aiBaseUrl: null,
  liveModel: null,
  sttProvider: null,
  sttBaseUrl: null,
  sttModel: null,
  ttsProvider: null,
  ttsBaseUrl: null,
  ttsVoices: null,
  storageProvider: 'r2',
  localStorageRoot: null,
  objectStorageEndpoint: 'https://r2.example',
  objectStorageBucket: 'media',
  objectStorageRegion: 'auto',
  objectStoragePublicUrl: null,
};
suite('canonical storage migration inventory', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('storage_migration_plan');
  });
  beforeEach(async () => {
    identity = await instance.reset();
  });
  afterAll(async () => {
    await instance?.close();
  });
  function executor(tx: Prisma.TransactionClient) {
    return {
      query: (sql: string, values: readonly unknown[]) =>
        tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
    };
  }
  async function original() {
    const request = new Request('http://localhost/api/v1/admin/storage/migrate', {
      headers: { cookie: `${SHARED_SESSION_COOKIE}=${identity.ownerToken}` },
    });
    const admission = await sottoTransaction(instance.database, (tx) =>
      resolveSottoRequest(tx, request)
    );
    if (!admission || admission.kind !== 'content') throw new Error('Missing owner admission');
    return { request, admission };
  }
  async function seed(
    ids: string[],
    extraConsumers: string[] = [],
    extraScopes: Array<{ subjectId: string; generation: number }> = []
  ) {
    return sottoTransaction(instance.database, async (tx) => {
      const location = {
        kind: 'object' as const,
        endpoint: 'https://historical.example',
        bucket: 'old-bucket',
      };
      const backend = prepareStorageBackend(SIDEDOOR_STATE_ID, {
        kind: 'object',
        location,
        binding: storageBackendBinding(location),
        publicUrl: 'https://old-media.example',
      });
      await new StorageBackendRegistry(executor(tx), 'postgres', SIDEDOOR_STATE_ID).register(
        backend
      );
      const current = await sottoStorageInstance(tx).read();
      const profiles = await tx.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, createdAt: true },
      });
      const key = `${randomUUID()}.png`;
      const prepared = prepareStorageReference({
        namespace: SIDEDOOR_STATE_ID,
        operationId: randomUUID(),
        reference: `https://old-media.example/${key}`,
        target: { backendId: backend.id, binding: backend.binding, key },
        scopes: [
          { subjectId: current.subjectId, generation: current.generation },
          ...profiles.map((profile) => ({
            subjectId: `profile:${profile.id}`,
            generation: profile.createdAt.getTime(),
          })),
          ...extraScopes,
        ],
      });
      await new StorageReferenceRegistry(executor(tx), 'postgres', SIDEDOOR_STATE_ID).replaceMany({
        consumers: [...ids.map((id) => `profile:${id}:avatar`), ...extraConsumers].map(
          (consumer) => ({ consumer, previousReference: null })
        ),
        next: prepared,
      });
      await tx.user.updateMany({ where: { id: { in: ids } }, data: { image: prepared.reference } });
      return { prepared, backend };
    });
  }
  it('retains shared consumers and historical destination without mutating storage state', async () => {
    const other = await identity.household('Other');
    const saved = await seed([identity.ownerId, other.id]);
    const authority = await original();
    const before = await instance.database.sidedoorState.findMany({ orderBy: { id: 'asc' } });
    const page = await sottoTransaction(instance.database, (database) =>
      readStorageMigrationAssetPage({ database, ...authority })
    );
    expect(page.issues).toEqual([]);
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]?.source.backend).toEqual(saved.backend);
    expect(page.entries[0]?.claims.map((claim) => claim.consumer).sort()).toEqual(
      [`profile:${identity.ownerId}:avatar`, `profile:${other.id}:avatar`].sort()
    );
    expect(await instance.database.sidedoorState.findMany({ orderBy: { id: 'asc' } })).toEqual(
      before
    );
  });
  it('rolls back all application replacements when a shared consumer changed', async () => {
    const other = await identity.household('Other');
    const saved = await seed([identity.ownerId, other.id]);
    await instance.database.user.update({
      where: { id: other.id },
      data: { image: '/changed.png' },
    });
    await expect(
      sottoTransaction(instance.database, async (tx) => {
        await replaceStorageConsumerReference(
          tx,
          `profile:${identity.ownerId}:avatar`,
          saved.prepared.reference,
          '/new.png'
        );
        await replaceStorageConsumerReference(
          tx,
          `profile:${other.id}:avatar`,
          saved.prepared.reference,
          '/new.png'
        );
      })
    ).rejects.toThrow('Storage consumer changed during publication');
    const result = await sottoTransaction(instance.database, async (tx) => ({
      owner: await readStorageConsumerReference(tx, `profile:${identity.ownerId}:avatar`),
      other: await readStorageConsumerReference(tx, `profile:${other.id}:avatar`),
    }));
    expect(result).toEqual({ owner: saved.prepared.reference, other: '/changed.png' });
  });
  it('rejects unsupported consumer fields without changing application references', async () => {
    const saved = await seed([identity.ownerId]);
    await expect(
      sottoTransaction(instance.database, (tx) =>
        replaceStorageConsumerReference(
          tx,
          `profile:${identity.ownerId}:password`,
          saved.prepared.reference,
          '/new.png'
        )
      )
    ).rejects.toThrow('Unsupported storage consumer');
    expect(
      (await instance.database.user.findUniqueOrThrow({ where: { id: identity.ownerId } })).image
    ).toBe(saved.prepared.reference);
  });
  it('reports stale and unsupported consumers instead of copying part of a shared asset', async () => {
    await seed([identity.ownerId], ['unknown:item:asset']);
    await instance.database.user.update({ where: { id: identity.ownerId }, data: { image: null } });
    const authority = await original();
    const page = await sottoTransaction(instance.database, (database) =>
      readStorageMigrationAssetPage({ database, ...authority })
    );
    expect(page.entries).toEqual([]);
    expect(page.issues.map((issue) => issue.reason).sort()).toEqual([
      'stale-reference',
      'unsupported-consumer',
    ]);
  });
  it.each(['worksheet', 'pronunciation', 'visual'] as const)(
    'retains course ownership for %s references and rejects transfers',
    async (slot) => {
      const curriculum = await instance.database.curriculum.upsert({
        where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'es' } },
        create: { nativeLang: 'en', targetLang: 'es', title: 'Spanish' },
        update: {},
      });
      const course = await instance.database.course.create({
        data: {
          userId: identity.ownerId,
          curriculumId: curriculum.id,
          nativeLang: 'en',
          targetLang: 'es',
        },
      });
      let consumer: string;
      let setReference: (reference: string) => Promise<unknown>;
      if (slot === 'worksheet') {
        const lesson = await instance.database.lesson.create({
          data: {
            curriculumId: curriculum.id,
            level: 'A1',
            order: 0,
            slug: randomUUID(),
            title: 'Lesson',
            objective: 'Test',
            grammarPoints: [],
            vocabThemes: [],
            targetVocab: [],
          },
        });
        const item = await instance.database.courseClass.create({
          data: { courseId: course.id, lessonId: lesson.id, order: 0 },
        });
        consumer = `class:${item.id}:worksheet`;
        setReference = (reference) =>
          instance.database.courseClass.update({
            where: { id: item.id },
            data: { worksheetPdfUrl: reference },
          });
      } else {
        const item = await instance.database.learnerFocusTarget.create({
          data: {
            courseId: course.id,
            kind: 'WORD',
            text: 'hola',
            normalizedText: 'hola',
          },
        });
        consumer = `focus-target:${item.id}:${slot}`;
        setReference = (reference) =>
          instance.database.learnerFocusTarget.update({
            where: { id: item.id },
            data:
              slot === 'visual'
                ? { visualCueUrl: reference }
                : { pronunciationAudioUrl: reference },
          });
      }
      const courseScope = {
        subjectId: `course:${course.id}`,
        generation: course.createdAt.getTime(),
      };
      const saved = await seed([identity.ownerId], [consumer], [courseScope]);
      await setReference(saved.prepared.reference);
      const authority = await original();
      const read = () =>
        sottoTransaction(instance.database, (database) =>
          readStorageMigrationAssetPage({ database, ...authority })
        );
      const before = await read();
      expect(before.issues).toEqual([]);
      expect(
        before.entries[0]?.claims.find((claim) => claim.consumer === consumer)?.requiredScopes
      ).toContainEqual(courseScope);
      const other = await identity.household('New course owner');
      await instance.database.course.update({
        where: { id: course.id },
        data: { userId: other.id },
      });
      expect((await read()).issues).toContainEqual({
        assetId: before.entries[0]!.assetId,
        consumer,
        reason: 'ownership-changed',
      });
      await instance.database.course.update({
        where: { id: course.id },
        data: { userId: identity.ownerId },
      });
      await sottoTransaction(instance.database, (tx) =>
        new StorageWriteJournal(executor(tx), 'postgres', SIDEDOOR_STATE_ID).forbidWrites(
          prepareStorageTombstone({
            namespace: SIDEDOOR_STATE_ID,
            ...courseScope,
            jobId: randomUUID(),
          })
        )
      );
      expect((await read()).issues).toContainEqual({
        assetId: before.entries[0]!.assetId,
        consumer,
        reason: 'ownership-changed',
      });
    }
  );
  it('rejects a logged-out original owner before returning inventory', async () => {
    await seed([identity.ownerId]);
    const authority = await original();
    await identity.access.logout(identity.ownerToken);
    await expect(
      sottoTransaction(instance.database, (database) =>
        readStorageMigrationAssetPage({ database, ...authority })
      )
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });
  it('retains prompt and recording ownership across independent practice and exam parents', async () => {
    const practiceOwner = await identity.household('Recording practice owner');
    const examOwner = await identity.household('Exam owner');
    const recorder = await identity.household('Recorder');
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'es' } },
      create: { nativeLang: 'en', targetLang: 'es', title: 'Spanish' },
      update: {},
    });
    const courses = [];
    for (const userId of [identity.ownerId, practiceOwner.id])
      courses.push(
        await instance.database.course.create({
          data: {
            userId,
            curriculumId: curriculum.id,
            nativeLang: 'en',
            targetLang: 'es',
          },
        })
      );
    const firstCourse = courses[0]!;
    const secondCourse = courses[1]!;
    const practice = await instance.database.practiceSession.create({
      data: {
        courseId: firstCourse.id,
        kind: 'SPEAKING',
        items: [],
        seed: 'prompt',
      },
    });
    const recordingPractice = await instance.database.practiceSession.create({
      data: {
        courseId: secondCourse.id,
        kind: 'SPEAKING',
        items: [],
        seed: 'recording',
      },
    });
    const exam = await instance.database.mockExam.create({
      data: {
        courseId: firstCourse.id,
        userId: examOwner.id,
        institution: 'DELE',
        level: 'A1',
        blueprintId: 'test',
      },
    });
    const section = await instance.database.examSection.create({
      data: {
        examId: exam.id,
        skill: 'SPEAKING',
        part: 'speaking',
        order: 0,
        format: 'speaking',
      },
    });
    const prompt = await instance.database.speakingPrompt.create({
      data: {
        practiceSessionId: practice.id,
        examSectionId: section.id,
        order: 0,
        targetPhrase: 'hola',
        translation: 'hello',
      },
    });
    const recording = await instance.database.speakingRecording.create({
      data: {
        userId: recorder.id,
        promptId: prompt.id,
        practiceSessionId: recordingPractice.id,
        audioUrl: '/pending',
      },
    });
    const consumers = [`speaking-prompt:${prompt.id}:reference`, `recording:${recording.id}:audio`];
    const saved = await seed(
      [identity.ownerId, practiceOwner.id, examOwner.id, recorder.id],
      consumers,
      courses.map((course) => ({
        subjectId: `course:${course.id}`,
        generation: course.createdAt.getTime(),
      }))
    );
    await instance.database.speakingPrompt.update({
      where: { id: prompt.id },
      data: { referenceTtsUrl: saved.prepared.reference },
    });
    await instance.database.speakingRecording.update({
      where: { id: recording.id },
      data: { audioUrl: saved.prepared.reference },
    });
    const authority = await original();
    const page = await sottoTransaction(instance.database, (database) =>
      readStorageMigrationAssetPage({ database, ...authority })
    );
    expect(page.issues).toEqual([]);
    const claim = page.entries[0]?.claims.find((value) => value.consumer === consumers[1]);
    expect(claim?.requiredScopes.map((value) => value.subjectId).sort()).toEqual(
      saved.prepared.scopes.map((value) => value.subjectId).sort()
    );
    const newExamOwner = await identity.household('New exam owner');
    await instance.database.mockExam.update({
      where: { id: exam.id },
      data: { userId: newExamOwner.id },
    });
    const transferred = await sottoTransaction(instance.database, (database) =>
      readStorageMigrationAssetPage({ database, ...authority })
    );
    expect(
      transferred.issues
        .filter((value) => consumers.includes(value.consumer))
        .map((value) => value.reason)
    ).toEqual(['ownership-changed', 'ownership-changed']);
    await instance.database.mockExam.update({
      where: { id: exam.id },
      data: { userId: examOwner.id },
    });
    const before = await sottoTransaction(instance.database, (tx) =>
      captureSpeakingRecordingStorage(tx, recording.id)
    );
    const replacement = await instance.database.practiceSession.create({
      data: {
        courseId: secondCourse.id,
        kind: 'SPEAKING',
        items: [],
        seed: 'replacement',
      },
    });
    await instance.database.speakingRecording.update({
      where: { id: recording.id },
      data: { practiceSessionId: replacement.id },
    });
    const after = await sottoTransaction(instance.database, (tx) =>
      captureSpeakingRecordingStorage(tx, recording.id)
    );
    expect(after.scopes).toEqual(before.scopes);
    expect(after.associations).not.toEqual(before.associations);
    await expect(
      sottoTransaction(instance.database, (tx) =>
        admitSottoStorageCopy(tx, {
          ...authority,
          operationId: randomUUID(),
          entry: page.entries[0]!,
          target: saved.backend.descriptor,
          timeoutMs: 30_000,
        })
      )
    ).rejects.toThrow('Storage copy consumer ownership changed');
    await instance.database.speakingRecording.update({
      where: { id: recording.id },
      data: { sectionId: 'dangling-section' },
    });
    await expect(
      sottoTransaction(instance.database, (tx) => captureSpeakingRecordingStorage(tx, recording.id))
    ).rejects.toBeInstanceOf(SpeakingStorageChangedError);
    const rejected = await sottoTransaction(instance.database, (database) =>
      readStorageMigrationAssetPage({ database, ...authority })
    );
    expect(rejected.entries).toEqual([]);
    expect(rejected.issues).toContainEqual({
      assetId: page.entries[0]!.assetId,
      consumer: consumers[1],
      reason: 'ownership-changed',
    });
  });
  it('keeps remaining consumers after retirement and rejects an erased additional scope', async () => {
    const other = await identity.household('Other');
    const saved = await seed([identity.ownerId, other.id]);
    await sottoTransaction(instance.database, async (tx) => {
      await new StorageReferenceRegistry(executor(tx), 'postgres', SIDEDOOR_STATE_ID).retire({
        operationId: randomUUID(),
        consumer: `profile:${other.id}:avatar`,
        previousReference: saved.prepared.reference,
      });
      await tx.user.update({ where: { id: other.id }, data: { image: null } });
    });
    const authority = await original();
    const before = await sottoTransaction(instance.database, (database) =>
      readStorageMigrationAssetPage({ database, ...authority })
    );
    expect(before.entries).toHaveLength(1);
    expect(before.entries[0]?.claims).toHaveLength(1);
    const scope = saved.prepared.scopes.find((value) => value.subjectId === `profile:${other.id}`)!;
    await sottoTransaction(instance.database, (tx) =>
      new StorageWriteJournal(executor(tx), 'postgres', SIDEDOOR_STATE_ID).forbidWrites(
        prepareStorageTombstone({ namespace: SIDEDOOR_STATE_ID, ...scope, jobId: randomUUID() })
      )
    );
    const after = await sottoTransaction(instance.database, (database) =>
      readStorageMigrationAssetPage({ database, ...authority })
    );
    expect(after.entries).toEqual([]);
    expect(after.issues).toEqual([expect.objectContaining({ reason: 'ownership-changed' })]);
  });
  it('omits fully retired assets from copy candidates', async () => {
    const saved = await seed([identity.ownerId]);
    await sottoTransaction(instance.database, async (tx) => {
      await new StorageReferenceRegistry(executor(tx), 'postgres', SIDEDOOR_STATE_ID).retire({
        operationId: randomUUID(),
        consumer: `profile:${identity.ownerId}:avatar`,
        previousReference: saved.prepared.reference,
      });
      await tx.user.update({ where: { id: identity.ownerId }, data: { image: null } });
    });
    const authority = await original();
    const page = await sottoTransaction(instance.database, (database) =>
      readStorageMigrationAssetPage({ database, ...authority })
    );
    expect(page).toEqual({ entries: [], issues: [], cursor: null });
  });
  it('reports deleted episode parents without aborting the inventory page', async () => {
    const episode = await instance.database.episode.create({
      data: { userId: identity.ownerId, title: 'Test', topic: 'Test' },
    });
    const segment = await instance.database.segment.create({
      data: { episodeId: episode.id, speaker: 'Test', text: 'Test', order: 0 },
    });
    const saved = await seed([], [`segment:${segment.id}:audio`]);
    await instance.database.segment.update({
      where: { id: segment.id },
      data: { audioUrl: saved.prepared.reference },
    });
    await instance.database.episode.update({
      where: { id: episode.id },
      data: { deletedAt: new Date() },
    });
    const authority = await original();
    const page = await sottoTransaction(instance.database, (database) =>
      readStorageMigrationAssetPage({ database, ...authority })
    );
    expect(page.entries).toEqual([]);
    expect(page.issues).toEqual([
      expect.objectContaining({
        consumer: `segment:${segment.id}:audio`,
        reason: 'ownership-changed',
      }),
    ]);
  });
  it('continues across registry pages without losing or repeating assets', async () => {
    const ids = Array.from({ length: 101 }, () => randomUUID());
    await instance.database.user.createMany({
      data: ids.map((id) => ({ id, name: 'Inventory profile', email: `${id}@inventory.invalid` })),
    });
    for (const id of ids) await seed([id]);
    const authority = await original();
    const first = await sottoTransaction(instance.database, (database) =>
      readStorageMigrationAssetPage({ database, ...authority })
    );
    expect(first.entries).toHaveLength(100);
    expect(first.issues).toEqual([]);
    expect(first.cursor).not.toBeNull();
    const second = await sottoTransaction(instance.database, (database) =>
      readStorageMigrationAssetPage({ database, ...authority, after: first.cursor })
    );
    expect(second.entries).toHaveLength(1);
    expect(second.issues).toEqual([]);
    expect(second.cursor).toBeNull();
    expect(new Set([...first.entries, ...second.entries].map((entry) => entry.assetId)).size).toBe(
      101
    );
    const references = await sottoTransaction(instance.database, (database) =>
      readStorageMigrationReferencePage({ database, ...authority })
    );
    expect(references.references).toHaveLength(100);
    expect(references.references.every((value) => value.attribution === 'registered')).toBe(true);
    const remainder = await sottoTransaction(instance.database, (database) =>
      readStorageMigrationReferencePage({ database, ...authority, after: references.cursor })
    );
    expect(remainder.references).toHaveLength(1);
    expect(remainder.cursor).toBeNull();
    expect(
      new Set([...references.references, ...remainder.references].map((value) => value.assetId))
        .size
    ).toBe(101);
  });
  it('reports unregistered application files and external URLs without assuming their backend', async () => {
    await seed([identity.ownerId]);
    const episode = await instance.database.episode.create({
      data: {
        userId: identity.ownerId,
        title: 'Existing files',
        topic: 'Test',
        audioUrl: '/api/storage/episodes/old.mp3',
        pdfUrl: 'https://external.example/document.pdf',
        waveformUrl: '',
      },
    });
    const authority = await original();
    const before = await instance.database.sidedoorState.findMany({ orderBy: { id: 'asc' } });
    const page = await sottoTransaction(instance.database, (database) =>
      readStorageMigrationReferencePage({ database, ...authority })
    );
    expect(page.references.filter((value) => value.id === episode.id)).toEqual([
      expect.objectContaining({ field: 'audioUrl', attribution: 'unregistered', assetId: null }),
      expect.objectContaining({ field: 'pdfUrl', attribution: 'unregistered', assetId: null }),
      expect.objectContaining({
        field: 'waveformUrl',
        reference: '',
        attribution: 'unregistered',
        assetId: null,
      }),
    ]);
    expect(page.references.find((value) => value.id === identity.ownerId)).toMatchObject({
      attribution: 'registered',
    });
    expect(await instance.database.sidedoorState.findMany({ orderBy: { id: 'asc' } })).toEqual(
      before
    );
  });
  it('reports a copied URL without granting another consumer ownership or losing valid rows', async () => {
    const saved = await seed([identity.ownerId]);
    const other = await identity.household('Other');
    await instance.database.user.update({
      where: { id: other.id },
      data: { image: saved.prepared.reference },
    });
    const authority = await original();
    const page = await sottoTransaction(instance.database, (database) =>
      readStorageMigrationReferencePage({ database, ...authority })
    );
    expect(page.references).toHaveLength(2);
    expect(page.references.find((row) => row.id === other.id)).toMatchObject({
      attribution: 'mismatched-consumer',
      assetId: null,
    });
    expect(page.references.find((row) => row.id === identity.ownerId)).toMatchObject({
      attribution: 'registered',
    });
  });
  it('summarizes dry-run candidates and blockers without initializing storage or changing configuration', async () => {
    await seed([identity.ownerId]);
    await instance.database.episode.create({
      data: {
        userId: identity.ownerId,
        title: 'Unregistered',
        topic: 'Test',
        audioUrl: '/api/storage/old.mp3',
      },
    });
    const parent = await mkdtemp(join(tmpdir(), 'sotto-migration-dry-'));
    const authority = await original();
    const before = await instance.database.sidedoorState.findMany({ orderBy: { id: 'asc' } });
    try {
      vi.stubEnv('LOCAL_STORAGE_DIR', join(parent, 'new-root'));
      const result = await planSottoStorageMigration({
        database: instance.database,
        ...authority,
        target: { ...configuration, storageProvider: 'local' },
        configuration,
      });
      expect(result).toMatchObject({
        sourceProvider: 'r2',
        targetProvider: 'local',
        scanned: 2,
        migrated: 1,
        failed: 1,
        switched: false,
        hasBlockers: true,
      });
      expect(result.errors).toEqual([
        expect.objectContaining({ field: 'Episode.audioUrl', error: 'unregistered' }),
      ]);
      expect(await readdir(parent)).toEqual([]);
      expect(await instance.database.sidedoorState.findMany({ orderBy: { id: 'asc' } })).toEqual(
        before
      );
    } finally {
      vi.unstubAllEnvs();
      await rm(parent, { recursive: true, force: true });
    }
  });
  it('keeps the plan blocked by an orphaned sibling even when all remaining references are candidates', async () => {
    const other = await identity.household('Other');
    await seed([identity.ownerId, other.id]);
    await instance.database.user.update({ where: { id: other.id }, data: { image: null } });
    const result = await planSottoStorageMigration({
      database: instance.database,
      ...(await original()),
      configuration,
      target: { ...configuration, storageProvider: 'local' },
    });
    expect(result).toMatchObject({
      scanned: 1,
      migrated: 1,
      failed: 0,
      inventoryIssueCount: 1,
      hasBlockers: true,
    });
    expect(result.inventoryIssues).toEqual([
      expect.objectContaining({
        consumer: `profile:${other.id}:avatar`,
        reason: 'stale-reference',
      }),
    ]);
  });
});
