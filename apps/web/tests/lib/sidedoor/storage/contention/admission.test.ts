// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
import { sottoStorageWriteTransaction } from '@/lib/sidedoor/storage/admission/storage-write-transaction';
import { sottoStateWriteTransaction } from '@/lib/sidedoor/access/state/write-transaction';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../../../helpers/setup/shared-instance';

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
const connections = vi.hoisted(
  () =>
    [] as Array<{
      pid: number;
      schema?: string;
      waiting: Promise<void>;
      lost: Promise<void>;
    }>
);
vi.mock('@/lib/sidedoor/storage/core/storage-connection', async (original) => {
  const actual = await original<typeof import('@/lib/sidedoor/storage/core/storage-connection')>();
  return {
    ...actual,
    openSottoStorageConnection: async (
      ...parameters: Parameters<typeof actual.openSottoStorageConnection>
    ) => {
      const connection = await actual.openSottoStorageConnection(...parameters);
      const [backend] = await connection.query('SELECT pg_backend_pid() AS pid', []);
      if (typeof backend?.pid !== 'number') throw new Error('Expected real storage connection PID');
      let blocked!: () => void;
      let lost!: () => void;
      const waiting = new Promise<void>((resolve) => {
        blocked = resolve;
      });
      const loss = new Promise<void>((resolve) => {
        lost = resolve;
      });
      const unsubscribe = connection.onLoss(() => lost());
      connections.push({ pid: backend.pid, schema: parameters[1], waiting, lost: loss });
      return {
        ...connection,
        query: async (sql: string, values: readonly unknown[]) => {
          const rows = await connection.query(sql, values);
          if (sql.includes('pg_try_advisory_lock') && rows[0]?.acquired === false) blocked();
          return rows;
        },
        close: async () => {
          try {
            await connection.close();
          } finally {
            unsubscribe();
          }
        },
      };
    },
  };
});

function barrier() {
  let resolve!: () => void;
  return {
    promise: new Promise<void>((done) => {
      resolve = done;
    }),
    release: () => resolve(),
  };
}

suite('storage write phase admission with PostgreSQL', () => {
  let instance: SharedTestInstance;
  let other: SharedTestInstance;
  const signal = () => new AbortController().signal;
  beforeAll(async () => {
    instance = await createSharedTestInstance('write_admission');
    other = await createSharedTestInstance('write_independent');
  });
  beforeEach(async () => {
    connections.length = 0;
    await instance.reset();
    await other.reset();
  });
  afterAll(async () => {
    await Promise.all([instance?.close(), other?.close()]);
  });

  async function write(tx: Prisma.TransactionClient, id: string) {
    await tx.$executeRawUnsafe(
      'INSERT INTO "SidedoorState" (id,revision,state) VALUES ($1,$2,$3::jsonb)',
      id,
      randomUUID(),
      JSON.stringify({ published: true })
    );
  }
  async function has(tx: Pick<Prisma.TransactionClient, '$queryRawUnsafe'>, id: string) {
    const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
      'SELECT id FROM "SidedoorState" WHERE id=$1',
      id
    );
    return rows.length === 1;
  }
  async function waiting(operation: Promise<unknown>) {
    await vi.waitFor(() => {
      expect(connections).toHaveLength(2);
    });
    await Promise.race([
      connections[1]!.waiting,
      operation.then(() => {
        throw new Error('Storage phase completed before waiting for its lock');
      }),
    ]);
  }
  async function reached(pause: ReturnType<typeof barrier>, operation: Promise<unknown>) {
    await Promise.race([
      pause.promise,
      operation.then(() => {
        throw new Error('Storage operation completed before its barrier');
      }),
    ]);
  }

  it('starts a waiting state writer with the storage predecessor committed snapshot', async () => {
    const entered = barrier();
    const release = barrier();
    const id = randomUUID();
    const first = sottoStorageWriteTransaction(
      instance.database,
      async (tx) => {
        await write(tx, id);
        entered.release();
        await release.promise;
      },
      signal()
    );
    void first.catch(() => undefined);
    let second: Promise<boolean> | undefined;
    let secondEntered = false;
    try {
      await reached(entered, first);
      second = sottoStateWriteTransaction(
        instance.database,
        async (tx) => {
          secondEntered = true;
          return has(tx, id);
        },
        signal()
      );
      void second.catch(() => undefined);
      await waiting(second);
      expect(new Set(connections.map(({ pid }) => pid)).size).toBe(2);
      expect(secondEntered).toBe(false);
      release.release();
      await first;
      expect(await second).toBe(true);
    } finally {
      release.release();
      await Promise.allSettled([first, ...(second ? [second] : [])]);
    }
  });

  it('allows a different physical schema to commit while the first phase is paused', async () => {
    const entered = barrier();
    const release = barrier();
    const id = randomUUID();
    const first = sottoStorageWriteTransaction(
      instance.database,
      async () => {
        entered.release();
        await release.promise;
      },
      signal()
    );
    void first.catch(() => undefined);
    try {
      await reached(entered, first);
      await sottoStorageWriteTransaction(other.database, (tx) => write(tx, id), signal());
      expect(await has(other.database, id)).toBe(true);
      expect(await has(instance.database, id)).toBe(false);
    } finally {
      release.release();
      await first;
    }
  });

  it('cancels a waiting phase without committing its work', async () => {
    const entered = barrier();
    const release = barrier();
    const first = sottoStorageWriteTransaction(
      instance.database,
      async () => {
        entered.release();
        await release.promise;
      },
      signal()
    );
    void first.catch(() => undefined);
    const controller = new AbortController();
    const cancelled = new Error('Waiting storage admission cancelled');
    const id = randomUUID();
    let second: Promise<void> | undefined;
    try {
      await reached(entered, first);
      second = sottoStorageWriteTransaction(
        instance.database,
        (tx) => write(tx, id),
        controller.signal
      );
      void second.catch(() => undefined);
      await waiting(second);
      controller.abort(cancelled);
      await expect(second).rejects.toThrow();
      expect(await has(instance.database, id)).toBe(false);
    } finally {
      controller.abort(cancelled);
      release.release();
      await Promise.allSettled([first, ...(second ? [second] : [])]);
    }
    await sottoStorageWriteTransaction(instance.database, (tx) => write(tx, id), signal());
    expect(await has(instance.database, id)).toBe(true);
  });

  it('rolls back when its owned lock connection is lost during the callback', async () => {
    const id = randomUUID();
    const entered = barrier();
    const release = barrier();
    const phase = sottoStorageWriteTransaction(
      instance.database,
      async (tx) => {
        await write(tx, id);
        entered.release();
        await release.promise;
      },
      signal()
    );
    void phase.catch(() => undefined);
    try {
      await reached(entered, phase);
      expect(connections).toHaveLength(1);
      const owned = connections[0]!;
      expect(owned.schema).toBe(instance.schema);
      const [lock] = await instance.database.$queryRawUnsafe<{ held: boolean }[]>(
        "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND granted) AS held",
        owned.pid
      );
      expect(lock?.held).toBe(true);
      const [killed] = await instance.database.$queryRawUnsafe<{ terminated: boolean }[]>(
        `SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity
         WHERE pid=$1 AND datname=current_database() AND usename=current_user
           AND application_name='sotto-storage-cleanup' AND backend_type='client backend'`,
        owned.pid
      );
      expect(killed?.terminated).toBe(true);
      await owned.lost;
      release.release();
      await expect(phase).rejects.toThrow();
      expect(await has(instance.database, id)).toBe(false);
    } finally {
      release.release();
      await phase.catch(() => undefined);
    }
    await sottoStorageWriteTransaction(instance.database, (tx) => write(tx, id), signal());
    expect(await has(instance.database, id)).toBe(true);
  });

  it('rolls back a thrown callback and releases admission for its successor', async () => {
    const id = randomUUID();
    const failure = new Error('Publication rejected');
    await expect(
      sottoStorageWriteTransaction(
        instance.database,
        async (tx) => {
          await write(tx, id);
          throw failure;
        },
        signal()
      )
    ).rejects.toBe(failure);
    expect(await has(instance.database, id)).toBe(false);
    await sottoStorageWriteTransaction(instance.database, (tx) => write(tx, id), signal());
    expect(await has(instance.database, id)).toBe(true);
  });
});
