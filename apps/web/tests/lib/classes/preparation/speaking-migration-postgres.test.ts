// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../../helpers/setup/shared-instance';

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
const migrationName = '20261107010000_staged_speaking_repair';

suite('speaking repair migration', () => {
  let instance: SharedTestInstance;
  let migration: string;
  let writer: Client;
  let migrator: Client;
  beforeAll(async () => {
    instance = await createSharedTestInstance('speaking_migration', {
      beforeMigration: migrationName,
    });
    migration = await readFile(`prisma/migrations/${migrationName}/migration.sql`, 'utf8');
    const options = {
      connectionString: process.env.SIDEDOOR_TEST_DATABASE_URL,
      options: `-c search_path=${instance.schema},public`,
    };
    writer = new Client(options);
    migrator = new Client(options);
    await Promise.all([writer.connect(), migrator.connect()]);
  });
  afterAll(async () => {
    await Promise.all([writer?.end(), migrator?.end()]);
    await instance?.close();
  });

  it('rolls back speaking identities and encryption metadata if migration fails', async () => {
    const broken = migration.replace('COMMIT;', 'SELECT 1 / 0;\nCOMMIT;');
    expect(broken).not.toBe(migration);
    await expect(migrator.query(broken)).rejects.toThrow();
    await migrator.query('ROLLBACK');
    const columns = await migrator.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name IN ('SpeakingPrompt', 'SpeakingRecording') AND column_name IN ('incarnationId', 'referenceEncryption')`,
      [instance.schema]
    );
    expect(columns.rowCount).toBe(0);
  });

  it('waits for an active speaking writer before upgrading', async () => {
    await writer.query('BEGIN');
    await writer.query('LOCK TABLE "SpeakingRecording" IN ROW EXCLUSIVE MODE');
    const pid = (await migrator.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const migrationRun = migrator.query(migration);
    let blocked = false;
    try {
      for (let attempt = 0; attempt < 200 && !blocked; attempt++) {
        const result = await writer.query(
          'SELECT cardinality(pg_blocking_pids($1)) > 0 AS waiting',
          [pid]
        );
        blocked = result.rows[0].waiting;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      await writer.query('ROLLBACK');
    }
    await migrationRun;
    expect(blocked).toBe(true);
    const columns = await migrator.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name IN ('SpeakingPrompt', 'SpeakingRecording') AND column_name IN ('incarnationId', 'referenceEncryption')`,
      [instance.schema]
    );
    expect(columns.rowCount).toBe(3);
  }, 30_000);
});
