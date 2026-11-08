import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { isAccessError } from 'thesidedoor-core/access';
import { readRequestBytes, RequestBodyTooLargeError } from 'thesidedoor-core/runtime/request';
import { classPrerequisiteRequestSchema, classPrerequisiteResponseSchema } from '@sotto/shared';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { captureLearningModerationCredential, resolveCapturedLearningAi } from '@/lib/learning-ai';
import { learningCredentialFingerprint } from '@/lib/classes/preparation-selection';
import { deliverSottoJob, sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { interactionQueue } from '@/lib/queue';
import { admitPrerequisiteWork } from '@/lib/classes/help/lifecycle/prerequisite-admission';
import {
  PrerequisiteFenceConflict,
  prerequisiteFenceBackend,
  prerequisiteFenceStore,
} from '@/lib/classes/help/lifecycle/prerequisite-fence';
import { recoverPrerequisiteOutcome } from '@/lib/classes/help/prerequisite-outcome';
import { PrerequisiteSourceConflict } from '@/lib/classes/help/content/prerequisite-source';
import { readPrerequisiteStatus } from '@/lib/classes/help/prerequisite-status';
import { PrerequisiteCapacityError } from '@/lib/classes/help/content/prerequisite-json';
import { createPrerequisiteTokenizer } from '@/lib/classes/help/content/prerequisite-token';
import { requireInitialA1AddendumPreparation } from '@/lib/classes/lesson/initial-a1-provenance';

type Params = { params: Promise<{ classId: string }> };

function response(value: unknown, status = 200, internal = false) {
  const parsed = classPrerequisiteResponseSchema.parse(value);
  if (!internal && parsed.status === 'READY' && !parsed.acknowledged)
    return NextResponse.json(
      { error: 'Review the prerequisite teaching first.', code: 'PREREQUISITE_ACK_REQUIRED' },
      { status: 409, headers: { 'Cache-Control': 'private, no-store' } }
    );
  return NextResponse.json(parsed, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

function failure(error: unknown) {
  if (isAccessError(error)) throw error;
  const status =
    error instanceof PrerequisiteFenceConflict || error instanceof PrerequisiteSourceConflict
      ? 409
      : error instanceof PrerequisiteCapacityError
        ? 422
        : error instanceof RequestBodyTooLargeError
          ? 413
          : error instanceof SyntaxError || error instanceof z.ZodError
            ? 400
            : 500;
  const result = errorResponse(
    status === 409
      ? 'The class or prerequisite request changed. Reopen the class.'
      : status === 422
        ? 'This class is too large to prepare safely.'
        : status === 413
          ? 'Prerequisite request is too large.'
          : status === 400
            ? 'Invalid prerequisite request.'
            : 'Prerequisite teaching is unavailable.',
    status
  );
  result.headers.set('Cache-Control', 'private, no-store');
  return result;
}

export function readPrerequisiteHttp(request: NextRequest, params: Params) {
  return accessOperation(request, false, async () => {
    try {
      const identity = await authenticateRequest(request);
      if (!identity) return errorResponse('Unauthorized', 401);
      const { classId } = await params.params;
      const execution = sottoRequestExecution(request, identity);
      const tokenizer = createPrerequisiteTokenizer(classId, identity.userId);
      try {
        const result = await sottoTransaction(
          prisma,
          async (database) => {
            await execution.authorize(database);
            return readPrerequisiteStatus(database, classId, identity.userId);
          },
          { signal: request.signal }
        );
        return response(tokenizer.status(result));
      } finally {
        tokenizer.dispose();
      }
    } catch (error) {
      return failure(error);
    }
  });
}

export function preparePrerequisiteHttp(request: NextRequest, params: Params, internal = false) {
  return accessOperation(request, !request.headers.has('authorization'), async () => {
    try {
      const identity = await authenticateRequest(request);
      if (!identity) return errorResponse('Unauthorized', 401);
      const input = classPrerequisiteRequestSchema.parse(
        JSON.parse(Buffer.from(await readRequestBytes(request, 4096)).toString('utf8'))
      );
      const { classId } = await params.params;
      const execution = sottoRequestExecution(request, identity);
      const tokenizer = createPrerequisiteTokenizer(classId, identity.userId);
      const recoveryOnly = request.nextUrl.searchParams.get('recover') === '1';
      try {
        const inspect = async () =>
          sottoTransaction(
            prisma,
            async (database) => {
              await execution.authorize(database);
              const result = await readPrerequisiteStatus(database, classId, identity.userId);
              const fence = (
                await prerequisiteFenceStore(prerequisiteFenceBackend(database, classId)).read()
              ).current;
              return { result, fence };
            },
            { signal: request.signal }
          );
        const inspected = await inspect();
        const initial = inspected.result;
        const priorRequest = inspected.fence && {
          sourceHash: inspected.fence.sourceHash,
          snapshotHash: inspected.fence.snapshotHash,
        };
        if (
          !tokenizer.matches(input, initial.request) &&
          !(
            inspected.fence?.status === 'COMPLETED' &&
            priorRequest !== null &&
            ['READY', 'PENDING'].includes(initial.status) &&
            tokenizer.matches(input, priorRequest)
          )
        )
          throw new PrerequisiteFenceConflict();
        if (initial.status === 'READY') return response(tokenizer.status(initial), 200, internal);
        if (
          (recoveryOnly && initial.status !== 'PENDING') ||
          initial.status === 'UNAVAILABLE' ||
          initial.status === 'UNRESOLVED' ||
          ('canRetry' in initial && !initial.canRetry)
        )
          throw new PrerequisiteFenceConflict();
        const create = initial.status !== 'PENDING';
        const ai = create ? await resolveCapturedLearningAi(identity.userId, execution) : null;
        const moderation = create ? await captureLearningModerationCredential(execution) : null;
        const prepared = {
          id: randomUUID(),
          revision: randomUUID(),
          expiresAt: Date.now() + 45 * 60_000,
        };
        const admitted = await sottoTransaction(
          prisma,
          async (database) => {
            await execution.authorize(database);
            const current = await readPrerequisiteStatus(database, classId, identity.userId);
            if (!tokenizer.matches(input, current.request)) {
              const fence = (
                await prerequisiteFenceStore(prerequisiteFenceBackend(database, classId)).read()
              ).current;
              if (
                !fence ||
                fence.status !== 'COMPLETED' ||
                !['READY', 'PENDING'].includes(current.status) ||
                !tokenizer.matches(input, {
                  sourceHash: fence.sourceHash,
                  snapshotHash: fence.snapshotHash,
                })
              )
                throw new PrerequisiteFenceConflict();
            }
            if (current.status === 'READY') return { result: current, deliver: null };
            if (current.status === 'PENDING') {
              const fence = (
                await prerequisiteFenceStore(prerequisiteFenceBackend(database, classId)).read()
              ).current;
              if (!fence) throw new PrerequisiteFenceConflict();
              if (fence.status === 'COMPLETED') {
                const record = await sottoJobOutbox(database).read(fence.id);
                if (!record) throw new PrerequisiteFenceConflict();
                if (
                  !(await sottoJobExecutions(database).blockingStatus(fence.id, record.fingerprint))
                ) {
                  await recoverPrerequisiteOutcome(database, {
                    id: fence.id,
                    fingerprint: record.fingerprint,
                  });
                  return {
                    result: await readPrerequisiteStatus(database, classId, identity.userId),
                    deliver: null,
                  };
                }
                return { result: current, deliver: null };
              }
              return { result: current, deliver: fence.id };
            }
            if (
              recoveryOnly ||
              !ai ||
              current.status === 'UNAVAILABLE' ||
              current.status === 'UNRESOLVED' ||
              ('canRetry' in current && !current.canRetry)
            )
              throw new PrerequisiteFenceConflict();
            await requireInitialA1AddendumPreparation(database, classId, identity.userId);
            const record = await admitPrerequisiteWork(database, {
              ...prepared,
              classId,
              userId: identity.userId,
              authorize: execution.authorize,
              selection: {
                provider: ai.provider,
                model: ai.model,
                ...(ai.endpoint ? { endpoint: ai.endpoint } : {}),
                ...(ai.isolatedImage ? { isolatedImage: ai.isolatedImage } : {}),
                credentialFingerprint: learningCredentialFingerprint(ai.execution.credential),
                moderationCredentialFingerprint: learningCredentialFingerprint(moderation),
              },
            });
            return {
              result: {
                status: 'PENDING' as const,
                request: current.request,
                nativeLang: current.nativeLang,
                targetLang: current.targetLang,
              },
              deliver: record.job.id,
            };
          },
          { signal: request.signal }
        );
        if (admitted.deliver)
          await deliverSottoJob({
            database: prisma,
            queue: interactionQueue,
            operationId: admitted.deliver,
            version: 5,
          });
        return response(
          tokenizer.status(admitted.result),
          admitted.result.status === 'PENDING' ? 202 : 200,
          internal
        );
      } finally {
        tokenizer.dispose();
      }
    } catch (error) {
      return failure(error);
    }
  });
}
