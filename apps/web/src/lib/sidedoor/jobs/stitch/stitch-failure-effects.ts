import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import { z } from 'zod';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import type { InitialStitchOutputs } from '@/lib/sidedoor/jobs/initial/initial-stitch-contract';
import type { captureEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';

/** Failure effects retain the parent's immutable ownership and reserved identities. */
export function prepareStitchFailureEffects(options: {
  operationId: string;
  fingerprint: string;
  episodeId: string;
  userId: string;
  contributorId: string;
  storage: Awaited<ReturnType<typeof captureEpisodeStorage>>;
  outputs: InitialStitchOutputs;
  message: string;
}) {
  const { outputs, episodeId, userId, message } = options;
  return [
    {
      id: outputs.failedNotification,
      handler: 'notifications',
      payload: {
        userId,
        type: 'EPISODE_FAILED',
        title: 'Lesson generation failed',
        message,
        data: { episodeId },
      },
    },
    {
      id: outputs.failedStatus,
      handler: 'episode-status',
      payload: { episodeId, status: 'FAILED' },
    },
  ].map((effect) =>
    prepareJob({
      id: effect.id,
      namespace: SIDEDOOR_STATE_ID,
      handler: effect.handler,
      version: 1,
      payload: z.json().parse({
        ...effect.payload,
        parentOperationId: options.operationId,
        parentFingerprint: options.fingerprint,
        storage: options.storage,
        contributorId: options.contributorId,
      }),
      scopes: options.storage.scopes,
      delivery: { attempts: 3, priority: 0, availableAt: 0 },
    })
  );
}
