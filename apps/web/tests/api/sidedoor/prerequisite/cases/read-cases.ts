import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import {
  classPreludeResponseSchema,
  classFocusSnapshotSchema,
  classPrerequisiteResponseSchema,
} from '@sotto/shared';
import {
  initialA1MaterialHash,
  readClassTeachingPreludeInTransaction,
} from '@/lib/classes/lesson/initial-a1-provenance';
import { createPrerequisiteTokenizer } from '@/lib/classes/help/content/prerequisite-token';
import type {
  SharedTestIdentity,
  SharedTestInstance,
} from '../../../../helpers/setup/shared-instance';

interface PrerequisiteReadContext {
  instance: SharedTestInstance;
  identity: SharedTestIdentity;
  classId: string;
  classRoute: typeof import('@/app/api/v1/classes/[classId]/route');
  progressRecoveryRoute: typeof import('@/app/api/v1/classes/[classId]/progress-recovery/route');
  focusSnapshotRoute: typeof import('@/app/api/v1/classes/[classId]/focus-snapshot/route');
  params: () => { params: Promise<{ classId: string }> };
  get: (token?: string) => Promise<Response>;
  getPrelude: (token?: string) => Promise<Response>;
  getFocusSnapshot: (token?: string) => Promise<Response>;
  acknowledgePrelude: (input: unknown, token?: string, origin?: string) => Promise<Response>;
  preparePrelude: (
    input: unknown,
    token?: string,
    origin?: string,
    recovery?: boolean
  ) => Promise<Response>;
  post: (input: unknown, token?: string, origin?: string) => Promise<Response>;
  calls: string[];
}

export function registerPrerequisiteReadCases(getContext: () => PrerequisiteReadContext) {
  it('returns a prerequisite revision matching the owned class material', async () => {
    const { instance, identity, classId, classRoute, params, get } = getContext();
    const readClass = () =>
      classRoute.GET(
        new NextRequest(`http://localhost:3000/api/v1/classes/${classId}`, {
          headers: { cookie: `sotto_session=${identity.ownerToken}` },
        }),
        params()
      );
    const firstResponse = await readClass();
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json();
    expect(first.taskMaterialRevision).toMatch(/^[a-f0-9]{64}$/);
    const initial = classPrerequisiteResponseSchema.parse(await (await get()).json());
    expect(first.prerequisiteSourceHash).toBe(initial.request.sourceHash);
    await instance.database.lessonQuestion.updateMany({
      where: { section: { classId }, skill: 'GRAMMAR' },
      data: { question: 'Una pregunta nueva.' },
    });
    const next = await (await readClass()).json();
    const status = classPrerequisiteResponseSchema.parse(await (await get()).json());
    expect(next.prerequisiteSourceHash).toBe(status.request.sourceHash);
    expect(next.prerequisiteSourceHash).not.toBe(first.prerequisiteSourceHash);
    expect(next.taskMaterialRevision).not.toBe(first.taskMaterialRevision);
  });

  it('returns only owned progress identity and tracks material independently of saved work', async () => {
    const { instance, identity, classId, progressRecoveryRoute, params } = getContext();
    const read = (token: string) =>
      progressRecoveryRoute.GET(
        new NextRequest(`http://localhost:3000/api/v1/classes/${classId}/progress-recovery`, {
          headers: { cookie: `sotto_session=${token}` },
        }),
        params()
      );
    const response = await read(identity.ownerToken);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const first = await response.json();
    expect(first).toEqual({
      classId,
      status: 'IN_PROGRESS',
      attempt: 1,
      progressRevision: 0,
      taskMaterialRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const other = await identity.household('Other learner');
    expect((await read(other.token)).status).toBe(404);
    await instance.database.courseClass.update({
      where: { id: classId },
      data: { progressRevision: { increment: 1 } },
    });
    const progress = await (await read(identity.ownerToken)).json();
    expect(progress.progressRevision).toBe(1);
    expect(progress.taskMaterialRevision).toBe(first.taskMaterialRevision);
    await instance.database.lessonQuestion.updateMany({
      where: { section: { classId }, skill: 'GRAMMAR' },
      data: { question: 'A changed question.' },
    });
    expect((await (await read(identity.ownerToken)).json()).taskMaterialRevision).not.toBe(
      first.taskMaterialRevision
    );
  });

  it('returns only reviewed prelude teaching and rejects stale or cross-profile acknowledgment', async () => {
    const {
      instance,
      identity,
      classId,
      classRoute,
      progressRecoveryRoute,
      focusSnapshotRoute,
      params,
      get,
      getPrelude,
      getFocusSnapshot,
      acknowledgePrelude,
      preparePrelude,
      post,
      calls,
    } = getContext();
    const oldRequest = classPrerequisiteResponseSchema.parse(await (await get()).json()).request;
    const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    const receiptId = randomUUID();
    const materialHash = await initialA1MaterialHash(instance.database, classId, identity.ownerId);
    await instance.database.courseClass.update({
      where: { id: classId },
      data: {
        prerequisiteGate: {
          version: 1,
          receiptId,
          materialHash,
          classId,
          courseId: cls.courseId,
          userId: identity.ownerId,
          attempt: cls.attempt,
        },
      },
    });
    const response = await getPrelude();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const value = classPreludeResponseSchema.parse(await response.json());
    expect(value).toMatchObject({ kind: 'BASE', receiptId, acknowledged: false });
    expect(
      await instance.database.$transaction((database) =>
        readClassTeachingPreludeInTransaction(database, classId, identity.ownerId)
      )
    ).toEqual(value);
    const body = JSON.stringify(value);
    expect(body).not.toContain(materialHash);
    expect(body).not.toMatch(
      /CONCEALED_|PRIVATE_|correctIndex|guidedPractice|sourceHash|snapshotHash/
    );
    expect((await post(oldRequest)).status).toBe(409);
    expect((await preparePrelude(oldRequest)).status).toBe(409);
    expect(calls).toHaveLength(0);
    const other = await identity.household('Otro alumno');
    expect((await getPrelude(other.token)).status).toBe(404);
    expect((await acknowledgePrelude({ kind: 'BASE', receiptId }, other.token)).status).toBe(409);
    expect((await acknowledgePrelude({ kind: 'ADDENDUM', receiptId })).status).toBe(409);
    expect((await acknowledgePrelude({ kind: 'BASE', receiptId, materialHash })).status).toBe(400);
    const progress = () =>
      progressRecoveryRoute.GET(
        new NextRequest(`http://localhost:3000/api/v1/classes/${classId}/progress-recovery`, {
          headers: { cookie: `sotto_session=${identity.ownerToken}` },
        }),
        params()
      );
    const before = await (await progress()).json();
    const beforeSnapshotResponse = await getFocusSnapshot();
    expect(beforeSnapshotResponse.headers.get('cache-control')).toBe('private, no-store');
    const beforeSnapshot = classFocusSnapshotSchema.parse(await beforeSnapshotResponse.json());
    expect(beforeSnapshot.prelude).toEqual(value);
    expect(beforeSnapshot.progress).toEqual(before);
    const foreignSnapshot = await getFocusSnapshot(other.token);
    expect(foreignSnapshot.status).toBe(404);
    expect(foreignSnapshot.headers.get('cache-control')).toBe('private, no-store');
    const anonymous = await focusSnapshotRoute.GET(
      new NextRequest(`http://localhost:3000/api/v1/classes/${classId}/focus-snapshot`),
      params()
    );
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('cache-control')).toBe('private, no-store');
    const [racingSnapshotResponse, acknowledgment] = await Promise.all([
      getFocusSnapshot(),
      acknowledgePrelude({ kind: 'BASE', receiptId }),
    ]);
    expect(acknowledgment.status).toBe(200);
    const after = await (await progress()).json();
    const afterSnapshot = classFocusSnapshotSchema.parse(await (await getFocusSnapshot()).json());
    expect(afterSnapshot.progress).toEqual(after);
    expect(afterSnapshot.prelude).toMatchObject({ kind: 'BASE', receiptId, acknowledged: true });
    const racingSnapshot = classFocusSnapshotSchema.parse(await racingSnapshotResponse.json());
    expect([beforeSnapshot, afterSnapshot]).toContainEqual(racingSnapshot);
    const detail = await classRoute.GET(
      new NextRequest(`http://localhost:3000/api/v1/classes/${classId}`, {
        headers: { cookie: `sotto_session=${identity.ownerToken}` },
      }),
      params()
    );
    expect(detail.status).toBe(200);
    expect((await detail.json()).taskMaterialRevision).toBe(after.taskMaterialRevision);
    expect(after.taskMaterialRevision).not.toBe(before.taskMaterialRevision);
    expect(JSON.stringify(after)).not.toContain(receiptId);
    expect(JSON.stringify(after)).not.toContain(materialHash);
    expect(classPreludeResponseSchema.parse(await (await getPrelude()).json())).toMatchObject({
      kind: 'BASE',
      acknowledged: true,
    });
    await instance.database.lessonQuestion.updateMany({
      where: { section: { classId }, skill: 'GRAMMAR' },
      data: { question: 'Una pregunta nueva.' },
    });
    expect((await acknowledgePrelude({ kind: 'BASE', receiptId })).status).toBe(409);
    expect(
      await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } })
    ).toMatchObject({
      learnerAnswers: { draft: 'PRIVATE_ANSWER' },
      writingDrafts: { draft: 'PRIVATE_DRAFT' },
    });
  });

  it('reads the class and its prerequisite revision from one snapshot during a concurrent change', async () => {
    const { instance, identity, classId, get } = getContext();
    const [{ sottoTransaction }, { getClassForUser }, { readPrerequisiteSource }] =
      await Promise.all([
        import('@/lib/sidedoor/access/state/transaction'),
        import('@/lib/class-service'),
        import('@/lib/classes/help/content/prerequisite-source'),
      ]);
    const initial = classPrerequisiteResponseSchema.parse(await (await get()).json());
    let notifyRead = () => {};
    let resume = () => {};
    const read = new Promise<void>((resolve) => {
      notifyRead = resolve;
    });
    const proceed = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const snapshot = sottoTransaction(instance.database, async (database) => {
      const cls = await getClassForUser(classId, identity.ownerId, database);
      if (!cls) throw new Error('Missing test class');
      notifyRead();
      await proceed;
      const source = await readPrerequisiteSource(database, classId, identity.ownerId);
      return {
        question: cls.sections.find((section) => section.skill === 'GRAMMAR')?.questions[0]
          .question,
        sourceHash: source.sourceHash,
      };
    });
    try {
      await read;
      await instance.database.lessonQuestion.updateMany({
        where: { section: { classId }, skill: 'GRAMMAR' },
        data: { question: 'Una pregunta nueva.' },
      });
    } finally {
      resume();
    }
    const before = await snapshot;
    expect(before.question).toBe('Pide té con cortesía.');
    expect(before.sourceHash).not.toBe(initial.request.sourceHash);
    const tokenizer = createPrerequisiteTokenizer(classId, identity.ownerId);
    expect(tokenizer.source(before.sourceHash)).toBe(initial.request.sourceHash);
    tokenizer.dispose();
    const after = classPrerequisiteResponseSchema.parse(await (await get()).json());
    expect(after.request.sourceHash).not.toBe(initial.request.sourceHash);
  });
}
