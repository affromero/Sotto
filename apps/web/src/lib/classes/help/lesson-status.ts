import type { ClassLessonHelpResponse } from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { readLessonHelpSource } from './lesson-source';
import { nextLessonHelpRetry, readCurrentLessonHelp } from './lesson-work';

export async function readLessonHelpStatus(
  database: Prisma.TransactionClient,
  classId: string,
  userId: string
) {
  const source = await readLessonHelpSource(database, classId, userId);
  const current = await readCurrentLessonHelp(
    database,
    source.context,
    source.operationId,
    source.ownership.scopes
  );
  const blocking =
    current.record &&
    (await sottoJobExecutions(database).blockingStatus(
      current.operationId,
      current.record.fingerprint
    ));
  const request = {
    operationId: current.canRetry ? nextLessonHelpRetry(current.operationId) : current.operationId,
    attempt: source.context.attempt,
    sourceHash: source.context.sourceHash,
    retryOf: current.canRetry ? current.operationId : current.previousOperationId,
  };
  const response: ClassLessonHelpResponse = {
    request,
    nativeLang: source.context.nativeLang,
    targetLang: source.context.targetLang,
    status: current.record ? 'PENDING' : 'AVAILABLE',
    canRetry: current.canRetry,
  };
  if (current.outcome?.status === 'FAILED') {
    response.status = 'FAILED';
    response.error = current.outcome.error;
  } else if (blocking && blocking !== 'active') {
    response.status = 'FAILED';
    response.canRetry = false;
    response.error =
      'The language-help request needs recovery on the server before another request can start.';
  } else if (current.record?.complete) {
    if (current.outcome?.status !== 'READY')
      throw new Error('The completed lesson-help result is missing.');
    response.status = 'READY';
    response.help = current.outcome.help;
  }
  return { source, current, response };
}
