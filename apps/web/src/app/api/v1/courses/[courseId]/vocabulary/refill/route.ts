import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { NextRequest, NextResponse } from 'next/server';
import { isAccessError } from 'thesidedoor-core/access';
import { delegationGrantBinding } from 'thesidedoor-core/runtime/delegation';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import { readRequestBytes, RequestBodyTooLargeError } from 'thesidedoor-core/runtime/request';
import { vocabularyRefillRequestSchema } from '@sotto/shared';
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
import { VocabularyStudyNotFound } from '@/lib/vocabulary/study-state';
import { VocabularyRefillError } from '@/lib/vocabulary/refill/source';
import { readVocabularyRefillStatus } from '@/lib/vocabulary/refill/status';

type Params = { params: Promise<{ courseId: string }> };
function failure(error: unknown) {
  if (isAccessError(error)) throw error;
  if (error instanceof VocabularyStudyNotFound) return errorResponse('Practice not found.', 404);
  if (error instanceof VocabularyRefillError) return errorResponse(error.message, error.status);
  if (error instanceof RequestBodyTooLargeError)
    return errorResponse('Refill request is too large.', 413);
  if (error instanceof SyntaxError || error instanceof z.ZodError)
    return errorResponse('Invalid refill request.', 400);
  return errorResponse('New words are unavailable. Try again later.', 500);
}

export function GET(request: NextRequest, params: Params) {
  return accessOperation(request, false, async () => {
    try {
      const identity = await authenticateRequest(request);
      if (!identity) return errorResponse('Unauthorized', 401);
      const { courseId } = await params.params;
      const sessionId = z
        .string()
        .min(1)
        .max(200)
        .nullable()
        .parse(request.nextUrl.searchParams.get('sessionId'));
      const execution = sottoRequestExecution(request, identity);
      const result = await sottoTransaction(
        prisma,
        async (database) => {
          await execution.authorize(database);
          return (await readVocabularyRefillStatus(database, courseId, identity.userId, sessionId))
            .response;
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
      const input = vocabularyRefillRequestSchema.parse(
        JSON.parse(Buffer.from(await readRequestBytes(request, 4096)).toString('utf8'))
      );
      const { courseId } = await params.params;
      const execution = sottoRequestExecution(request, identity);
      const inspect = (database: Parameters<typeof readVocabularyRefillStatus>[0]) =>
        readVocabularyRefillStatus(database, courseId, identity.userId, input.triggerSessionId);
      const initial = await sottoTransaction(
        prisma,
        async (database) => {
          await execution.authorize(database);
          return inspect(database);
        },
        { signal: request.signal }
      );
      if (
        initial.response.status === 'PENDING' ||
        initial.response.status === 'READY' ||
        initial.response.status === 'NOT_NEEDED'
      )
        return NextResponse.json(initial.response);
      if (initial.response.status === 'FAILED' && !initial.response.canRetry)
        throw new VocabularyRefillError(
          initial.response.error ?? 'The previous refill needs recovery.',
          409
        );
      if (!('request' in initial.response) || !isDeepStrictEqual(initial.response.request, input))
        throw new VocabularyRefillError('The refill request changed. Check its status.', 409);
      const ai = await resolveCapturedLearningAi(identity.userId, execution);
      const moderation = await captureLearningModerationCredential(execution);
      const result = await sottoTransaction(
        prisma,
        async (database) => {
          await execution.authorize(database);
          if (input.triggerSessionId)
            await database.$queryRaw`SELECT id FROM "PracticeSession" WHERE id = ${input.triggerSessionId} FOR UPDATE`;
          await database.$queryRaw`SELECT id FROM "Course" WHERE id = ${courseId} FOR UPDATE`;
          const value = await inspect(database);
          if (
            value.response.status === 'PENDING' ||
            value.response.status === 'READY' ||
            value.response.status === 'NOT_NEEDED'
          )
            return { response: value.response, deliver: false };
          if (
            !('request' in value.response) ||
            !isDeepStrictEqual(value.response.request, input) ||
            (value.response.status !== 'AVAILABLE' && !value.response.canRetry)
          )
            throw new VocabularyRefillError('The refill request changed. Check its status.', 409);
          const { ownership, context } = value.source;
          const subject = ownership.scopes.find(
            (scope) => scope.subjectId === `profile:${identity.userId}`
          );
          const resource = ownership.scopes.find(
            (scope) => scope.subjectId === `course:${courseId}`
          );
          if (!subject || !resource)
            throw new VocabularyRefillError('Course ownership changed.', 409);
          const grantSpec = {
            id: input.operationId,
            revision: randomUUID(),
            instanceId: ownership.instanceId,
            subject: { id: subject.subjectId, generation: subject.generation },
            resource: { id: resource.subjectId, generation: resource.generation },
            operationId: input.operationId,
            action: 'vocabulary-parent-provider-request',
            expiresAt: Date.now() + 15 * 60_000,
            maxRequests: 8,
          };
          await database.vocabularyRefill.upsert({
            where: { courseId },
            create: {
              courseId,
              generation: input.generation,
              operationId: input.operationId,
              triggerSessionId: input.triggerSessionId,
              sourceHash: input.sourceHash,
              status: 'PENDING',
            },
            update: {
              generation: input.generation,
              operationId: input.operationId,
              triggerSessionId: input.triggerSessionId,
              sourceHash: input.sourceHash,
              status: 'PENDING',
              added: null,
              wordIds: [],
            },
          });
          await sottoJobOutbox(database).enqueue(
            prepareJob({
              id: input.operationId,
              namespace: SIDEDOOR_STATE_ID,
              handler: 'interactions',
              version: 4,
              payload: {
                kind: 'VOCABULARY_REFILL',
                context,
                triggerSessionId: input.triggerSessionId,
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
            { id: input.operationId, courseId, userId: identity.userId },
            'vocabulary'
          ).create(grantSpec);
          return { response: { status: 'PENDING' as const, canRetry: false }, deliver: true };
        },
        { signal: request.signal }
      );
      if (result.deliver)
        await deliverSottoJob({
          database: prisma,
          queue: interactionQueue,
          operationId: input.operationId,
          version: 4,
        });
      return NextResponse.json(result.response, { status: result.deliver ? 202 : 200 });
    } catch (error) {
      return failure(error);
    }
  });
}
