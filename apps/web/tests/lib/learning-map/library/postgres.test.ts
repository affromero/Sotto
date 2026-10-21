// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSkillRequirements,
  courseAnalysisListSchema,
  learningObjectiveHistorySchema,
} from '@sotto/shared';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../../helpers/setup/shared-instance';
import { ensureLearningLevelBinding } from '@/lib/learning-map/binding';
import { getLanguageCatalog } from '@/lib/learning-map/catalogs';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { GET as analyses } from '@/app/api/v1/courses/[courseId]/material-analyses/route';
import { GET as history } from '@/app/api/v1/courses/[courseId]/learning-map/objectives/[objectiveId]/history/route';
import { GET as objective } from '@/app/api/v1/courses/[courseId]/learning-map/objectives/[objectiveId]/route';
const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('owned learning library reads through HTTP and PostgreSQL', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('learning_library');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    identity = await instance.reset();
    vi.stubGlobal('fetch', async () => {
      throw new Error('Library reads must not dispatch provider work.');
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    boundary.database = null;
    await instance?.close();
  });
  async function fixture() {
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
      create: { nativeLang: 'en', targetLang: 'de', title: 'Library fixture' },
      update: {},
    });
    const course = await instance.database.course.create({
      data: {
        userId: identity.ownerId,
        curriculumId: curriculum.id,
        nativeLang: 'en',
        targetLang: 'de',
        startLevel: 'A2',
        currentLevel: 'A2',
      },
    });
    const binding = await sottoTransaction(instance.database, (database) =>
      ensureLearningLevelBinding(
        database,
        course,
        'A2',
        createSkillRequirements({
          scope: 'CLASS',
          nativeLang: 'en',
          targetLang: 'de',
          level: 'A2',
          ttsProvider: null,
          sttProvider: null,
        })
      )
    );
    const entry = getLanguageCatalog('de').nodes.find(
      (node) => node.kind === 'OBJECTIVE' && node.level === 'A2' && node.branch === 'GRAMMAR'
    );
    if (entry?.kind !== 'OBJECTIVE') throw new Error('Missing concrete grammar criterion.');
    return { course, binding, entry };
  }
  const request = (path: string, token = identity.ownerToken) =>
    new NextRequest(`http://localhost:3000/api/v1/${path}`, {
      headers: { cookie: `sotto_session=${token}` },
    });
  it('paginates tied-time source analyses without exposing a foreign course or skipping receipts', async () => {
    const { course } = await fixture();
    const at = new Date('2026-10-20T12:00:00.000Z');
    const ids = Array.from({ length: 25 }, () => randomUUID())
      .sort()
      .reverse();
    const resultBytes = Buffer.from('{}');
    const digest = createHash('sha256').update(resultBytes).digest('hex');
    await instance.database.materialAnalysis.createMany({
      data: ids.map((id, index) => ({
        id,
        userId: identity.ownerId,
        userGeneration: 1n,
        nativeLang: 'en',
        targetLang: 'de',
        intendedCourseId: course.id,
        attachedCourseId: course.id,
        purpose: 'COURSE_IMPORT',
        requestId: randomUUID(),
        admissionDigest: String(index).padStart(64, '0'),
        sourceSetDigest: String(index).padStart(64, '0'),
        policy: {},
        status: 'COMPLETE',
        createdAt: at,
        completedAt: at,
        resultBytes,
        resultDigest: digest,
      })),
    });
    const params = { params: Promise.resolve({ courseId: course.id }) };
    const firstResponse = await analyses(request(`courses/${course.id}/material-analyses`), params);
    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers.get('cache-control')).toBe('private, no-store');
    const first = courseAnalysisListSchema.parse(await firstResponse.json());
    expect(first.items.map((row) => row.analysisId)).toEqual(ids.slice(0, 20));
    const second = courseAnalysisListSchema.parse(
      await (
        await analyses(
          request(
            `courses/${course.id}/material-analyses?after=${encodeURIComponent(first.nextCursor!)}`
          ),
          params
        )
      ).json()
    );
    expect(second.items.map((row) => row.analysisId)).toEqual(ids.slice(20));
    expect(second.nextCursor).toBeNull();
    const foreign = await identity.household('Foreign library reader');
    expect(
      (await analyses(request(`courses/${course.id}/material-analyses`, foreign.token), params))
        .status
    ).toBe(404);
    expect(
      (await analyses(request(`courses/${course.id}/material-analyses?after=invalid`), params))
        .status
    ).toBe(400);
  });
  it('paginates exact criterion evidence without changing projections, granting source credit or mixing revisions', async () => {
    const { course, binding, entry } = await fixture();
    const at = new Date('2026-10-20T12:00:00.000Z');
    const ids = Array.from(
      { length: 55 },
      (_, index) => `observation-${String(index).padStart(3, '0')}`
    ).reverse();
    await instance.database.learningObservation.createMany({
      data: ids.map((id, index) => ({
        id,
        deduplicationKey: id,
        courseId: course.id,
        objectiveId: entry.id,
        criterionVersion: entry.criterionVersion,
        policyVersion: entry.policyVersion,
        level: 'A2',
        skill: 'GRAMMAR',
        revisionId: binding.revisionId,
        sourceType: 'PRACTICE_QUESTION',
        sessionId: `practice-${index}`,
        taskId: `task-${index}`,
        responseIdentity: `response-${index}`,
        quality: index % 2 ? 0.5 : 1,
        evidence: {
          assessment: entry.skillCriteria.GRAMMAR!,
          rationale: `The learner independently answered exact task ${index}.`,
        },
        observedAt: at,
      })),
    });
    await instance.database.learningObservation.create({
      data: {
        deduplicationKey: 'obsolete',
        courseId: course.id,
        objectiveId: entry.id,
        criterionVersion: entry.criterionVersion + 1,
        policyVersion: entry.policyVersion,
        level: 'A2',
        skill: 'GRAMMAR',
        revisionId: binding.revisionId,
        sourceType: 'PRACTICE_QUESTION',
        sessionId: 'obsolete',
        taskId: 'obsolete',
        responseIdentity: 'obsolete',
        quality: 1,
        evidence: {
          assessment: 'Different criterion.',
          rationale: 'Different criterion revision.',
        },
        observedAt: at,
      },
    });
    const params = {
      params: Promise.resolve({ courseId: course.id, objectiveId: entry.id }),
    };
    const path = `courses/${course.id}/learning-map/objectives/${encodeURIComponent(entry.id)}`;
    const detail = await objective(request(`${path}?level=A2`), params);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      objective: { id: entry.id },
      progress: { status: 'NOT_ASSESSED' },
    });
    const first = learningObjectiveHistorySchema.parse(
      await (await history(request(`${path}/history?level=A2`), params)).json()
    );
    expect(first.items.map((row) => row.id)).toEqual(ids.slice(0, 50));
    const last = learningObjectiveHistorySchema.parse(
      await (
        await history(
          request(`${path}/history?level=A2&after=${encodeURIComponent(first.nextCursor!)}`),
          params
        )
      ).json()
    );
    expect(last.items.map((row) => row.id)).toEqual(ids.slice(50));
    expect(last.nextCursor).toBeNull();
    expect(
      await instance.database.learnerObjectiveState.count({
        where: { courseId: course.id },
      })
    ).toBe(0);
    expect(
      (
        await instance.database.course.findUniqueOrThrow({
          where: { id: course.id },
        })
      ).currentLevel
    ).toBe('A2');
    const foreign = await identity.household('Foreign evidence reader');
    expect((await history(request(`${path}/history?level=A2`, foreign.token), params)).status).toBe(
      404
    );
  });
});
