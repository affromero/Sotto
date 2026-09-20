// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient, type Prisma } from '@/generated/prisma/client';
import { SottoAccessStore } from '@/lib/sidedoor/access/core/access-store';
import { sidedoorStateStore } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';

const databaseUrl = process.env.SIDEDOOR_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

suite('canonical Sotto state with PostgreSQL', () => {
  let database: PrismaClient;
  const schema = `sotto_test_${randomUUID().replaceAll('-', '')}`;

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/sidedoor_test')
      throw new Error('Shared-state tests require the isolated local sidedoor_test database');
    database = new PrismaClient({
      adapter: new PrismaPg(
        { connectionString: databaseUrl, max: 4, options: `-c search_path=${schema}` },
        { schema }
      ),
    });
    await database.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        await readFile('prisma/migrations/20260911222000_sidedoor_state/migration.sql', 'utf8')
      );
      await tx.$executeRawUnsafe(
        'CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "name" TEXT, "email" TEXT NOT NULL, "role" TEXT NOT NULL DEFAULT \'USER\', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)'
      );
      await tx.$executeRawUnsafe(
        'CREATE TABLE "PrivateFixture" ("id" TEXT PRIMARY KEY, "content" TEXT NOT NULL)'
      );
      await tx.$executeRawUnsafe(
        'INSERT INTO "PrivateFixture" VALUES ($1, $2)',
        'reader',
        'private-course'
      );
    });
  });

  beforeEach(async () => {
    await transaction((tx) => tx.$executeRawUnsafe('DELETE FROM "SidedoorState"'));
    await transaction((tx) =>
      tx.$executeRawUnsafe('UPDATE "PrivateFixture" SET "content" = $1', 'private-course')
    );
  });

  afterAll(async () => {
    if (!database) return;
    await database.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await database.$disconnect();
  });

  function transaction<Result>(
    operation: (tx: Prisma.TransactionClient) => Promise<Result>,
    serializable = false
  ) {
    const run = async (tx: Prisma.TransactionClient) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      return operation(tx);
    };
    return serializable ? sottoTransaction(database, run) : database.$transaction(run);
  }

  it('reads empty canonical authority without persisting implicit state', async () => {
    await expect(new SottoAccessStore(database).read()).resolves.toMatchObject({
      principals: [],
      sessions: [],
    });
    await transaction(async (tx) => {
      expect((await sidedoorStateStore(tx).read()).version).toBe(2);
      expect(await tx.$queryRawUnsafe('SELECT * FROM "SidedoorState"')).toEqual([]);
      expect(await tx.$queryRawUnsafe('SELECT * FROM "PrivateFixture"')).toEqual([
        { id: 'reader', content: 'private-course' },
      ]);
    });
  });

  it('rolls back shared authority and application changes together', async () => {
    await expect(
      transaction(async (tx) => {
        await sidedoorStateStore(tx).transact((state) => {
          state.revision++;
        });
        await tx.$executeRawUnsafe('UPDATE "PrivateFixture" SET "content" = $1', 'changed');
        throw new Error('Abort combined mutation');
      })
    ).rejects.toThrow('Abort combined mutation');
    await transaction(async (tx) => {
      expect((await sidedoorStateStore(tx).read()).revision).toBe(0);
      expect(await tx.$queryRawUnsafe('SELECT "content" FROM "PrivateFixture"')).toEqual([
        { content: 'private-course' },
      ]);
    });
  });

  it('retries concurrent transactions without losing application or state changes', async () => {
    let entered = 0;
    let release!: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    await Promise.all(
      ['first', 'second'].map((value) =>
        transaction(async (tx) => {
          await tx.$queryRawUnsafe('SELECT "content" FROM "PrivateFixture"');
          entered++;
          if (entered === 2) release();
          if (entered <= 2) await bothStarted;
          await tx.$executeRawUnsafe(
            'UPDATE "PrivateFixture" SET "content" = "content" || $1',
            `,${value}`
          );
          await sidedoorStateStore(tx).transact((state) => {
            state.revision++;
          });
        }, true)
      )
    );
    await transaction(async (tx) => {
      expect((await sidedoorStateStore(tx).read()).revision).toBe(2);
      const rows = await tx.$queryRawUnsafe<{ content: string }[]>(
        'SELECT "content" FROM "PrivateFixture"'
      );
      expect(rows[0]!.content.split(',').sort()).toEqual(['first', 'private-course', 'second']);
    });
  });
});
