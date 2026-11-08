import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@/generated/prisma/client';
import { readInitialA1PracticeAuthorization } from '@/lib/classes/lesson/initial-a1-provenance';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { writingExecutionSchema } from '@/lib/learning/writing/writing-execution';
import { hasSettledSottoExecution } from '@/lib/sidedoor/jobs/core/job-settlement-proof';
import { lockPracticeGrant, readLockedPracticeOutbox } from './assessment-practice-execution';

/** Legacy feedback has no operation binding. New feedback must retain its exact durable work. */
export async function hasFormativeWritingReceipt(
  database: Prisma.TransactionClient,
  input: {
    response: {
      id: string;
      promptId: string;
      text: string;
      attempt: number;
      gradingState: unknown;
    };
    courseId: string;
    userId: string;
    authorization: Awaited<ReturnType<typeof readInitialA1PracticeAuthorization>>;
  }
) {
  if (input.response.gradingState === null) return true;
  const parsed = writingExecutionSchema.safeParse(input.response.gradingState);
  if (!parsed.success) return false;
  const state = parsed.data;
  if (
    state.status !== 'COMPLETED' ||
    state.userId !== input.userId ||
    state.courseId !== input.courseId ||
    state.grant.id !== state.id ||
    !isDeepStrictEqual(state.classAuthorization, input.authorization)
  )
    return false;
  const record = await readLockedPracticeOutbox(database, state.id);
  if (
    !record ||
    !record.complete ||
    record.fingerprint !== state.fingerprint ||
    record.job.id !== state.id ||
    record.job.handler !== 'learning-writing' ||
    record.job.version !== 1 ||
    !isDeepStrictEqual(record.job.payload, {
      responseId: input.response.id,
      text: input.response.text,
      promptId: input.response.promptId,
      attempt: input.response.attempt,
      selection: state.selection,
      ...(state.classAuthorization !== undefined
        ? { classAuthorization: state.classAuthorization }
        : {}),
    })
  )
    return false;
  if (!(await lockPracticeGrant(database, state.id, 'writing'))) return false;
  const grant = await learningPreparationGrant(database, state, 'writing').read(state.grant);
  if (
    grant.status !== 'completed' ||
    grant.attempts.some((attempt) => ['admitted', 'unknown'].includes(attempt.outcome))
  )
    return false;
  return hasSettledSottoExecution(database, { id: state.id, fingerprint: state.fingerprint });
}
