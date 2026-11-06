import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { NextRequest, NextResponse } from 'next/server';
import { isAccessError } from 'thesidedoor-core/access';
import { delegationGrantBinding } from 'thesidedoor-core/runtime/delegation';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import { readRequestBytes, RequestBodyTooLargeError } from 'thesidedoor-core/runtime/request';
import { z } from 'zod';
import { vocabularyExamplesRequestSchema } from '@sotto/shared';
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
import { VocabularyExamplesError } from '@/lib/vocabulary/examples/source';
import { VocabularyStudyNotFound } from '@/lib/vocabulary/study-state';
import { readVocabularyExamplesStatus } from '@/lib/vocabulary/examples/status';

type Params = { params: Promise<{ sessionId: string; cardId: string }> };

function failure(error: unknown) {
  if (isAccessError(error)) throw error;
  if (error instanceof VocabularyStudyNotFound) return errorResponse('Flashcard not found.', 404);
  if (error instanceof VocabularyExamplesError) return errorResponse(error.message, error.status);
  if (error instanceof RequestBodyTooLargeError)
    return errorResponse('Example request is too large.', 413);
  if (error instanceof SyntaxError || error instanceof z.ZodError)
    return errorResponse('Invalid example request.', 400);
  return errorResponse('Examples are unavailable. Try again later.', 500);
}

export function GET(request: NextRequest, params: Params) {
  return accessOperation(request, false, async () => {
    try {
      const identity = await authenticateRequest(request);
      if (!identity) return errorResponse('Unauthorized', 401);
      const { sessionId, cardId } = await params.params;
      const execution = sottoRequestExecution(request, identity);
      const result = await sottoTransaction(
        prisma,
        async (database) => {
          await execution.authorize(database);
          return (await readVocabularyExamplesStatus(database, sessionId, cardId, identity.userId))
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
      const input = vocabularyExamplesRequestSchema.parse(
        JSON.parse(Buffer.from(await readRequestBytes(request, 4096)).toString('utf8'))
      );
      const { sessionId, cardId } = await params.params;
      const execution = sottoRequestExecution(request, identity);
      const inspect = (database: Parameters<typeof readVocabularyExamplesStatus>[0]) =>
        readVocabularyExamplesStatus(database, sessionId, cardId, identity.userId);
      const initial = await sottoTransaction(
        prisma,
        async (database) => {
          await execution.authorize(database);
          await database.$queryRaw`SELECT id FROM "PracticeSession" WHERE id = ${sessionId} FOR UPDATE`;
          const value = await inspect(database);
          if (!isDeepStrictEqual(value.response.request, input))
            throw new VocabularyExamplesError('The flashcard request changed. Reopen it.', 409);
          return value;
        },
        { signal: request.signal }
      );
      if (initial.response.status === 'READY') return NextResponse.json(initial.response);
      if (initial.response.status === 'FAILED' && !initial.response.canRetry)
        throw new VocabularyExamplesError(
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
          await database.$queryRaw`SELECT id FROM "PracticeSession" WHERE id = ${sessionId} FOR UPDATE`;
          const value = await inspect(database);
          const existing = await sottoJobOutbox(database).read(input.operationId);
          if (existing) {
            if (
              value.current.operationId !== input.operationId ||
              existing.job.handler !== 'interactions' ||
              existing.job.version !== 3
            )
              throw new VocabularyExamplesError('The saved request differs.', 409);
            return existing.complete;
          }
          if (
            !ai ||
            !isDeepStrictEqual(value.response.request, input) ||
            (value.response.status !== 'AVAILABLE' && !value.response.canRetry)
          )
            throw new VocabularyExamplesError('The flashcard request changed. Reopen it.', 409);
          const { ownership, context } = value.source;
          const saved = await database.flashcardExample.findUnique({
            where: { practiceSessionId_cardId: { practiceSessionId: sessionId, cardId } },
          });
          if (
            saved &&
            (saved.courseId !== context.courseId ||
              saved.sourceHash !== context.sourceHash ||
              saved.status !== 'FAILED' ||
              saved.operationId !== input.retryOf)
          )
            throw new VocabularyExamplesError('The saved example request needs recovery.', 409);
          if (!saved && input.retryOf)
            throw new VocabularyExamplesError('The previous example request is missing.', 409);
          await database.flashcardExample.upsert({
            where: { practiceSessionId_cardId: { practiceSessionId: sessionId, cardId } },
            create: {
              practiceSessionId: sessionId,
              courseId: context.courseId,
              cardId,
              sourceHash: context.sourceHash,
              operationId: input.operationId,
              status: 'PENDING',
            },
            update: { operationId: input.operationId, status: 'PENDING', examples: undefined },
          });
          const subject = ownership.scopes.find(
            (scope) => scope.subjectId === `profile:${identity.userId}`
          );
          const resource = ownership.scopes.find(
            (scope) => scope.subjectId === `course:${context.courseId}`
          );
          if (!subject || !resource)
            throw new VocabularyExamplesError('Course ownership changed.', 409);
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
          await sottoJobOutbox(database).enqueue(
            prepareJob({
              id: input.operationId,
              namespace: SIDEDOOR_STATE_ID,
              handler: 'interactions',
              version: 3,
              payload: {
                kind: 'VOCABULARY_EXAMPLES',
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
            'vocabulary'
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
          version: 3,
        });
      return NextResponse.json(
        { status: 'PENDING', request: input, canRetry: false },
        { status: 202 }
      );
    } catch (error) {
      return failure(error);
    }
  });
}
