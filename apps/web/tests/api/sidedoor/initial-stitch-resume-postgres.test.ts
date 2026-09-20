// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { POST } from '@/app/api/v1/episodes/[episodeId]/generate/route';
import { audioStitchingQueue } from '@/lib/queue';
import { closeRedis } from '@/lib/redis';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { verifyCurrentInitialStitch } from '@/lib/sidedoor/jobs/initial/initial-stitch-admission';
import { createRegenerationSource } from '../../helpers/runtime/regeneration-source';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => {
  const configured = process.env.SIDEDOOR_TEST_REDIS_URL;
  if (configured) {
    const url = new URL(configured);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/15')
      throw new Error('Use disposable local Redis database 15');
    vi.stubEnv('REDIS_URL', configured);
  }
  return { database: null as PrismaClient | null };
});
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
const suite =
  process.env.SIDEDOOR_TEST_DATABASE_URL && process.env.SIDEDOOR_TEST_REDIS_URL
    ? describe
    : describe.skip;
suite('initial stitching resume through HTTP and canonical admission', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let directory: string;
  let queued: string[];
  beforeAll(async () => {
    instance = await createSharedTestInstance('initial_resume');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    identity = await instance.reset();
    directory = await mkdtemp(join(tmpdir(), 'sotto-resume-'));
    queued = [];
    vi.stubEnv('STORAGE_PROVIDER', 'local');
    vi.stubEnv('LOCAL_STORAGE_DIR', directory);
  });
  afterEach(async () => {
    for (const id of queued) await (await audioStitchingQueue.getJob(id))?.remove();
    await rm(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await audioStitchingQueue.close();
    await closeRedis();
    await instance?.close();
  });
  it.each(['own', 'another-profile'] as const)(
    'preserves owner authority when resuming an %s episode',
    async (owner) => {
      const userId = owner === 'own' ? identity.ownerId : (await identity.household('Learner')).id;
      const { episode } = await createRegenerationSource(
        instance.database,
        userId,
        directory,
        Buffer.from('audio')
      );
      await instance.database.episode.update({
        where: { id: episode.id },
        data: {
          status: 'FAILED',
          failedAtStatus: 'STITCHING',
          audioGenerationKey: 'resume-generation',
        },
      });
      const request = new NextRequest(
        `http://localhost:3000/api/v1/episodes/${episode.id}/generate`,
        {
          method: 'POST',
          headers: { cookie: `sotto_session=${identity.ownerToken}` },
        }
      );
      const response = await POST(request, { params: Promise.resolve({ episodeId: episode.id }) });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ resumedAt: 'STITCH_AUDIO' });
      const { record, payload } = await sottoTransaction(instance.database, (tx) =>
        verifyCurrentInitialStitch(tx, async () => ({ userId }), episode.id, 'resume-generation')
      );
      queued.push(record.job.id);
      expect(payload.inputs.storage.userId).toBe(userId);
      expect(payload.soundPolicy).toBe('elevenlabs');
      expect((await audioStitchingQueue.getJob(record.job.id))?.data).toEqual({
        operationId: record.job.id,
        fingerprint: record.fingerprint,
      });
    }
  );
});
