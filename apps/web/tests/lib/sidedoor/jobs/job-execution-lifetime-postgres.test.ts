// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { executeCodex } from '@/lib/codex-client';
import { isDurableQueueCleanupFailure } from '@/lib/sidedoor/jobs/core/durable-queue';
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
  it('keeps lost remote schema cleanup unresolved and prevents another provider execution', async () => {
    const { options, unresolved } = await fixture();
    const directory = await mkdtemp(join(tmpdir(), 'sotto-lost-schema-'));
    const originalEnv = process.env;
    try {
      await writeFile(
        join(directory, 'ssh'),
        '#!' +
          process.execPath +
          '\n' +
          'process.stdin.resume();process.stdin.on("end",()=>{' +
          'console.log(JSON.stringify({type:"item.completed",item:{id:"answer",type:"agent_message",text:"Answer"}}));' +
          'console.log(JSON.stringify({type:"turn.completed",usage:{input_tokens:20,output_tokens:7}}));});',
        { mode: 0o700 }
      );
      process.env = { ...originalEnv, PATH: directory, CODEX_SSH_HOST: 'fixture-host' };
      const failure = await withSottoJobExecution({
        ...options,
        isCleanupFailure: isDurableQueueCleanupFailure,
        run: async () =>
          executeCodex('', 'Prompt', {
            jsonSchema: { name: 'answer', schema: { type: 'object' } },
          }),
      }).catch((error: unknown) => error);
      expect(isDurableQueueCleanupFailure(failure)).toBe(true);
      expect((await unresolved()).executions).toMatchObject([{ status: 'cleanup-unconfirmed' }]);
      let repeated = false;
      await expect(
        withSottoJobExecution({
          ...options,
          isCleanupFailure: isDurableQueueCleanupFailure,
          run: async () => {
            repeated = true;
            return 'Repeated';
          },
        })
      ).rejects.toThrow();
      expect(repeated).toBe(false);
      expect((await unresolved()).executions).toMatchObject([{ status: 'cleanup-unconfirmed' }]);
    } finally {
      process.env = originalEnv;
      await rm(directory, { recursive: true, force: true });
    }
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
