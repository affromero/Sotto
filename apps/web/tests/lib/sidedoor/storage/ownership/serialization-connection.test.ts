import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { acquirePostgresBackendLockGroup } from 'thesidedoor-core/storage';
import { openSottoStorageConnection } from '@/lib/sidedoor/storage/core/storage-connection';

const databaseUrl = process.env.SIDEDOOR_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

suite('storage connection serialization', () => {
  it('rolls back a serialization failure and retains the cleanup lock', async () => {
    const url = new URL(databaseUrl!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/sidedoor_test')
      throw new Error('Use the isolated local sidedoor_test database');
    const table = `serialization_${randomBytes(8).toString('hex')}`;
    const other = new Client({ connectionString: databaseUrl });
    await other.connect();
    let group: Awaited<ReturnType<typeof acquirePostgresBackendLockGroup>> | undefined;
    try {
      await other.query(`CREATE TABLE "${table}" (value integer NOT NULL)`);
      await other.query(`INSERT INTO "${table}" VALUES (1)`);
      group = await acquirePostgresBackendLockGroup({
        bindings: ['a'.repeat(64)],
        openConnection: () => openSottoStorageConnection(databaseUrl),
      });
      await expect(
        group.transaction(async (tx) => {
          await tx.query(`SELECT value FROM "${table}"`, []);
          await other.query(`UPDATE "${table}" SET value = 2`);
          await tx.query(`UPDATE "${table}" SET value = 3`, []);
        })
      ).rejects.toMatchObject({ code: '40001' });
      const rows = await group.transaction((tx) => tx.query(`SELECT value FROM "${table}"`, []));
      expect(rows).toEqual([{ value: 2 }]);
    } finally {
      await group?.release();
      await other.query(`DROP TABLE IF EXISTS "${table}"`);
      await other.end();
    }
  });
});
