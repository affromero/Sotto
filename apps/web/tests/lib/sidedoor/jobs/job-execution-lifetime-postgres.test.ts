// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import { AccessError } from 'thesidedoor-core/access';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import {
  withSottoJobExecution,
  sottoJobExecutions,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { isMediaCleanupFailure } from '@/lib/audio/media-process';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../../helpers/setup/shared-instance';

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('durable execution admission and cleanup', () => {
  let instance: SharedTestInstance;
  beforeAll(async () => {
    instance = await createSharedTestInstance('execution_lifetime');
  });
  beforeEach(async () => {
    await instance.reset();
  });
  afterAll(async () => {
    await instance?.close();
  });
  async function fixture() {
    const scope = { subjectId: `episode:${randomUUID()}`, generation: 0 };
    const parent = await sottoTransaction(instance.database, (tx) =>
      sottoJobOutbox(tx).enqueue(
        prepareJob({
          namespace: SIDEDOOR_STATE_ID,
          handler: 'audio-stitching',
          version: 2,
          payload: {},
          scopes: [scope],
          delivery: { attempts: 2, priority: 0, availableAt: 0 },
        })
      )
    );
    const options = {
      database: instance.database,
      parentId: parent.job.id,
      fingerprint: parent.fingerprint,
      signal: new AbortController().signal,
      validate: async (tx: Prisma.TransactionClient) =>
        !(await sottoJobOutbox(tx).read(parent.job.id))!.complete,
      isCleanupFailure: isMediaCleanupFailure,
    };
    const unresolved = () =>
      sottoTransaction(instance.database, (tx) => sottoJobExecutions(tx).listUnresolved(scope));
    return { options, unresolved };
  }
  function loseCommitResponse(afterCommit: (result: unknown) => boolean) {
    return new Proxy(instance.database, {
      get(target, property, receiver) {
        if (property !== '$transaction') return Reflect.get(target, property, receiver);
        return async (
          operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
          options?: Parameters<PrismaClient['$transaction']>[1]
        ) => {
          const result = await target.$transaction(operation, options);
          if (afterCommit(result)) throw new Error('Connection lost after COMMIT');
          return result;
        };
      },
    });
  }
  it('registers before work and settles an ordinary failure after cleanup', async () => {
    const { options, unresolved } = await fixture();
    const reason = new Error('Invalid source audio');
    await expect(
      withSottoJobExecution({
        ...options,
        run: async () => {
          expect((await unresolved()).executions).toMatchObject([
            { parentId: options.parentId, status: 'active' },
          ]);
          throw reason;
        },
      })
    ).rejects.toBe(reason);
    expect((await unresolved()).executions).toEqual([]);
  });
  it('keeps uncertain cancelled effects unresolved instead of reporting clean cancellation', async () => {
    const { options, unresolved } = await fixture();
    const controller = new AbortController();
    const reason = new Error('Worker cancelled');
    await expect(
      withSottoJobExecution({
        ...options,
        signal: controller.signal,
        run: async ({ markCleanupUnconfirmed }) => {
          markCleanupUnconfirmed();
          controller.abort(reason);
          throw reason;
        },
      })
    ).rejects.toMatchObject({ errors: [reason, expect.any(Error)] });
    expect((await unresolved()).executions).toMatchObject([{ status: 'cleanup-unconfirmed' }]);
  });
  it.each(['eligible', 'cancelled', 'revoked', 'revoked-wrapped'] as const)(
    'recovers an accepted admission COMMIT when work becomes %s',
    async (mode) => {
      const { options, unresolved } = await fixture();
      const controller = new AbortController();
      const stopped = new Error('Worker stopped after admission');
      let interrupted = false;
      let eligible = true;
      let performed = false;
      const database = loseCommitResponse(() => {
        if (interrupted) return false;
        interrupted = true;
        if (mode === 'cancelled') controller.abort(stopped);
        if (mode.startsWith('revoked')) eligible = false;
        return true;
      });
      const running = withSottoJobExecution({
        ...options,
        database,
        signal: controller.signal,
        validate: async (tx) => {
          if (!eligible) {
            const error = new AccessError('forbidden', 'Authority revoked');
            throw mode === 'revoked-wrapped'
              ? new AggregateError([error], 'Authority revoked')
              : error;
          }
          return options.validate(tx);
        },
        run: async () => {
          performed = true;
          return 'published';
        },
      });
      if (mode === 'eligible') await expect(running).resolves.toBe('published');
      else if (mode === 'cancelled') await expect(running).rejects.toBe(stopped);
      else await expect(running).rejects.toThrow('Authority revoked');
      expect(performed).toBe(mode === 'eligible');
      expect((await unresolved()).executions).toEqual([]);
    }
  );
  it('recovers a committed cleanup receipt without repeating completed effects', async () => {
    const { options, unresolved } = await fixture();
    let finished = false;
    let interrupted = false;
    const database = loseCommitResponse((result) => {
      if (!finished || interrupted || result !== undefined) return false;
      interrupted = true;
      return true;
    });
    expect(
      await withSottoJobExecution({
        ...options,
        database,
        run: async () => {
          if (finished) throw new Error('Effects were repeated');
          finished = true;
          return 'published';
        },
      })
    ).toBe('published');
    expect(interrupted).toBe(true);
    expect((await unresolved()).executions).toEqual([]);
  });
});
