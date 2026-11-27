// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCurriculum } from '../../prisma/curricula/schema';
import { seedCurriculum } from '../../prisma/curricula/seed';
import { createSharedTestInstance } from '../helpers/setup/shared-instance';

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;

suite('additive curriculum seeding', () => {
  let instance: Awaited<ReturnType<typeof createSharedTestInstance>>;
  beforeAll(async () => {
    instance = await createSharedTestInstance('additive_seed');
  });
  afterAll(async () => {
    await instance?.close();
  });

  it('adds only the admitted pair, safely repeats, and refuses changed rows', async () => {
    const { database } = instance;
    const german = loadCurriculum('de-from-en');
    const spanish = loadCurriculum('es-from-en');
    const prior = await seedCurriculum(database, german);
    const snapshot = (id: string) =>
      database.curriculum.findUniqueOrThrow({
        where: { id },
        include: { lessons: { orderBy: { order: 'asc' }, include: { learningObjectives: true } } },
      });
    const before = await snapshot(prior.curriculumId);
    const addedId = 'review-en-es-v1';
    const added = await seedCurriculum(database, spanish, addedId);
    expect(added).toMatchObject({
      curriculumId: addedId,
      lessons: spanish.lessons.length,
      status: 'PUBLISHED',
    });
    expect(added.mapped).toBeGreaterThan(0);
    const revision = await database.learningMapRevision.findFirstOrThrow({
      where: { targetLang: 'es' },
    });
    expect(added.catalogRevision).toEqual({
      version: revision.version,
      hash: revision.catalogHash,
    });
    expect(await snapshot(prior.curriculumId)).toEqual(before);
    expect(await database.curriculum.count()).toBe(2);
    const seeded = await snapshot(addedId);
    expect(JSON.stringify(await seedCurriculum(database, spanish, addedId))).toBe(
      JSON.stringify(added)
    );
    expect(await snapshot(addedId)).toEqual(seeded);
    await expect(seedCurriculum(database, spanish, 'wrong-id')).rejects.toThrow(
      'Existing curriculum differs from admitted additive seed.'
    );
    await database.lesson.update({
      where: { id: seeded.lessons[0].id },
      data: { title: 'A local title' },
    });
    await expect(seedCurriculum(database, spanish, addedId)).rejects.toThrow(
      'Existing lessons differ from admitted additive seed.'
    );
    expect((await snapshot(addedId)).lessons[0].title).toBe('A local title');
    expect(await snapshot(prior.curriculumId)).toEqual(before);
  });

  it('rolls back the new pair and lessons if catalog publication is refused', async () => {
    const { database } = instance;
    const curriculum = loadCurriculum('en-from-es');
    const before = await database.lesson.count();
    await database.learningMapRevision.create({
      data: { targetLang: 'en', version: 1, catalogHash: '0'.repeat(64), definition: {} },
    });
    await expect(seedCurriculum(database, curriculum, 'review-es-en-v1')).rejects.toThrow();
    expect(await database.curriculum.findUnique({ where: { id: 'review-es-en-v1' } })).toBeNull();
    expect(await database.lesson.count()).toBe(before);
  });
});
