import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { classAssessmentStatusSchema } from '@sotto/shared';
import { initialA1MaterialHash } from '@/lib/classes/lesson/initial-a1-provenance';
import type {
  SharedTestIdentity,
  SharedTestInstance,
} from '../../../../helpers/setup/shared-instance';
import type { Worker } from 'bullmq';

interface AssessmentStatusContext {
  instance: SharedTestInstance;
  identity: SharedTestIdentity;
  classId: string;
  assessmentStatusRoute: typeof import('@/app/api/v1/classes/[classId]/assessment/status/route');
  params: () => { params: Promise<{ classId: string }> };
  runtime: typeof import('@/lib/queue');
  calls: string[];
  setWorker: (worker: Worker) => void;
}

export function registerAssessmentStatusCases(getContext: () => AssessmentStatusContext) {
  it('reports assessment status only to the owner without exposing private work', async () => {
    const { instance, identity, classId, assessmentStatusRoute } = getContext();
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
          acknowledgment: { userId: identity.ownerId, receiptId, materialHash },
        },
      },
    });
    const read = (token: string, requestedClass = classId) =>
      assessmentStatusRoute.GET(
        new NextRequest(
          `http://localhost:3000/api/v1/classes/${requestedClass}/assessment/status`,
          {
            headers: token ? { cookie: `sotto_session=${token}` } : {},
          }
        ),
        { params: Promise.resolve({ classId: requestedClass }) }
      );
    const result = await read(identity.ownerToken);
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe('private, no-store');
    const body = await result.json();
    expect(classAssessmentStatusSchema.parse(body)).toEqual({
      status: 'PRACTICE_REQUIRED',
      classAttempt: cls.attempt,
    });
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE_|CONCEALED_|correctIndex|materialHash/);
    const other = await identity.household('Otro alumno');
    const foreign = await read(other.token);
    const missing = await read(identity.ownerToken, 'missing-class');
    expect(foreign.status).toBe(409);
    expect(missing.status).toBe(409);
    expect((await foreign.json()).error).toBe((await missing.json()).error);
    expect(foreign.headers.get('cache-control')).toBe('private, no-store');
    const anonymous = await read('');
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('cache-control')).toBe('private, no-store');
  });
  it('prepares one assessment for the reviewed class and reuses it on retry', async () => {
    const {
      instance,
      identity,
      classId,
      assessmentStatusRoute,
      params,
      runtime,
      calls,
      setWorker,
    } = getContext();
    const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    const receiptId = randomUUID();
    const materialHash = await initialA1MaterialHash(instance.database, classId, identity.ownerId);
    const questions = await instance.database.lessonQuestion.findMany({
      where: { section: { classId } },
    });
    await instance.database.courseClass.update({
      where: { id: classId },
      data: {
        learnerAnswers: Object.fromEntries(questions.map((question) => [question.id, 0])),
        prerequisiteGate: {
          version: 1,
          receiptId,
          materialHash,
          classId,
          courseId: cls.courseId,
          userId: identity.ownerId,
          attempt: cls.attempt,
          acknowledgment: { userId: identity.ownerId, receiptId, materialHash },
        },
      },
    });
    const prompts = await instance.database.writingPrompt.findMany({
      where: { section: { classId } },
    });
    for (const prompt of prompts)
      await instance.database.writingResponse.create({
        data: {
          promptId: prompt.id,
          sectionId: prompt.sectionId,
          userId: identity.ownerId,
          text: 'Una respuesta',
          overallScore: 0.2,
          corrections: [],
          feedback: 'Sigue practicando.',
        },
      });
    const statusUrl = `http://localhost:3000/api/v1/classes/${classId}/assessment/status`;
    const read = () =>
      assessmentStatusRoute.GET(
        new NextRequest(statusUrl, {
          headers: { cookie: `sotto_session=${identity.ownerToken}` },
        }),
        params()
      );
    const initial = classAssessmentStatusSchema.parse(await (await read()).json());
    expect(initial.status).toBe('AVAILABLE');
    if (initial.status !== 'AVAILABLE') throw new Error('Expected an available assessment');
    const post = (input: unknown, token = identity.ownerToken, origin = 'http://localhost:3000') =>
      assessmentStatusRoute.POST(
        new NextRequest(statusUrl, {
          method: 'POST',
          headers: { cookie: `sotto_session=${token}`, origin, 'content-type': 'application/json' },
          body: JSON.stringify(input),
        }),
        params()
      );
    const input = { classAttempt: initial.classAttempt, revision: initial.revision };
    const replacement = randomUUID();
    await instance.database.courseClass.update({
      where: { id: classId },
      data: {
        prerequisiteGate: {
          version: 1,
          receiptId: replacement,
          materialHash,
          classId,
          courseId: cls.courseId,
          userId: identity.ownerId,
          attempt: cls.attempt,
          acknowledgment: { userId: identity.ownerId, receiptId: replacement, materialHash },
        },
      },
    });
    expect((await post(input)).status).toBe(409);
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
          acknowledgment: { userId: identity.ownerId, receiptId, materialHash },
        },
      },
    });
    expect((await post({ ...input, revision: '0'.repeat(64) })).status).toBe(409);
    expect((await post(input, identity.ownerToken, 'https://untrusted.example')).status).toBe(403);
    const other = await identity.household('Otro alumno');
    expect((await post(input, other.token)).status).toBe(409);
    expect(await instance.database.classAssessment.count({ where: { classId } })).toBe(0);
    const [first, second] = await Promise.all([post(input), post(input)]);
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(classAssessmentStatusSchema.parse(await first.json())).toEqual({
      status: 'PENDING',
      classAttempt: cls.attempt,
      revision: input.revision,
    });
    expect(classAssessmentStatusSchema.parse(await second.json())).toEqual({
      status: 'PENDING',
      classAttempt: cls.attempt,
      revision: input.revision,
    });
    const assessments = await instance.database.classAssessment.findMany({ where: { classId } });
    expect(assessments).toHaveLength(1);
    const job = await runtime.interactionQueue.getJob(assessments[0]!.generationOperationId!);
    expect(job?.name).toBe('interactions.v6');
    await job!.remove();
    const reloaded = classAssessmentStatusSchema.parse(await (await read()).json());
    expect(reloaded.status).toBe('PENDING');
    if (reloaded.status !== 'PENDING') throw new Error('Expected pending assessment');
    expect(
      (await post({ classAttempt: reloaded.classAttempt, revision: reloaded.revision })).status
    ).toBe(202);
    expect(
      await runtime.interactionQueue.getJob(assessments[0]!.generationOperationId!)
    ).not.toBeNull();
    const { UnrecoverableError } = await import('bullmq');
    const worker = runtime.createWorker(
      'interactions',
      async () => {
        throw new UnrecoverableError('Synthetic terminal assessment delivery');
      },
      { concurrency: 1 }
    );
    setWorker(worker);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Assessment delivery did not fail')),
        15000
      );
      worker!.on('failed', (item) => {
        if (item?.id === assessments[0]!.generationOperationId) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
    expect((await post(input)).status).toBe(409);
    expect(classAssessmentStatusSchema.parse(await (await read()).json())).toEqual({
      status: 'UNRESOLVED',
      classAttempt: cls.attempt,
    });
    expect(await instance.database.classAssessment.count({ where: { classId } })).toBe(1);
    expect(calls).toHaveLength(0);
  });
}
