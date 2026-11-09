// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  prepareStorageBackend,
  prepareStorageReference,
  prepareStorageWrite,
  storageBackendBinding,
  StorageBackendRegistry,
  StorageReferenceRegistry,
  StorageWriteJournal,
} from 'thesidedoor-core/storage';

const databaseUrl = process.env.SIDEDOOR_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

suite('storage target fence for older writers', () => {
  const schema = `legacy_target_${randomUUID().replaceAll('-', '')}`;
  let database: Client;

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/sidedoor_test')
      throw new Error('Use the isolated local sidedoor_test database');
    database = new Client({
      connectionString: databaseUrl,
      options: `-c search_path=${schema},public`,
    });
    await database.connect();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      'CREATE TABLE "SidedoorState" (id TEXT PRIMARY KEY, revision TEXT NOT NULL, state JSONB NOT NULL)'
    );
    await database.query(
      await readFile('prisma/migrations/20261108030000_storage_target_fence/migration.sql', 'utf8')
    );
  });

  afterAll(async () => {
    if (!database) return;
    await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await database.end();
  });

  const target = { binding: 'a'.repeat(64), key: 'worksheets/чай.pdf' };
  const targetId = createHash('sha256')
    .update(JSON.stringify([target.binding, target.key]))
    .digest('hex');
  const gateId = `sd-tf:1:${targetId}`;
  const retired = {
    kind: 'storage_target_fence',
    target: targetId,
    status: 'retired',
    retirement: 'b'.repeat(64),
  };

  it('rejects older writes and allocations after retirement and preserves its fence', async () => {
    await database.query('INSERT INTO "SidedoorState" VALUES ($1,$2,$3::jsonb)', [
      gateId,
      randomUUID(),
      JSON.stringify(retired),
    ]);
    const attempts = [
      { kind: 'write', target },
      { kind: 'storage_asset', prepared: { target }, consumers: ['class:other:worksheet'] },
    ];
    for (const state of attempts)
      await expect(
        database.query('INSERT INTO "SidedoorState" VALUES ($1,$2,$3::jsonb)', [
          `${state.kind === 'write' ? 'sd-w:1:' : 'sd-asset:1:'}${randomUUID()}`,
          randomUUID(),
          JSON.stringify(state),
        ])
      ).rejects.toThrow('Storage target is retired');
    await expect(
      database.query('DELETE FROM "SidedoorState" WHERE id=$1', [gateId])
    ).rejects.toThrow('retirement is permanent');
    await expect(
      database.query(
        'UPDATE "SidedoorState" SET state=jsonb_set(state,\'{status}\',\'"open"\') WHERE id=$1',
        [gateId]
      )
    ).rejects.toThrow('retirement is permanent');
    await expect(
      database.query('UPDATE "SidedoorState" SET id=$2 WHERE id=$1', [gateId, randomUUID()])
    ).rejects.toThrow('retirement is permanent');
    expect(
      (await database.query('SELECT state FROM "SidedoorState" WHERE id=$1', [gateId])).rows[0]
        ?.state
    ).toEqual(retired);
  });

  it('serializes an older write with a concurrent retirement', async () => {
    const writer = new Client({
      connectionString: databaseUrl,
      options: `-c search_path=${schema},public`,
    });
    const retire = new Client({
      connectionString: databaseUrl,
      options: `-c search_path=${schema},public`,
    });
    const key = { binding: 'c'.repeat(64), key: 'worksheets/concurrent.pdf' };
    const id = `sd-tf:1:${createHash('sha256')
      .update(JSON.stringify([key.binding, key.key]))
      .digest('hex')}`;
    await Promise.all([writer.connect(), retire.connect()]);
    try {
      await writer.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await writer.query('INSERT INTO "SidedoorState" VALUES ($1,$2,$3::jsonb)', [
        `sd-w:1:${randomUUID()}`,
        randomUUID(),
        JSON.stringify({ kind: 'write', target: key }),
      ]);
      await retire.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await retire.query('SELECT state FROM "SidedoorState" WHERE id=$1', [id]);
      const attempted = retire
        .query(
          'INSERT INTO "SidedoorState" VALUES ($1,$2,$3::jsonb) ON CONFLICT (id) DO UPDATE SET state=EXCLUDED.state',
          [
            id,
            randomUUID(),
            JSON.stringify({
              kind: 'storage_target_fence',
              target: id.slice('sd-tf:1:'.length),
              status: 'retired',
              retirement: 'd'.repeat(64),
            }),
          ]
        )
        .then(
          () => null,
          (error: unknown) => error
        );
      await writer.query('COMMIT');
      expect(await attempted).toMatchObject({ code: '40001' });
      await retire.query('ROLLBACK');
    } finally {
      await Promise.all([writer.end(), retire.end()]);
    }
  });

  it('does not treat unrelated state named write as a storage intent', async () => {
    const id = `unrelated:${randomUUID()}`;
    await database.query('INSERT INTO "SidedoorState" VALUES ($1,$2,$3::jsonb)', [
      id,
      randomUUID(),
      JSON.stringify({ kind: 'write' }),
    ]);
    expect(
      (await database.query('SELECT state FROM "SidedoorState" WHERE id=$1', [id])).rows[0]?.state
    ).toEqual({ kind: 'write' });
  });

  it.each([
    'worksheets/plain.pdf',
    'worksheets/"quoted".pdf',
    'worksheets/🦉.pdf',
    'worksheets/\u2028.pdf',
  ])('matches Sidedoor target identity for %s', async (key) => {
    const binding = '7'.repeat(64);
    const id = createHash('sha256')
      .update(JSON.stringify([binding, key]))
      .digest('hex');
    await database.query('INSERT INTO "SidedoorState" VALUES ($1,$2,$3::jsonb)', [
      `sd-w:1:${randomUUID()}`,
      randomUUID(),
      JSON.stringify({ kind: 'write', target: { binding, key } }),
    ]);
    expect(
      (await database.query('SELECT state FROM "SidedoorState" WHERE id=$1', [`sd-tf:1:${id}`]))
        .rows[0]?.state
    ).toMatchObject({ target: id, status: 'open' });
  });

  it('does not allow a storage record to escape its fence by changing its ID', async () => {
    const id = `sd-w:1:${randomUUID()}`;
    await database.query('INSERT INTO "SidedoorState" VALUES ($1,$2,$3::jsonb)', [
      id,
      randomUUID(),
      JSON.stringify({
        kind: 'write',
        target: { binding: 'f'.repeat(64), key: 'worksheets/id.pdf' },
      }),
    ]);
    await expect(
      database.query('UPDATE "SidedoorState" SET id=$2 WHERE id=$1', [id, randomUUID()])
    ).rejects.toThrow('Storage record identity cannot change');
  });

  it('waits for an older in-flight writer before installing the fence', async () => {
    const oldSchema = `fence_upgrade_${randomUUID().replaceAll('-', '')}`;
    const options = {
      connectionString: databaseUrl,
      options: `-c search_path=${oldSchema},public`,
    };
    const oldWriter = new Client(options);
    const upgrader = new Client(options);
    await Promise.all([oldWriter.connect(), upgrader.connect()]);
    try {
      await upgrader.query(`CREATE SCHEMA "${oldSchema}"`);
      await upgrader.query(
        'CREATE TABLE "SidedoorState" (id TEXT PRIMARY KEY, revision TEXT NOT NULL, state JSONB NOT NULL)'
      );
      await oldWriter.query('BEGIN');
      const id = `sd-w:1:${randomUUID()}`;
      const key = { binding: '9'.repeat(64), key: 'worksheets/old.pdf' };
      await oldWriter.query('INSERT INTO "SidedoorState" VALUES ($1,$2,$3::jsonb)', [
        id,
        randomUUID(),
        JSON.stringify({ kind: 'write', target: key }),
      ]);
      const migration = await readFile(
        'prisma/migrations/20261108030000_storage_target_fence/migration.sql',
        'utf8'
      );
      const writerPid = (await oldWriter.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
        .rows[0]!.pid;
      const upgradePid = (await upgrader.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
        .rows[0]!.pid;
      const installing = upgrader.query(migration);
      let blocked = false;
      for (let attempt = 0; attempt < 100 && !blocked; attempt += 1) {
        const result = await database.query<{ blocked: boolean }>(
          'SELECT $1::integer = ANY(pg_blocking_pids($2::integer)) AS blocked',
          [writerPid, upgradePid]
        );
        blocked = result.rows[0]?.blocked === true;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      await oldWriter.query('COMMIT');
      await installing;
      const hash = createHash('sha256')
        .update(JSON.stringify([key.binding, key.key]))
        .digest('hex');
      await upgrader.query('INSERT INTO "SidedoorState" VALUES ($1,$2,$3::jsonb)', [
        `sd-tf:1:${hash}`,
        randomUUID(),
        JSON.stringify({
          kind: 'storage_target_fence',
          target: hash,
          status: 'retired',
          retirement: '8'.repeat(64),
        }),
      ]);
      await expect(
        oldWriter.query('UPDATE "SidedoorState" SET revision=$2 WHERE id=$1', [id, randomUUID()])
      ).rejects.toThrow('Storage target is retired');
    } finally {
      await oldWriter.query('ROLLBACK');
      await upgrader.query(`DROP SCHEMA IF EXISTS "${oldSchema}" CASCADE`);
      await Promise.all([oldWriter.end(), upgrader.end()]);
    }
  });

  it('rolls back the migration if the trigger cannot be installed', async () => {
    const failedSchema = `fence_failure_${randomUUID().replaceAll('-', '')}`;
    const connection = new Client({
      connectionString: databaseUrl,
      options: `-c search_path=${failedSchema},public`,
    });
    await connection.connect();
    try {
      await connection.query(`CREATE SCHEMA "${failedSchema}"`);
      await connection.query(
        'CREATE TABLE "SidedoorState" (id TEXT PRIMARY KEY, revision TEXT NOT NULL, state JSONB NOT NULL)'
      );
      await connection.query(
        'CREATE FUNCTION existing_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$'
      );
      await connection.query(
        'CREATE TRIGGER "SidedoorState_storage_target_fence" BEFORE INSERT ON "SidedoorState" FOR EACH ROW EXECUTE FUNCTION existing_guard()'
      );
      const migration = await readFile(
        'prisma/migrations/20261108030000_storage_target_fence/migration.sql',
        'utf8'
      );
      await expect(connection.query(migration)).rejects.toThrow('already exists');
      await connection.query('ROLLBACK');
      const result = await connection.query('SELECT to_regprocedure($1) AS guard', [
        '"guardStorageTargetFence"()',
      ]);
      expect(result.rows[0]?.guard).toBeNull();
    } finally {
      await connection.query(`DROP SCHEMA IF EXISTS "${failedSchema}" CASCADE`);
      await connection.end();
    }
  });

  it('blocks a storage journal that predates target fencing', async () => {
    const executor = {
      query: async (sql: string, values: readonly unknown[]) =>
        (await database.query(sql, [...values])).rows,
    };
    const location = {
      kind: 'object' as const,
      endpoint: 'https://storage.example',
      bucket: 'private',
    };
    const backend = prepareStorageBackend('legacy', {
      kind: 'object',
      location,
      binding: storageBackendBinding(location),
    });
    await new StorageBackendRegistry(executor, 'postgres', 'legacy').register(backend);
    const intent = prepareStorageWrite({
      namespace: 'legacy',
      subjectId: 'course:legacy',
      generation: 1,
      target: { backendId: backend.id, binding: backend.binding, key: 'worksheets/legacy.pdf' },
    });
    const id = createHash('sha256')
      .update(JSON.stringify([intent.target.binding, intent.target.key]))
      .digest('hex');
    await database.query('INSERT INTO "SidedoorState" VALUES ($1,$2,$3::jsonb)', [
      `sd-tf:1:${id}`,
      randomUUID(),
      JSON.stringify({
        kind: 'storage_target_fence',
        target: id,
        status: 'retired',
        retirement: 'e'.repeat(64),
      }),
    ]);
    await expect(
      new StorageWriteJournal(executor, 'postgres', 'legacy').begin(intent, 1)
    ).rejects.toThrow('Storage target is retired');
    const reference = prepareStorageReference({
      namespace: 'legacy',
      operationId: randomUUID(),
      reference: 'worksheets/legacy.pdf',
      target: intent.target,
      scopes: [{ subjectId: 'course:legacy', generation: 1 }],
    });
    await database.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await expect(
      new StorageReferenceRegistry(executor, 'postgres', 'legacy').replace({
        consumer: 'class:legacy:worksheet',
        previousReference: null,
        next: reference,
      })
    ).rejects.toThrow('Storage target is retired');
    await database.query('ROLLBACK');
  });
});
