import type { Job } from 'bullmq';
import { setTimeout } from 'node:timers/promises';
import type { ValidateKeysPayload } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import {
  processCredentialValidation,
  scheduleCredentialValidationPage,
} from '@/lib/sidedoor/credentials/runtime/credential-validation-work';
import { logger } from '@/lib/logger';

const THROTTLE_MS = 500;

export async function processKeyValidation(
  job: Job<ValidateKeysPayload>,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted();
  await processCredentialValidation(prisma, job, signal);
  await setTimeout(THROTTLE_MS, undefined, { signal });
}

/** Admit one immutable validation job per current credential. */
export async function scheduleAllCredentialValidations(signal?: AbortSignal): Promise<number> {
  let cursor: string | null = null;
  let scheduled = 0;
  do {
    const page = await scheduleCredentialValidationPage(prisma, cursor, signal);
    scheduled += page.scheduled;
    cursor = page.cursor;
  } while (cursor !== null);
  logger.info('Provider credential validation scheduled', { scheduled });
  return scheduled;
}
