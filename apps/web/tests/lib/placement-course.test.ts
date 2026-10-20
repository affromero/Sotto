// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { createInitialCourse, createOrRaiseCourse } from '@/lib/placement-course';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('owned initial course placement against PostgreSQL', () => {
  let instance: SharedTestInstance;
  let userId: string;
  let curriculumId: string;
  beforeAll(async () => {
    instance = await createSharedTestInstance('initial_course_placement');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    userId = (await instance.reset()).ownerId;
    curriculumId = (
      await instance.database.curriculum.upsert({
        where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
        create: { nativeLang: 'en', targetLang: 'de', title: 'Owned German placement' },
        update: {},
      })
    ).id;
  });
  afterAll(async () => {
    boundary.database = null;
    await instance?.close();
  });
  const execution = () => ({ userId, authorize: async () => ({ userId }) });
  const input = () => ({
    userId,
    native: 'en',
    target: 'de',
    curriculumId,
    level: 'A2' as const,
    source: 'MANUAL' as const,
  });
  const create = () =>
    sottoTransaction(instance.database, (database) =>
      createInitialCourse(database, input(), execution())
    );
  it('pins the initial requirement band with captured provider exemptions and no earned completion', async () => {
    const course = await create();
    expect(course.currentLevel).toBe('A2');
    expect(course.startLevel).toBe('A2');
    expect(course.placementSource).toBe('MANUAL');
    const binding = await instance.database.learningLevelBinding.findUniqueOrThrow({
      where: { courseId_level: { courseId: course.id, level: 'A2' } },
    });
    expect(binding.coverage).toMatchObject({
      scope: 'CLASS',
      level: 'A2',
      skills: {
        LISTENING: { state: 'EXEMPT_NO_PROVIDER' },
        SPEAKING: { state: 'EXEMPT_NO_PROVIDER' },
      },
    });
    expect(await instance.database.learningLevelCompletion.count()).toBe(0);
  });
  it.each(['MANUAL', 'NOTES', 'TEST'] as const)(
    'preserves an existing course level and placement provenance after %s reassessment',
    async (source) => {
      const first = await create();
      const result = await createOrRaiseCourse(userId, execution(), 'en', 'de', 'C2', source);
      expect(result.id).toBe(first.id);
      expect(result.currentLevel).toBe('A2');
      expect(result.startLevel).toBe('A2');
      expect(result.placementSource).toBe('MANUAL');
      expect(
        await instance.database.learningLevelBinding.count({ where: { courseId: first.id } })
      ).toBe(1);
      expect(await instance.database.learningLevelCompletion.count()).toBe(0);
    }
  );
  it('rolls course, pinned coverage and attachment writes back together when confirmation fails', async () => {
    await expect(
      sottoTransaction(instance.database, async (database) => {
        const course = await createInitialCourse(database, input(), execution());
        await database.courseNote.create({
          data: { courseId: course.id, body: 'Owned note awaiting atomic confirmation' },
        });
        throw new Error('Synthetic confirmation conflict');
      })
    ).rejects.toThrow('Synthetic confirmation conflict');
    expect(await instance.database.course.count()).toBe(0);
    expect(await instance.database.learningLevelBinding.count()).toBe(0);
    expect(await instance.database.courseNote.count()).toBe(0);
  });
  it('rejects a changed recipient and a mismatched curriculum before creating a course', async () => {
    await expect(
      sottoTransaction(instance.database, (database) =>
        createInitialCourse(database, { ...input(), userId: 'foreign-owner' }, execution())
      )
    ).rejects.toThrow('recipient changed');
    await expect(
      sottoTransaction(instance.database, (database) =>
        createInitialCourse(database, { ...input(), target: 'es' }, execution())
      )
    ).rejects.toThrow('curriculum does not match');
    expect(await instance.database.course.count()).toBe(0);
  });
  it('serializes competing initial placements into one course and one pinned band', async () => {
    const [first, second] = await Promise.all([
      create(),
      sottoTransaction(instance.database, (database) =>
        createInitialCourse(database, { ...input(), level: 'B1', source: 'NOTES' }, execution())
      ),
    ]);
    expect(first.id).toBe(second.id);
    expect(first.currentLevel).toBe(second.currentLevel);
    expect(await instance.database.course.count()).toBe(1);
    const bindings = await instance.database.learningLevelBinding.findMany({
      where: { courseId: first.id },
    });
    expect(bindings).toHaveLength(1);
    expect(bindings[0].level).toBe(first.currentLevel);
  });
  it('preserves supported course placement when a language map is explicitly unavailable', async () => {
    const curriculum = await instance.database.curriculum.create({
      data: { nativeLang: 'en', targetLang: 'pl', title: 'Polish without a published map' },
    });
    const course = await sottoTransaction(instance.database, (database) =>
      createInitialCourse(
        database,
        { ...input(), target: 'pl', curriculumId: curriculum.id },
        execution()
      )
    );
    expect(course.currentLevel).toBe('A2');
    expect(course.targetLang).toBe('pl');
    expect(await instance.database.learningLevelBinding.count()).toBe(0);
  });
});
