// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import type { PrismaClient } from '@/generated/prisma/client';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { captureEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import { validateDurableAuthority } from '@/lib/sidedoor/jobs/core/durable-queue';
import { validatePreparationAudio } from '@/lib/classes/preparation-audio';
import { settlePreparationAudio } from '@/lib/classes/preparation-audio-settlement';
import {
  linkPreparationAudio,
  settlePreparationAudio as setGrantStatus,
} from '../../helpers/runtime/preparation-audio';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('preparation audio lineage and cancellation receipts', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('preparation_audio');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    identity = await instance.reset();
  });
  afterAll(async () => {
    boundary.database = null;
    await instance?.close();
  });

  async function fixture() {
    const episode = await instance.database.episode.create({
      data: {
        userId: identity.ownerId,
        title: 'Listening fixture',
        topic: 'Greetings',
        source: 'CLASS',
      },
    });
    const operation = await linkPreparationAudio(instance.database, identity.ownerId, episode.id);
    const snapshot = await sottoTransaction(instance.database, (tx) =>
      captureEpisodeStorage(tx, episode.id)
    );
    const record = await sottoTransaction(instance.database, (tx) =>
      sottoJobOutbox(tx).enqueue(
        prepareJob({
          id: randomUUID(),
          namespace: SIDEDOOR_STATE_ID,
          handler: 'audio-generation',
          version: 1,
          payload: {
            type: 'generate-audio',
            payload: { episodeId: episode.id },
            authority: {
              kind: 'episode',
              episodeId: episode.id,
              ownerUserId: identity.ownerId,
              userId: identity.ownerId,
              pipelineGeneration: null,
              preparationAudioGenerationKey: 'preparation-audio-fixture',
              snapshot,
            },
          },
          scopes: snapshot.scopes,
          delivery: { attempts: 1, priority: 0, availableAt: Date.now() },
        })
      )
    );
    return { episode, operation, record, snapshot };
  }

  it('rejects generic durable audio authority after parent revocation', async () => {
    const { episode, operation, snapshot } = await fixture();
    await setGrantStatus(instance.database, operation, 'revoked');
    await expect(
      sottoTransaction(instance.database, (tx) =>
        validateDurableAuthority(tx, {
          kind: 'episode',
          episodeId: episode.id,
          ownerUserId: identity.ownerId,
          userId: identity.ownerId,
          pipelineGeneration: null,
          preparationAudioGenerationKey: 'preparation-audio-fixture',
          snapshot,
        })
      )
    ).rejects.toThrow('no longer authorized');
  });

  it('settles cancelled children that never began executing', async () => {
    const { operation, record } = await fixture();
    await setGrantStatus(instance.database, operation, 'revoked');
    expect(
      await sottoTransaction(instance.database, (tx) => settlePreparationAudio(tx, operation))
    ).toEqual({ settled: true, blockingJobs: [] });
    expect(
      await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).read(record.job.id))
    ).toMatchObject({ complete: true });
  });

  it.each(['active', 'cleanup-unconfirmed'] as const)(
    'retains cancellation while child execution is %s',
    async (status) => {
      const { operation, record } = await fixture();
      const execution = {
        id: randomUUID(),
        executorId: randomUUID(),
        parentId: record.job.id,
        fingerprint: record.fingerprint,
      };
      await sottoTransaction(instance.database, async (tx) => {
        await sottoJobExecutions(tx).begin(execution);
        if (status === 'cleanup-unconfirmed')
          await sottoJobExecutions(tx).markCleanupUnconfirmed(execution);
      });
      await setGrantStatus(instance.database, operation, 'revoked');
      expect(
        await sottoTransaction(instance.database, (tx) => settlePreparationAudio(tx, operation))
      ).toEqual({ settled: false, blockingJobs: [record.job.id] });
      expect(
        await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).read(record.job.id))
      ).toMatchObject({ complete: false });
      // The test owns no external resources. This is explicit cleanup proof for its synthetic execution.
      await sottoTransaction(instance.database, (tx) => sottoJobExecutions(tx).settle(execution));
      expect(
        await sottoTransaction(instance.database, (tx) => settlePreparationAudio(tx, operation))
      ).toEqual({ settled: true, blockingJobs: [] });
    }
  );

  it('permits completed parent audio after a newer course operation replaces it', async () => {
    const { episode, operation } = await fixture();
    await setGrantStatus(instance.database, operation, 'completed');
    const second = await instance.database.episode.create({
      data: { userId: identity.ownerId, title: 'New', topic: 'New', source: 'CLASS' },
    });
    await linkPreparationAudio(instance.database, identity.ownerId, second.id);
    await expect(
      sottoTransaction(instance.database, (tx) =>
        validatePreparationAudio(tx, episode.id, 'preparation-audio-fixture')
      )
    ).resolves.toBeUndefined();
  });

  it.each(['expired', 'revoked'])(
    'fences original audio after its grant is %s without blocking fresh learner authority',
    async (state) => {
      const { episode, operation, snapshot } = await fixture();
      await setGrantStatus(
        instance.database,
        operation,
        state === 'revoked' ? 'revoked' : 'completed'
      );
      const clock =
        state === 'expired' ? vi.spyOn(Date, 'now').mockReturnValue(operation.expiresAt + 1) : null;
      try {
        const authority = {
          kind: 'episode' as const,
          episodeId: episode.id,
          ownerUserId: identity.ownerId,
          userId: identity.ownerId,
          pipelineGeneration: null,
          snapshot,
        };
        await expect(
          sottoTransaction(instance.database, (tx) =>
            validateDurableAuthority(tx, {
              ...authority,
              preparationAudioGenerationKey: 'preparation-audio-fixture',
            })
          )
        ).rejects.toThrow('no longer authorized');
        await expect(
          sottoTransaction(instance.database, (tx) =>
            validateDurableAuthority(tx, {
              ...authority,
              preparationAudioGenerationKey: 'new-learner-generation',
            })
          )
        ).resolves.toEqual({ userId: identity.ownerId });
        await expect(
          sottoTransaction(instance.database, (tx) =>
            validatePreparationAudio(tx, episode.id, 'preparation-audio-fixture')
          )
        ).rejects.toThrow('no longer authorized');
      } finally {
        clock?.mockRestore();
      }
    }
  );

  it.each(['fresh', 'legacy'])(
    'cancels original descendants without completing unrelated %s work',
    async (kind) => {
      const { operation, record, snapshot, episode } = await fixture();
      const fresh = await sottoTransaction(instance.database, (tx) =>
        sottoJobOutbox(tx).enqueue(
          prepareJob({
            id: randomUUID(),
            namespace: SIDEDOOR_STATE_ID,
            handler: 'audio-generation',
            version: 1,
            payload:
              kind === 'legacy'
                ? { episodeId: episode.id, segmentId: 'unrelated-segment' }
                : {
                    type: 'generate-audio',
                    payload: { episodeId: episode.id },
                    authority: {
                      kind: 'episode',
                      episodeId: episode.id,
                      ownerUserId: identity.ownerId,
                      userId: identity.ownerId,
                      pipelineGeneration: null,
                      preparationAudioGenerationKey: 'new-learner-generation',
                      snapshot,
                    },
                  },
            scopes: snapshot.scopes,
            delivery: { attempts: 1, priority: 0, availableAt: Date.now() },
          })
        )
      );
      await setGrantStatus(instance.database, operation, 'revoked');
      expect(
        await sottoTransaction(instance.database, (tx) => settlePreparationAudio(tx, operation))
      ).toEqual({ settled: true, blockingJobs: [] });
      expect(
        (await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).read(record.job.id)))
          ?.complete
      ).toBe(true);
      expect(
        (await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).read(fresh.job.id)))
          ?.complete
      ).toBe(false);
    }
  );

  it('rejects episode recreation even when the owner and id are reused', async () => {
    const { episode } = await fixture();
    await instance.database.episode.delete({ where: { id: episode.id } });
    await instance.database.episode.create({
      data: {
        id: episode.id,
        userId: identity.ownerId,
        title: 'Replacement',
        topic: 'Replacement',
        createdAt: new Date(episode.createdAt.getTime() + 1000),
      },
    });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        validatePreparationAudio(tx, episode.id, 'preparation-audio-fixture')
      )
    ).rejects.toThrow('owner changed');
  });
});
