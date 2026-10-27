import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { NextRequest, NextResponse } from 'next/server';
import { isAccessError } from 'thesidedoor-core/access';
import { delegationGrantBinding } from 'thesidedoor-core/runtime/delegation';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import { readRequestBytes, RequestBodyTooLargeError } from 'thesidedoor-core/runtime/request';
import { classLessonHelpRequestSchema } from '@sotto/shared';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { captureLearningModerationCredential, resolveCapturedLearningAi } from '@/lib/learning-ai';
import { learningCredentialFingerprint } from '@/lib/classes/preparation-selection';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { deliverSottoJob, sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { interactionQueue } from '@/lib/queue';
import { ClassLessonHelpError } from '@/lib/classes/help/lesson-source';
import { readLessonHelpStatus } from '@/lib/classes/help/lesson-status';

type Params = { params: Promise<{ classId: string }> };

function failure(error: unknown) {
  if (isAccessError(error)) throw error;
  if (error instanceof ClassLessonHelpError) return errorResponse(error.message, error.status);
  if (error instanceof RequestBodyTooLargeError)
    return errorResponse('Lesson-help request is too large.', 413);
  if (error instanceof SyntaxError || error instanceof z.ZodError)
    return errorResponse('Invalid lesson-help request.', 400);
  return errorResponse(error instanceof Error ? error.message : 'Lesson help is unavailable.', 500);
}

export function GET(request: NextRequest, params: Params) {
  return accessOperation(request, false, async () => {
    try {
      const identity = await authenticateRequest(request);
      if (!identity) return errorResponse('Unauthorized', 401);
      const { classId } = await params.params;
      const execution = sottoRequestExecution(request, identity);
      const result = await sottoTransaction(
        prisma,
        async (database) => {
          await execution.authorize(database);
          return (await readLessonHelpStatus(database, classId, identity.userId)).response;
        },
        { signal: request.signal }
      );
      return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) {
      return failure(error);
    }
  });
}

export function POST(request: NextRequest, params: Params) {
  return accessOperation(request, !request.headers.has('authorization'), async () => {
    try {
      const identity = await authenticateRequest(request);
      if (!identity) return errorResponse('Unauthorized', 401);
      const bytes = await readRequestBytes(request, 4096);
      const input = classLessonHelpRequestSchema.parse(
        JSON.parse(Buffer.from(bytes).toString('utf8'))
      );
      const { classId } = await params.params;
      const execution = sottoRequestExecution(request, identity);
      const inspect = (database: Parameters<typeof readLessonHelpStatus>[0]) =>
        readLessonHelpStatus(database, classId, identity.userId);
      const initial = await sottoTransaction(
        prisma,
        async (database) => {
          await execution.authorize(database);
          const value = await inspect(database);
          if (!isDeepStrictEqual(value.response.request, input))
            throw new ClassLessonHelpError(
              'The lesson-help request changed. Reopen the lesson.',
              409
            );
          return value;
        },
        { signal: request.signal }
      );
      if (initial.response.status === 'READY') return NextResponse.json(initial.response);
      if (initial.response.status === 'FAILED' && !initial.response.canRetry)
        throw new ClassLessonHelpError(
          initial.response.error ?? 'The previous request needs recovery.',
          409
        );
      const creating = initial.response.status === 'AVAILABLE' || initial.response.canRetry;
      const ai = creating ? await resolveCapturedLearningAi(identity.userId, execution) : null;
      const moderation = creating ? await captureLearningModerationCredential(execution) : null;
      const complete = await sottoTransaction(
        prisma,
        async (database) => {
          await execution.authorize(database);
          const value = await inspect(database);
          const existing = await sottoJobOutbox(database).read(input.operationId);
          if (existing) {
            if (
              value.current.operationId !== input.operationId ||
              existing.job.handler !== 'interactions' ||
              existing.job.version !== 2
            )
              throw new ClassLessonHelpError('The saved lesson-help request differs.', 409);
            return existing.complete;
          }
          if (
            !ai ||
            !isDeepStrictEqual(value.response.request, input) ||
            (value.response.status !== 'AVAILABLE' && !value.response.canRetry)
          )
            throw new ClassLessonHelpError(
              'The lesson-help request changed. Reopen the lesson.',
              409
            );
          const { ownership, context } = value.source;
          const subject = ownership.scopes.find(
            (scope) => scope.subjectId === `profile:${identity.userId}`
          );
          const resource = ownership.scopes.find(
            (scope) => scope.subjectId === `course:${context.courseId}`
          );
          if (!subject || !resource)
            throw new ClassLessonHelpError('Lesson ownership changed.', 409);
          const grantSpec = {
            id: input.operationId,
            revision: randomUUID(),
            instanceId: ownership.instanceId,
            subject: { id: subject.subjectId, generation: subject.generation },
            resource: { id: resource.subjectId, generation: resource.generation },
            operationId: input.operationId,
            action: 'lesson-help-parent-provider-request',
            expiresAt: Date.now() + 15 * 60_000,
            maxRequests: 8,
          };
          await sottoJobOutbox(database).enqueue(
            prepareJob({
              id: input.operationId,
              namespace: SIDEDOOR_STATE_ID,
              handler: 'interactions',
              version: 2,
              payload: {
                kind: 'CLASS_LESSON_HELP',
                context,
                previousOperationId: input.retryOf,
                grant: delegationGrantBinding(grantSpec),
                selection: {
                  provider: ai.provider,
                  model: ai.model,
                  ...(ai.endpoint ? { endpoint: ai.endpoint } : {}),
                  ...(ai.isolatedImage ? { isolatedImage: ai.isolatedImage } : {}),
                  credentialFingerprint: learningCredentialFingerprint(ai.execution.credential),
                  moderationCredentialFingerprint: learningCredentialFingerprint(moderation),
                },
              },
              scopes: ownership.scopes,
              delivery: { attempts: 1, priority: 0, availableAt: 0 },
            })
          );
          await learningPreparationGrant(
            database,
            { id: input.operationId, courseId: context.courseId, userId: identity.userId },
            'lesson-help'
          ).create(grantSpec);
          return false;
        },
        { signal: request.signal }
      );
      if (!complete)
        await deliverSottoJob({
          database: prisma,
          queue: interactionQueue,
          operationId: input.operationId,
          version: 2,
        });
      return NextResponse.json(
        {
          status: 'PENDING',
          request: input,
          nativeLang: initial.source.context.nativeLang,
          targetLang: initial.source.context.targetLang,
          canRetry: false,
        },
        { status: 202 }
      );
    } catch (error) {
      return failure(error);
    }
  });
}
