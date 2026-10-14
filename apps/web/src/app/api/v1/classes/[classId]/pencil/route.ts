import { NextRequest, NextResponse } from 'next/server';
import { isAccessError } from 'thesidedoor-core/access';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { delegationGrantBinding } from 'thesidedoor-core/runtime/delegation';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import { readRequestBytes, RequestBodyTooLargeError } from 'thesidedoor-core/runtime/request';
import { pencilHomeworkRequestSchema } from '@sotto/shared';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { captureLearningModerationCredential, resolveCapturedLearningAi } from '@/lib/learning-ai';
import { learningCredentialFingerprint } from '@/lib/classes/preparation-selection';
import { sottoJobOutbox, deliverSottoJob } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { pencilHomeworkQueue } from '@/lib/queue';
import { validatePencilImage } from '@/lib/learning/pencil/homework-vision';
import {
  PencilHomeworkError,
  pencilHomeworkWorkSchema,
  readPencilOutcome,
  readPencilTask,
  requirePencilWork,
} from '@/lib/learning/pencil/homework-work';

type Params = { params: Promise<{ classId: string }> };

export function POST(request: NextRequest, params: Params) {
  return accessOperation(request, !request.headers.has('authorization'), () =>
    postHomework(request, params)
  );
}

async function postHomework(request: NextRequest, { params }: Params) {
  try {
    const identity = await authenticateRequest(request);
    if (!identity) return errorResponse('Unauthorized', 401);
    const { classId } = await params;
    const bytes = await readRequestBytes(request, 2_200_000);
    const parsed = pencilHomeworkRequestSchema.safeParse(
      JSON.parse(Buffer.from(bytes).toString('utf8'))
    );
    if (!parsed.success) return errorResponse('Invalid Pencil homework', 400);
    const input = parsed.data;
    try {
      await validatePencilImage(input.image);
    } catch {
      return errorResponse('The answer image must be a readable PNG or JPEG under 1.5 MB.', 400);
    }
    const execution = sottoRequestExecution(request, identity);
    const existing = await sottoTransaction(
      prisma,
      async (database) => {
        await execution.authorize(database);
        const record = await sottoJobOutbox(database).read(input.requestId);
        if (!record) return null;
        if (record.job.handler !== 'pencil-homework' || record.job.version !== 1)
          throw new PencilHomeworkError('This request ID belongs to another operation.', 409);
        const work = pencilHomeworkWorkSchema.parse(record.job.payload);
        if (
          work.userId !== identity.userId ||
          work.classId !== classId ||
          !isDeepStrictEqual(
            {
              requestId: work.requestId,
              attempt: work.attempt,
              taskKind: work.taskKind,
              taskId: work.taskId,
              image: work.image,
            },
            input
          )
        )
          throw new PencilHomeworkError(
            'The saved interpretation has different homework input.',
            409
          );
        await requirePencilWork(database, classId, work, record.job.scopes);
        const outcome = await readPencilOutcome(database, input.requestId, record.fingerprint);
        if (outcome?.status === 'FAILED') throw new PencilHomeworkError(outcome.error, 409);
        const blocked = await sottoJobExecutions(database).blockingStatus(
          input.requestId,
          record.fingerprint
        );
        if (blocked && blocked !== 'active')
          throw new PencilHomeworkError(
            'The interpretation has an unconfirmed outcome. It will not be replayed.',
            409
          );
        return record;
      },
      { signal: request.signal }
    );
    if (!existing) {
      const ai = await resolveCapturedLearningAi(identity.userId, execution);
      if (ai.isolatedImage)
        return errorResponse('The configured isolated agent does not support images.', 422);
      const moderation = await captureLearningModerationCredential(execution);
      await sottoTransaction(
        prisma,
        async (database) => {
          await execution.authorize(database);
          const { task, ownership, courseId } = await readPencilTask(
            database,
            classId,
            identity.userId,
            input
          );
          const subject = ownership.scopes.find(
            (scope) => scope.subjectId === `profile:${identity.userId}`
          );
          const resource = ownership.scopes.find(
            (scope) => scope.subjectId === `course:${courseId}`
          );
          if (!subject || !resource)
            throw new PencilHomeworkError('Homework ownership changed', 409);
          const grantSpec = {
            id: input.requestId,
            revision: randomUUID(),
            instanceId: ownership.instanceId,
            subject: { id: subject.subjectId, generation: subject.generation },
            resource: { id: resource.subjectId, generation: resource.generation },
            operationId: input.requestId,
            action: 'pencil-parent-provider-request',
            expiresAt: Date.now() + 15 * 60_000,
            maxRequests: 8,
          };
          const grant = delegationGrantBinding(grantSpec);
          const selection = {
            provider: ai.provider,
            model: ai.model,
            ...(ai.endpoint ? { endpoint: ai.endpoint } : {}),
            credentialFingerprint: learningCredentialFingerprint(ai.execution.credential),
            moderationCredentialFingerprint: learningCredentialFingerprint(moderation),
          };
          await sottoJobOutbox(database).enqueue(
            prepareJob({
              id: input.requestId,
              namespace: SIDEDOOR_STATE_ID,
              handler: 'pencil-homework',
              version: 1,
              payload: {
                ...input,
                classId,
                courseId,
                grant,
                userId: identity.userId,
                task: { ...task },
                selection,
              },
              scopes: ownership.scopes,
              delivery: { attempts: 1, priority: 0, availableAt: 0 },
            })
          );
          await learningPreparationGrant(
            database,
            { id: input.requestId, courseId, userId: identity.userId },
            'pencil'
          ).create(grantSpec);
        },
        { signal: request.signal }
      );
    }
    if (!existing?.complete)
      await deliverSottoJob({
        database: prisma,
        queue: pencilHomeworkQueue,
        operationId: input.requestId,
        version: 1,
      });
    return NextResponse.json({ status: 'PENDING', operationId: input.requestId }, { status: 202 });
  } catch (error) {
    if (isAccessError(error)) throw error;
    if (error instanceof RequestBodyTooLargeError)
      return errorResponse('Homework image is too large', 413);
    if (error instanceof SyntaxError || error instanceof z.ZodError)
      return errorResponse('Invalid Pencil homework', 400);
    if (error instanceof PencilHomeworkError) return errorResponse(error.message, error.status);
    return errorResponse(
      error instanceof Error ? error.message : 'Could not prepare homework interpretation',
      500
    );
  }
}

export function GET(request: NextRequest, params: Params) {
  return accessOperation(request, false, () => getHomework(request, params));
}

async function getHomework(request: NextRequest, { params }: Params) {
  try {
    const identity = await authenticateRequest(request);
    if (!identity) return errorResponse('Unauthorized', 401);
    const { classId } = await params;
    const id = z.uuid().safeParse(request.nextUrl.searchParams.get('operationId'));
    if (!id.success) return errorResponse('Invalid interpretation ID', 400);
    const execution = sottoRequestExecution(request, identity);
    const result = await sottoTransaction(
      prisma,
      async (database) => {
        await execution.authorize(database);
        const record = await sottoJobOutbox(database).read(id.data);
        if (!record || record.job.handler !== 'pencil-homework' || record.job.version !== 1)
          throw new PencilHomeworkError('Interpretation not found', 404);
        const work = pencilHomeworkWorkSchema.parse(record.job.payload);
        if (work.userId !== identity.userId || work.classId !== classId)
          throw new PencilHomeworkError('Interpretation not found', 404);
        await requirePencilWork(database, classId, work, record.job.scopes);
        const outcome = await readPencilOutcome(database, id.data, record.fingerprint);
        if (outcome?.status === 'FAILED' || (outcome && record.complete))
          return { ...outcome, operationId: id.data };
        const blocking = await sottoJobExecutions(database).blockingStatus(
          id.data,
          record.fingerprint
        );
        if (blocking && blocking !== 'active')
          return {
            status: 'FAILED' as const,
            operationId: id.data,
            error:
              'The interpretation has an unconfirmed outcome. Your ink is saved. Check the server before trying again.',
          };
        if (record.complete) throw new Error('The interpretation has no retained result.');
        return { status: 'PENDING' as const, operationId: id.data };
      },
      { signal: request.signal }
    );
    return NextResponse.json(result);
  } catch (error) {
    if (isAccessError(error)) throw error;
    if (error instanceof PencilHomeworkError) return errorResponse(error.message, error.status);
    return errorResponse(
      error instanceof Error ? error.message : 'Could not read homework interpretation',
      500
    );
  }
}
