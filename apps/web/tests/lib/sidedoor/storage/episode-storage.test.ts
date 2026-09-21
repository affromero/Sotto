// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { StorageWriteJournal, prepareStorageTombstone } from 'thesidedoor-core/storage';
import {
  captureEpisodeStorage,
  validateEpisodeStorage,
  EpisodeStorageChangedError,
} from '@/lib/sidedoor/storage/core/episode-storage';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../../helpers/setup/shared-instance';

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('episode storage erasure scopes', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('episode_storage');
  });
  beforeEach(async () => {
    identity = await instance.reset();
  });
  afterAll(async () => {
    await instance?.close();
  });
  async function episode() {
    return instance.database.episode.create({
      data: { userId: identity.ownerId, title: 'Lesson', topic: 'Topic' },
    });
  }
  const capture = (id: string) =>
    sottoTransaction(instance.database, (tx) => captureEpisodeStorage(tx, id));
  it('accepts unchanged ownership after PostgreSQL JSONB reorders stored object keys', async () => {
    const item = await episode();
    const before = await capture(item.id);
    const stored = await instance.database.$queryRawUnsafe<Array<{ value: typeof before }>>(
      'SELECT $1::jsonb AS value',
      JSON.stringify(before)
    );
    await expect(
      sottoTransaction(instance.database, (tx) =>
        validateEpisodeStorage(tx, item.id, stored[0]!.value)
      )
    ).resolves.toBeUndefined();
  });
  it('includes instance, episode and owner generations and rejects a transferred episode', async () => {
    const item = await episode();
    const before = await capture(item.id);
    expect(before.scopes).toEqual(
      expect.arrayContaining([
        { subjectId: `episode:${item.id}`, generation: item.createdAt.getTime() },
        expect.objectContaining({ subjectId: `profile:${identity.ownerId}` }),
      ])
    );
    expect(before.scopes).toHaveLength(3);
    const other = await identity.household('Other');
    await instance.database.episode.update({ where: { id: item.id }, data: { userId: other.id } });
    await expect(
      sottoTransaction(instance.database, (tx) => validateEpisodeStorage(tx, item.id, before))
    ).rejects.toBeInstanceOf(EpisodeStorageChangedError);
  });
  it('detects a newly attached course and protects its separate owner', async () => {
    const item = await episode();
    const before = await capture(item.id);
    const other = await identity.household('Course owner');
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'es' } },
      create: { nativeLang: 'en', targetLang: 'es', title: 'Spanish' },
      update: {},
    });
    const course = await instance.database.course.create({
      data: { userId: other.id, curriculumId: curriculum.id, nativeLang: 'en', targetLang: 'es' },
    });
    await instance.database.practiceSession.create({
      data: { courseId: course.id, episodeId: item.id, kind: 'LISTENING', items: [], seed: 'test' },
    });
    await expect(
      sottoTransaction(instance.database, (tx) => validateEpisodeStorage(tx, item.id, before))
    ).rejects.toBeInstanceOf(EpisodeStorageChangedError);
    const current = await capture(item.id);
    expect(current.scopes).toEqual(
      expect.arrayContaining([
        { subjectId: `course:${course.id}`, generation: course.createdAt.getTime() },
        expect.objectContaining({ subjectId: `profile:${other.id}` }),
      ])
    );
    expect(current.scopes).toHaveLength(5);
  });
  it('rejects an erased scope even while its source rows still exist', async () => {
    const item = await episode();
    const before = await capture(item.id);
    const scope = before.scopes.find((entry) => entry.subjectId === `episode:${item.id}`)!;
    await sottoTransaction(instance.database, (tx) =>
      new StorageWriteJournal(
        {
          query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        },
        'postgres',
        SIDEDOOR_STATE_ID
      ).forbidWrites(
        prepareStorageTombstone({ namespace: SIDEDOOR_STATE_ID, ...scope, jobId: randomUUID() })
      )
    );
    await expect(capture(item.id)).rejects.toBeInstanceOf(EpisodeStorageChangedError);
  });
  it('protects the exam owner independently of the episode and course owners', async () => {
    const item = await episode();
    const courseOwner = await identity.household('Course owner');
    const examOwner = await identity.household('Exam owner');
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'es' } },
      create: { nativeLang: 'en', targetLang: 'es', title: 'Spanish' },
      update: {},
    });
    const course = await instance.database.course.create({
      data: {
        userId: courseOwner.id,
        curriculumId: curriculum.id,
        nativeLang: 'en',
        targetLang: 'es',
      },
    });
    const exam = await instance.database.mockExam.create({
      data: {
        userId: examOwner.id,
        courseId: course.id,
        institution: 'DELE',
        level: 'A1',
        blueprintId: 'test',
      },
    });
    await instance.database.examSection.create({
      data: {
        examId: exam.id,
        episodeId: item.id,
        skill: 'LISTENING',
        part: 'listening',
        order: 0,
        format: 'listening',
      },
    });
    const captured = await capture(item.id);
    const profile = await instance.database.user.findUniqueOrThrow({ where: { id: examOwner.id } });
    const scope = { subjectId: `profile:${examOwner.id}`, generation: profile.createdAt.getTime() };
    expect(captured.scopes).toContainEqual(scope);
    expect(captured.scopes).toHaveLength(6);
    await instance.database.mockExam.update({
      where: { id: exam.id },
      data: { userId: courseOwner.id },
    });
    await expect(
      sottoTransaction(instance.database, (tx) => validateEpisodeStorage(tx, item.id, captured))
    ).rejects.toBeInstanceOf(EpisodeStorageChangedError);
    expect((await capture(item.id)).scopes).toHaveLength(5);
    await instance.database.mockExam.update({
      where: { id: exam.id },
      data: { userId: examOwner.id },
    });
    await sottoTransaction(instance.database, (tx) =>
      new StorageWriteJournal(
        {
          query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        },
        'postgres',
        SIDEDOOR_STATE_ID
      ).forbidWrites(
        prepareStorageTombstone({
          namespace: SIDEDOOR_STATE_ID,
          ...scope,
          jobId: randomUUID(),
        })
      )
    );
    await expect(capture(item.id)).rejects.toBeInstanceOf(EpisodeStorageChangedError);
  });
  it("includes a separate content contributor and checks that contributor's erasure tombstone", async () => {
    const item = await episode();
    const other = await identity.household('Contributor');
    const before = await sottoTransaction(instance.database, (tx) =>
      captureEpisodeStorage(tx, item.id, [other.id, other.id])
    );
    expect(before.scopes).toHaveLength(4);
    const scope = before.scopes.find((entry) => entry.subjectId === `profile:${other.id}`)!;
    expect(scope).toBeDefined();
    await sottoTransaction(instance.database, (tx) =>
      new StorageWriteJournal(
        { query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
        'postgres',
        SIDEDOOR_STATE_ID
      ).forbidWrites(
        prepareStorageTombstone({ namespace: SIDEDOOR_STATE_ID, ...scope, jobId: randomUUID() })
      )
    );
    await expect(
      sottoTransaction(instance.database, (tx) =>
        validateEpisodeStorage(tx, item.id, before, [other.id])
      )
    ).rejects.toBeInstanceOf(EpisodeStorageChangedError);
    expect(await instance.database.user.findUnique({ where: { id: other.id } })).not.toBeNull();
  });
});
