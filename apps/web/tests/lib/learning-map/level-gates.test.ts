// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { learningMapResponseSchema, learningLevelCompletionSchema } from '@sotto/shared';
import type { PrismaClient, CefrLevel } from '@/generated/prisma/client';
import { GET as map } from '@/app/api/v1/courses/[courseId]/learning-map/route';
import { GET as requirements } from '@/app/api/v1/courses/[courseId]/learning-map/levels/[level]/route';
import { POST as advance } from '@/app/api/v1/courses/[courseId]/learning-map/advance/route';
import { createInitialCourse } from '@/lib/placement-course';
import { createNextClass } from '@/lib/class-service';
import { getLanguageCatalog } from '@/lib/learning-map/catalogs';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('current-band class and advancement gates over HTTP and PostgreSQL', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let curriculumId: string;
  let course: Awaited<ReturnType<typeof createInitialCourse>>;
  beforeAll(async () => {
    instance = await createSharedTestInstance('learning_level_http');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
    vi.stubEnv('SIDEDOOR_TRUSTED_PROXY', 'false');
    identity = await instance.reset();
    curriculumId = (
      await instance.database.curriculum.upsert({
        where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
        create: { nativeLang: 'en', targetLang: 'de', title: 'German gating fixture' },
        update: {},
      })
    ).id;
    course = await initial('A2');
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    boundary.database = null;
    await instance?.close();
  });
  const execution = () => ({
    userId: identity.ownerId,
    authorize: async () => ({ userId: identity.ownerId }),
  });
  function initial(level: CefrLevel) {
    return sottoTransaction(instance.database, (database) =>
      createInitialCourse(
        database,
        {
          userId: identity.ownerId,
          native: 'en',
          target: 'de',
          curriculumId,
          level,
          source: 'MANUAL',
        },
        execution()
      )
    );
  }
  function request(
    body?: unknown,
    token = identity.ownerToken,
    origin = 'http://localhost:3000',
    query = ''
  ) {
    return new NextRequest(
      `http://localhost:3000/api/v1/courses/${course.id}/learning-map${query}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers: { cookie: `sotto_session=${token}`, origin, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }
    );
  }
  const params = () => ({ params: Promise.resolve({ courseId: course.id }) });
  async function read() {
    const response = await map(request(), params());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    return learningMapResponseSchema.parse(await response.json());
  }
  async function lesson(level: CefrLevel, order: number) {
    return instance.database.lesson.upsert({
      where: { curriculumId_order: { curriculumId, order } },
      create: {
        curriculumId,
        slug: `gate-${level}-${order}`,
        level,
        order,
        title: `${level} task`,
        objective: 'Arrange a specific meeting.',
        grammarPoints: [],
        vocabThemes: [],
        targetVocab: [],
      },
      update: {},
    });
  }
  async function mastered() {
    const level = course.currentLevel;
    const catalog = getLanguageCatalog('de');
    const objectives = catalog.nodes.filter(
      (node) => node.kind === 'OBJECTIVE' && node.level === level
    );
    await instance.database.learnerObjectiveState.createMany({
      data: objectives.flatMap((objective) =>
        objective.kind === 'OBJECTIVE'
          ? objective.skills
              .filter((skill) => skill !== 'LISTENING' && skill !== 'SPEAKING')
              .map((skill) => ({
                courseId: course.id,
                objectiveId: objective.id,
                criterionVersion: objective.criterionVersion,
                policyVersion: objective.policyVersion,
                level,
                skill,
                mastery: 0.99,
                assessedTasks: 8,
                assessedSessions: 3,
                lastQuality: 1,
                lastReviewed: new Date(),
              }))
          : []
      ),
    });
  }
  it('keeps a lower-band active class and its saved work intact', async () => {
    const lower = await lesson('A1', 1);
    const active = await instance.database.courseClass.create({
      data: {
        courseId: course.id,
        lessonId: lower.id,
        order: 1,
        status: 'IN_PROGRESS',
        learnerAnswers: { q1: 2 },
      },
    });
    await instance.database.course.update({
      where: { id: course.id },
      data: { activeClassId: active.id },
    });
    expect(await createNextClass(course.id, identity.ownerId, execution())).toEqual({
      kind: 'gated',
      activeClassId: active.id,
      status: 'IN_PROGRESS',
    });
    expect(
      (await instance.database.courseClass.findUniqueOrThrow({ where: { id: active.id } }))
        .learnerAnswers
    ).toEqual({ q1: 2 });
    expect(
      (await instance.database.course.findUniqueOrThrow({ where: { id: course.id } })).activeClassId
    ).toBe(active.id);
  });
  it('returns remaining requirements when current-band lessons are passed without selecting a future lesson', async () => {
    const current = await lesson('A2', 2);
    await lesson('B1', 3);
    await instance.database.courseClass.create({
      data: { courseId: course.id, lessonId: current.id, order: 2, status: 'PASSED' },
    });
    expect(await createNextClass(course.id, identity.ownerId, execution())).toEqual({
      kind: 'requirements',
    });
    expect(await instance.database.courseClass.count({ where: { courseId: course.id } })).toBe(1);
    expect(
      (await instance.database.course.findUniqueOrThrow({ where: { id: course.id } })).currentLevel
    ).toBe('A2');
  });
  it('reads current, lower and future requirements without changing the active band or creating bindings', async () => {
    const current = await read();
    expect(current.readiness.ready).toBe(false);
    expect(current.coverage?.level).toBe('A2');
    for (const level of ['A1', 'B1'] as const) {
      const response = await requirements(request(), {
        params: Promise.resolve({ courseId: course.id, level }),
      });
      const viewed = learningMapResponseSchema.parse(await response.json());
      expect(viewed.currentLevel).toBe('A2');
      expect(viewed.viewedLevel).toBe(level);
      expect(viewed.completedAt).toBeNull();
    }
    expect(
      await instance.database.learningLevelBinding.count({ where: { courseId: course.id } })
    ).toBe(1);
  });
  it('rejects unknown evidence, foreign ownership, stale identities and cross-origin advancement', async () => {
    const current = await read();
    const input = {
      requestId: randomUUID(),
      expectedLevel: 'A2',
      catalogHash: current.catalogHash,
    };
    const response = await advance(request(input), params());
    expect(response.status).toBe(409);
    expect(await response.text()).toContain('remaining required objectives');
    expect((await advance(request({ ...input, expectedLevel: 'B1' }), params())).status).toBe(409);
    expect(
      (await advance(request({ ...input, catalogHash: '0'.repeat(64) }), params())).status
    ).toBe(409);
    expect(
      (await advance(request(input, identity.ownerToken, 'https://foreign.example'), params()))
        .status
    ).toBe(403);
    const foreign = await identity.household('Another learner');
    expect((await map(request(undefined, foreign.token), params())).status).toBe(404);
    expect((await advance(request(input, foreign.token), params())).status).toBe(404);
    expect(
      (
        await map(
          request(undefined, identity.ownerToken, 'http://localhost:3000', '?level=INVALID'),
          params()
        )
      ).status
    ).toBe(400);
    expect(await instance.database.learningLevelCompletion.count()).toBe(0);
  });
  it('rechecks an unfinished class before advancement and records exactly one accepted band transition', async () => {
    await mastered();
    const activeLesson = await lesson('A2', 2);
    const active = await instance.database.courseClass.create({
      data: { courseId: course.id, lessonId: activeLesson.id, order: 2, status: 'IN_PROGRESS' },
    });
    const current = await read();
    expect(current.readiness.ready).toBe(true);
    expect(current.blockers).not.toHaveLength(0);
    const input = {
      requestId: randomUUID(),
      expectedLevel: 'A2',
      catalogHash: current.catalogHash,
    };
    expect((await advance(request(input), params())).status).toBe(409);
    await instance.database.courseClass.update({
      where: { id: active.id },
      data: { status: 'PASSED' },
    });
    const first = await advance(request(input), params());
    expect(first.status).toBe(200);
    const receipt = learningLevelCompletionSchema.parse(await first.json());
    expect(receipt.currentLevel).toBe('B1');
    expect(receipt.level).toBe('A2');
    const repeated = await advance(request(input), params());
    expect(await repeated.json()).toEqual(receipt);
    expect(await instance.database.learningLevelCompletion.count()).toBe(1);
    expect(
      await instance.database.learningLevelBinding.count({ where: { courseId: course.id } })
    ).toBe(2);
    expect((await read()).readiness.ready).toBe(false);
  });
});
