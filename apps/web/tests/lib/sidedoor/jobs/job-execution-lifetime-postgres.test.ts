// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import { AccessError } from 'thesidedoor-core/access';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import {
  withSottoJobExecution,
  sottoJobExecutions,
  resolveSottoExecutionDirectory,
  runSottoExecutionOperation,
  finishSottoExecutionOperations,
  assertSottoExecutionOperation,
  assertSottoExecutionStopped,
  isSottoExecutionUncertain,
  hasSottoExecutionFailure,
  verifySottoExecutionOperation,
  runSottoExecutionTransaction,
  type SottoJobExecutionOperation,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { hasSettledSottoExecution } from '@/lib/sidedoor/jobs/core/job-settlement-proof';
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
    return { options, unresolved, scope };
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
  it('requires a retained settled execution and rejects a missing journal record', async () => {
    const { options } = await fixture();
    const identity = { id: options.parentId, fingerprint: options.fingerprint };
    const check = () =>
      sottoTransaction(instance.database, (tx) => hasSettledSottoExecution(tx, identity));
    expect(await check()).toBe(false);
    await withSottoJobExecution({
      ...options,
      run: async () => {
        expect(await check()).toBe(false);
      },
    });
    expect(await check()).toBe(true);
    const rows = await instance.database.$queryRaw<{ id: string }[]>`
      SELECT id FROM "SidedoorState"
      WHERE (id LIKE 'sd-jeg:1:%' AND id LIKE ${`%:${identity.id}`})
         OR (state->>'kind' = 'job_execution' AND state->>'parentId' = ${identity.id})`;
    expect(rows).toHaveLength(2);
    for (const row of rows)
      await expect(
        sottoTransaction(instance.database, async (tx) => {
          await tx.sidedoorState.delete({ where: { id: row.id } });
          expect(await hasSettledSottoExecution(tx, identity)).toBe(false);
          throw new Error('Roll back removed execution');
        })
      ).rejects.toThrow('Roll back removed execution');
    expect(await check()).toBe(true);
  });
  it('registers before work and settles an ordinary failure after cleanup', async () => {
    const { options, unresolved } = await fixture();
    const reason = new Error('Invalid source audio');
    await expect(
      withSottoJobExecution({
        ...options,
        run: async ({ directory }) => {
          expect((await stat(directory)).mode & 0o777).toBe(0o700);
          expect(relative(await realpath(resolveSottoExecutionDirectory()), directory)).not.toMatch(
            /^\.\./
          );
          expect((await unresolved()).executions).toMatchObject([
            { parentId: options.parentId, status: 'active' },
          ]);
          throw reason;
        },
      })
    ).rejects.toBe(reason);
    expect((await unresolved()).executions).toEqual([]);
  });
  it('retains registered failure evidence only for the stopped execution', async () => {
    const { options, scope } = await fixture();
    let retained: object | undefined;
    await expect(
      withSottoJobExecution({
        ...options,
        capabilityScope: scope,
        run: async ({ capability }) => {
          if (!capability) throw new Error('Execution capability missing');
          retained = capability;
          expect(() => hasSottoExecutionFailure(capability)).toThrow();
          await runSottoExecutionOperation(
            capability,
            { parentId: options.parentId, fingerprint: options.fingerprint },
            async () => {
              throw new Error('Assessment operation failed');
            }
          );
        },
      })
    ).rejects.toThrow('Assessment operation failed');
    if (!retained) throw new Error('Execution capability missing');
    expect(hasSottoExecutionFailure(retained)).toBe(true);
    expect(isSottoExecutionUncertain(retained)).toBe(false);
    expect(() => hasSottoExecutionFailure({ ...retained })).toThrow();
  });
  it('keeps execution authority bound to its original job and lifetime', async () => {
    const { options, scope } = await fixture();
    let retained: SottoJobExecutionOperation | undefined;
    await withSottoJobExecution({
      ...options,
      capabilityScope: scope,
      run: async ({ capability }) => {
        expect(capability).toBeDefined();
        const expected = { parentId: options.parentId, fingerprint: options.fingerprint };
        await runSottoExecutionOperation(capability!, expected, async (operation) => {
          retained = operation;
          const exposed = assertSottoExecutionOperation(operation, expected);
          exposed.parentId = 'another-job';
          expect(() =>
            assertSottoExecutionOperation(operation, { ...expected, parentId: 'another-job' })
          ).toThrow('The durable execution capability is unavailable');
          expect(assertSottoExecutionOperation(operation, expected).parentId).toBe(
            expected.parentId
          );
        });
      },
    });
    expect(() =>
      assertSottoExecutionOperation(retained!, {
        parentId: options.parentId,
        fingerprint: options.fingerprint,
      })
    ).toThrow('The durable execution operation is unavailable');
  });
  it('does not transfer authority to another active job or a copied token', async () => {
    const first = await fixture();
    const second = await fixture();
    let retained: object | undefined;
    await withSottoJobExecution({
      ...first.options,
      capabilityScope: first.scope,
      run: async ({ capability }) => {
        if (!capability) throw new Error('Execution capability was not issued');
        retained = capability;
        expect(() => assertSottoExecutionStopped(capability)).toThrow();
        expect(isSottoExecutionUncertain(capability)).toBe(false);
        expect(() => assertSottoExecutionStopped({ ...capability })).toThrow();
        await withSottoJobExecution({
          ...second.options,
          capabilityScope: second.scope,
          run: async ({ capability: other }) => {
            if (!other) throw new Error('Second execution capability was not issued');
            const expected = {
              parentId: second.options.parentId,
              fingerprint: second.options.fingerprint,
            };
            expect(() => runSottoExecutionOperation(capability, expected, async () => {})).toThrow(
              'The durable execution capability is unavailable'
            );
            expect(() =>
              runSottoExecutionOperation({ ...other }, expected, async () => {})
            ).toThrow('The durable execution capability is unavailable');
            await runSottoExecutionOperation(other, expected, async (operation) => {
              expect(assertSottoExecutionOperation(operation, expected).parentId).toBe(
                expected.parentId
              );
            });
          },
        });
      },
    });
    if (!retained) throw new Error('Execution capability was not issued');
    const stopped = retained;
    expect(() => assertSottoExecutionStopped(stopped)).not.toThrow();
    expect(isSottoExecutionUncertain(stopped)).toBe(false);
  });
  it('waits for detached work before settling and revokes later effects', async () => {
    const { options, scope, unresolved } = await fixture();
    let release!: () => void;
    let closing!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const closed = new Promise<void>((resolve) => {
      closing = resolve;
    });
    const expected = { parentId: options.parentId, fingerprint: options.fingerprint };
    const running = withSottoJobExecution({
      ...options,
      capabilityScope: scope,
      run: async ({ capability }) => {
        if (!capability) throw new Error('Execution capability was not issued');
        void runSottoExecutionOperation(capability, expected, async (operation, signal) => {
          signal.addEventListener('abort', closing, { once: true });
          await blocked;
          expect(() => assertSottoExecutionOperation(operation, expected)).toThrow();
        });
        return 'done';
      },
    });
    await closed;
    expect((await unresolved()).executions).toMatchObject([{ status: 'active' }]);
    release();
    await expect(running).resolves.toBe('done');
    expect((await unresolved()).executions).toEqual([]);
  });
  it('does not complete parent work until registered operations drain', async () => {
    const { options, scope, unresolved } = await fixture();
    const expected = { parentId: options.parentId, fingerprint: options.fingerprint };
    let release!: () => void;
    let sealed!: () => void;
    let notifyStarted!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const closing = new Promise<void>((resolve) => {
      sealed = resolve;
    });
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    let completed = false;
    const running = withSottoJobExecution({
      ...options,
      capabilityScope: scope,
      run: async ({ capability }) => {
        if (!capability) throw new Error('Execution capability was not issued');
        void runSottoExecutionOperation(capability, expected, async (operation, signal) => {
          assertSottoExecutionOperation(operation, expected);
          signal.addEventListener('abort', sealed, { once: true });
          notifyStarted();
          await pending;
        });
        await started;
        await finishSottoExecutionOperations(capability);
        completed = true;
      },
    });
    await closing;
    expect(completed).toBe(false);
    expect((await unresolved()).executions).toMatchObject([{ status: 'active' }]);
    release();
    await running;
    expect(completed).toBe(true);
    expect((await unresolved()).executions).toEqual([]);
  });
  it('propagates detached operation failures before cleanup', async () => {
    const { options, scope, unresolved } = await fixture();
    const failure = new Error('Detached publication failed');
    await expect(
      withSottoJobExecution({
        ...options,
        capabilityScope: scope,
        run: async ({ capability }) => {
          if (!capability) throw new Error('Execution capability was not issued');
          void runSottoExecutionOperation(
            capability,
            {
              parentId: options.parentId,
              fingerprint: options.fingerprint,
            },
            async () => {
              throw failure;
            }
          ).catch(() => {});
        },
      })
    ).rejects.toBe(failure);
    expect((await unresolved()).executions).toEqual([]);
  });
  it('honors an explicit transaction timeout for execution work', async () => {
    const { options, scope } = await fixture();
    const expected = { parentId: options.parentId, fingerprint: options.fingerprint };
    await expect(
      withSottoJobExecution({
        ...options,
        capabilityScope: scope,
        run: async ({ capability }) => {
          if (!capability) throw new Error('Execution capability was not issued');
          await runSottoExecutionTransaction(
            capability,
            expected,
            instance.database,
            async (tx) => {
              await tx.$executeRaw`SELECT pg_sleep(0.2)`;
            },
            { timeoutMs: 50 }
          );
        },
      })
    ).rejects.toThrow(/expired transaction/);
  });
  it('rolls back a detached transaction that continues after execution closes', async () => {
    const { options, scope, unresolved } = await fixture();
    const expected = { parentId: options.parentId, fingerprint: options.fingerprint };
    const id = `detached-transaction:${randomUUID()}`;
    let release!: () => void;
    let notifyStarted!: () => void;
    let notifyClosed!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const closed = new Promise<void>((resolve) => {
      notifyClosed = resolve;
    });
    const running = withSottoJobExecution({
      ...options,
      capabilityScope: scope,
      run: async ({ capability }) => {
        if (!capability) throw new Error('Execution capability was not issued');
        void runSottoExecutionTransaction(capability, expected, instance.database, async (tx) => {
          await tx.sidedoorState.create({ data: { id, revision: randomUUID(), state: {} } });
          notifyStarted();
          await blocked;
        }).catch(() => {});
        void runSottoExecutionOperation(capability, expected, async (operation, signal) => {
          assertSottoExecutionOperation(operation, expected);
          await new Promise<void>((resolve) =>
            signal.addEventListener(
              'abort',
              () => {
                notifyClosed();
                resolve();
              },
              { once: true }
            )
          );
        }).catch(() => {});
        await started;
      },
    });
    const outcome = running.then(
      () => null,
      (error: unknown) => error
    );
    await closed;
    expect((await unresolved()).executions).toMatchObject([{ status: 'active' }]);
    release();
    expect(await outcome).toBeInstanceOf(Error);
    expect(await instance.database.sidedoorState.findUnique({ where: { id } })).toBeNull();
    expect((await unresolved()).executions).toEqual([]);
  });
  it('acquires domain locks before the execution fence when cleanup uses that order', async () => {
    const { options, scope } = await fixture();
    const expected = { parentId: options.parentId, fingerprint: options.fingerprint };
    const domainId = `domain-lock:${randomUUID()}`;
    await instance.database.sidedoorState.create({
      data: { id: domainId, revision: randomUUID(), state: {} },
    });
    let cleanupReady!: () => void;
    let allowCleanup!: () => void;
    let preparing!: () => void;
    const ready = new Promise<void>((resolve) => {
      cleanupReady = resolve;
    });
    const proceed = new Promise<void>((resolve) => {
      allowCleanup = resolve;
    });
    const preparationStarted = new Promise<void>((resolve) => {
      preparing = resolve;
    });
    let published = false;
    await expect(
      withSottoJobExecution({
        ...options,
        capabilityScope: scope,
        run: async ({ capability }) => {
          if (!capability) throw new Error('Execution capability was not issued');
          const binding = await runSottoExecutionOperation(
            capability,
            expected,
            async (operation) => assertSottoExecutionOperation(operation, expected)
          );
          const cleanup = sottoTransaction(instance.database, async (tx) => {
            await tx.$queryRaw`SELECT id FROM "SidedoorState" WHERE id = ${domainId} FOR UPDATE`;
            cleanupReady();
            await proceed;
            await sottoJobExecutions(tx).markCleanupUnconfirmed(binding);
          });
          await ready;
          const publication = runSottoExecutionTransaction(
            capability,
            expected,
            instance.database,
            async () => {
              published = true;
            },
            {
              prepare: async (tx) => {
                preparing();
                await tx.$queryRaw`SELECT id FROM "SidedoorState" WHERE id = ${domainId} FOR UPDATE`;
              },
            }
          );
          const result = publication.then(
            () => null,
            (error: unknown) => error
          );
          await preparationStarted;
          allowCleanup();
          await cleanup;
          expect(await result).toBeInstanceOf(Error);
        },
      })
    ).rejects.toThrow('The durable execution is no longer active');
    expect(published).toBe(false);
  });
  it('does not publish after cancellation while waiting for a domain lock', async () => {
    const { options, scope } = await fixture();
    const controller = new AbortController();
    const expected = { parentId: options.parentId, fingerprint: options.fingerprint };
    const domainId = `domain-lock:${randomUUID()}`;
    await instance.database.sidedoorState.create({
      data: { id: domainId, revision: randomUUID(), state: {} },
    });
    let locked!: () => void;
    let unlock!: () => void;
    let waiting!: () => void;
    const lockReady = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const release = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const preparationStarted = new Promise<void>((resolve) => {
      waiting = resolve;
    });
    const blocker = sottoTransaction(instance.database, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "SidedoorState" WHERE id = ${domainId} FOR UPDATE`;
      locked();
      await release;
    });
    await lockReady;
    let published = false;
    const running = withSottoJobExecution({
      ...options,
      signal: controller.signal,
      capabilityScope: scope,
      run: async ({ capability }) => {
        if (!capability) throw new Error('Execution capability was not issued');
        await runSottoExecutionTransaction(
          capability,
          expected,
          instance.database,
          async () => {
            published = true;
          },
          {
            prepare: async (tx) => {
              waiting();
              await tx.$queryRaw`SELECT id FROM "SidedoorState" WHERE id = ${domainId} FOR UPDATE`;
            },
          }
        );
      },
    });
    const outcome = running.then(
      () => null,
      (error: unknown) => error
    );
    await preparationStarted;
    controller.abort();
    unlock();
    await blocker;
    expect(await outcome).toBeInstanceOf(Error);
    expect(published).toBe(false);
  });
  it('never starts registered work after cleanup becomes uncertain', async () => {
    const { options, scope, unresolved } = await fixture();
    let started = false;
    await expect(
      withSottoJobExecution({
        ...options,
        capabilityScope: scope,
        run: async ({ capability, markCleanupUnconfirmed }) => {
          if (!capability) throw new Error('Execution capability was not issued');
          void runSottoExecutionOperation(
            capability,
            { parentId: options.parentId, fingerprint: options.fingerprint },
            async () => {
              started = true;
            }
          ).catch(() => {});
          markCleanupUnconfirmed();
        },
      })
    ).rejects.toThrow();
    expect(started).toBe(false);
    expect((await unresolved()).executions).toMatchObject([{ status: 'cleanup-unconfirmed' }]);
  });
  it('retains the workspace if detached work does not settle', async () => {
    const { options, scope, unresolved } = await fixture();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await expect(
      withSottoJobExecution({
        ...options,
        capabilityScope: scope,
        run: async ({ capability }) => {
          if (!capability) throw new Error('Execution capability was not issued');
          void runSottoExecutionOperation(
            capability,
            { parentId: options.parentId, fingerprint: options.fingerprint },
            async () => pending
          ).catch(() => {});
        },
      })
    ).rejects.toThrow('Execution operations did not settle during cleanup');
    const executions = (await unresolved()).executions;
    expect(executions).toMatchObject([
      { status: 'cleanup-unconfirmed', workspace: expect.any(Object) },
    ]);
    release();
  }, 15000);
  it('holds the execution fence until the publication transaction ends', async () => {
    const { options, scope } = await fixture();
    await withSottoJobExecution({
      ...options,
      capabilityScope: scope,
      run: async ({ capability }) => {
        if (!capability) throw new Error('Execution capability was not issued');
        const expected = { parentId: options.parentId, fingerprint: options.fingerprint };
        await runSottoExecutionOperation(capability, expected, async (operation) => {
          const binding = assertSottoExecutionOperation(operation, expected);
          await instance.database.$transaction(async (tx) => {
            await verifySottoExecutionOperation(tx, operation, expected);
            await expect(
              instance.database.$transaction(async (other) => {
                await other.$executeRaw`SET LOCAL lock_timeout = '200ms'`;
                await sottoJobExecutions(other).markCleanupUnconfirmed(binding);
              })
            ).rejects.toThrow(/lock timeout/i);
          });
          await sottoTransaction(instance.database, (tx) =>
            verifySottoExecutionOperation(tx, operation, expected)
          );
          await sottoTransaction(instance.database, (tx) =>
            sottoJobExecutions(tx).markCleanupUnconfirmed(binding)
          );
          await expect(
            sottoTransaction(instance.database, (tx) =>
              verifySottoExecutionOperation(tx, operation, expected)
            )
          ).rejects.toThrow('The durable execution is no longer active');
        });
      },
    });
  });
  it('rejects a stale snapshot after cleanup status changes', async () => {
    const { options, scope } = await fixture();
    await withSottoJobExecution({
      ...options,
      capabilityScope: scope,
      run: async ({ capability }) => {
        if (!capability) throw new Error('Execution capability was not issued');
        const expected = { parentId: options.parentId, fingerprint: options.fingerprint };
        await runSottoExecutionOperation(capability, expected, async (operation) => {
          const binding = assertSottoExecutionOperation(operation, expected);
          await expect(
            instance.database.$transaction(
              async (tx) => {
                await sottoJobExecutions(tx).read(binding);
                await sottoTransaction(instance.database, (other) =>
                  sottoJobExecutions(other).markCleanupUnconfirmed(binding)
                );
                await verifySottoExecutionOperation(tx, operation, expected);
              },
              { isolationLevel: 'Serializable' }
            )
          ).rejects.toThrow(/serializ/i);
        });
      },
    });
  });
  it('revokes execution authority as soon as cancellation is requested', async () => {
    const { options, scope } = await fixture();
    const controller = new AbortController();
    await expect(
      withSottoJobExecution({
        ...options,
        signal: controller.signal,
        capabilityScope: scope,
        run: async ({ capability }) => {
          if (!capability) throw new Error('Execution capability was not issued');
          const expected = { parentId: options.parentId, fingerprint: options.fingerprint };
          await runSottoExecutionOperation(capability, expected, async (operation) => {
            controller.abort();
            expect(() => assertSottoExecutionOperation(operation, expected)).toThrow(
              'The durable execution capability is unavailable'
            );
            controller.signal.throwIfAborted();
          });
        },
      })
    ).rejects.toThrow();
  });
  it('revokes execution authority when cleanup becomes uncertain', async () => {
    const { options, scope, unresolved } = await fixture();
    await expect(
      withSottoJobExecution({
        ...options,
        capabilityScope: scope,
        run: async ({ capability, markCleanupUnconfirmed }) => {
          if (!capability) throw new Error('Execution capability was not issued');
          const expected = { parentId: options.parentId, fingerprint: options.fingerprint };
          await runSottoExecutionOperation(capability, expected, async (operation) => {
            markCleanupUnconfirmed();
            expect(isSottoExecutionUncertain(capability)).toBe(true);
            expect(() => assertSottoExecutionStopped(capability)).not.toThrow();
            expect(() => assertSottoExecutionOperation(operation, expected)).toThrow(
              'The durable execution capability is unavailable'
            );
          });
          await expect(finishSottoExecutionOperations(capability)).rejects.toThrow(
            'Execution cleanup is unconfirmed'
          );
        },
      })
    ).rejects.toThrow('Execution cleanup is unconfirmed');
    expect((await unresolved()).executions).toMatchObject([{ status: 'cleanup-unconfirmed' }]);
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
