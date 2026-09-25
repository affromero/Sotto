// @vitest-environment node
import { randomUUID, createHash } from 'node:crypto';
import { Client } from 'pg';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  acquirePostgresBackendLock,
  type BackendLock,
  type DedicatedBackendConnection,
} from 'thesidedoor-core/storage';
import { openSottoStorageConnection } from '@/lib/sidedoor/storage/core/storage-connection';

const databaseUrl = process.env.SIDEDOOR_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
suite('dedicated storage ownership with PostgreSQL', () => {
  const connections: DedicatedBackendConnection[] = [];
  const locks: BackendLock[] = [];
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/sidedoor_test')
      throw new Error('Use the isolated local sidedoor_test database');
  });
  afterEach(async () => {
    try {
      for (const lock of locks.splice(0)) await lock.release();
      for (const connection of connections.splice(0)) await connection.close();
    } finally {
      vi.unstubAllEnvs();
    }
  });
  async function openConnection() {
    const connection = await openSottoStorageConnection(databaseUrl);
    connections.push(connection);
    return connection;
  }
  function options() {
    return {
      namespace: `test:${randomUUID()}`,
      binding: createHash('sha256').update(randomUUID()).digest('hex'),
      openConnection,
    };
  }
  async function acquire(input: ReturnType<typeof options>) {
    const lock = await acquirePostgresBackendLock(input);
    locks.push(lock);
    return lock;
  }
  it.each(['direct', 'primary'] as const)(
    'opens a dedicated session using the %s URL',
    async (source) => {
      vi.stubEnv('DIRECT_DATABASE_URL', source === 'direct' ? databaseUrl : undefined);
      vi.stubEnv(
        'DATABASE_URL',
        source === 'primary' ? databaseUrl : 'postgresql://127.0.0.1:1/unreachable'
      );
      const connection = await openSottoStorageConnection();
      connections.push(connection);
      expect(await connection.query('SELECT current_database() AS database', [])).toEqual([
        { database: 'sidedoor_test' },
      ]);
      const lock = await acquire({ ...options(), openConnection: async () => connection });
      lock.assertHeld();
    }
  );
  it('rejects invalid direct configuration while permitting an explicit connection', async () => {
    vi.stubEnv('DIRECT_DATABASE_URL', 'invalid-direct-url');
    vi.stubEnv('DATABASE_URL', databaseUrl);
    await expect(openSottoStorageConnection()).rejects.toThrow('direct PostgreSQL');
    const connection = await openConnection();
    expect(await connection.query('SELECT current_database() AS database', [])).toEqual([
      { database: 'sidedoor_test' },
    ]);
  });
  it('surfaces a failed direct connection without switching to the primary database', async () => {
    vi.stubEnv('DIRECT_DATABASE_URL', 'postgresql://127.0.0.1:1/unreachable');
    vi.stubEnv('DATABASE_URL', databaseUrl);
    await expect(openSottoStorageConnection()).rejects.toThrow();
  });
  it('excludes a competing session while permitting another backend and later reacquisition', async () => {
    const input = options();
    const owner = await acquire(input);
    await expect(acquire(input)).rejects.toThrow('owned by another');
    const other = await acquire({ ...input, binding: 'c'.repeat(64) });
    other.assertHeld();
    await owner.release();
    const replacement = await acquire(input);
    replacement.assertHeld();
  });
  it('signals forced session termination and prevents subsequent queries', async () => {
    const connection = await openConnection();
    const pid = (await connection.query('SELECT pg_backend_pid() AS pid', []))[0]?.pid;
    if (typeof pid !== 'number') throw new Error('Missing test backend PID');
    const lock = await acquire({ ...options(), openConnection: async () => connection });
    const controller = new Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 5_000,
    });
    try {
      await controller.connect();
      await controller.query('SELECT pg_terminate_backend($1)', [pid]);
      await expect.poll(() => lock.signal.aborted).toBe(true);
      expect(() => lock.assertHeld()).toThrow();
      await expect(connection.query('SELECT 1', [])).rejects.toThrow();
    } finally {
      await controller.end();
    }
  });
  it('closes a timed out query session and releases its advisory lock', async () => {
    const connection = await openConnection();
    const input = { ...options(), openConnection: async () => connection };
    const lock = await acquire(input);
    await expect(connection.query('SELECT pg_sleep(10)', [])).rejects.toThrow();
    expect(lock.signal.aborted).toBe(true);
    await expect(connection.query('SELECT 1', [])).rejects.toThrow();
    const replacement = await acquire({ ...input, openConnection });
    replacement.assertHeld();
  }, 15_000);
});
