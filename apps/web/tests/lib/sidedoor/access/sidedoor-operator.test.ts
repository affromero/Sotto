// @vitest-environment node
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@/generated/prisma/client';
import { sidedoorStateStore, sottoStorageInstance } from '@/lib/sidedoor/access/state/store';

const execute = promisify(execFile);
const databaseUrl = process.env.SIDEDOOR_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

suite('bundled local access operator', () => {
  let admin: PrismaClient;
  let database: PrismaClient;
  let operatorUrl: string;
  let runtimeDirectory: string;
  let created = false;
  const name = `sotto_operator_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/sidedoor_test')
      throw new Error('Operator tests require the isolated local sidedoor_test database');
    await execute(process.execPath, ['scripts/build-access.mjs'], { timeout: 30_000 });
    runtimeDirectory = await mkdtemp(join(tmpdir(), 'sotto-operator-runtime-'));
    await copyFile('dist/access.cjs', join(runtimeDirectory, 'access.cjs'));
    admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    created = true;
    url.pathname = `/${name}`;
    operatorUrl = url.toString();
    database = new PrismaClient({ adapter: new PrismaPg({ connectionString: operatorUrl }) });
    const baseline = await readFile(
      'prisma/migrations/20260720021500_baseline/migration.sql',
      'utf8'
    );
    for (const match of baseline.matchAll(/CREATE TYPE [\s\S]*?;/g))
      await database.$executeRawUnsafe(match[0]);
    for (const table of ['User', 'ApiKey', 'PairingToken']) {
      const statement = baseline.match(new RegExp(`CREATE TABLE "${table}" \\([\\s\\S]*?\\n\\);`));
      if (!statement) throw new Error(`Missing baseline table ${table}`);
      await database.$executeRawUnsafe(statement[0]);
    }
    await database.$executeRawUnsafe(
      await readFile('prisma/migrations/20260911222000_sidedoor_state/migration.sql', 'utf8')
    );
    await database.user.create({
      data: {
        id: 'existing',
        email: 'learner@example.test',
        name: 'Existing learner',
        role: 'ADMIN',
      },
      select: { id: true },
    });
  });
  afterAll(async () => {
    await database?.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${name}"`);
    await admin?.$disconnect();
    if (runtimeDirectory) await rm(runtimeDirectory, { recursive: true, force: true });
  });
  function command(args: string[], url = operatorUrl) {
    return execute(process.execPath, [join(runtimeDirectory, 'access.cjs'), ...args], {
      cwd: runtimeDirectory,
      env: { ...process.env, DATABASE_URL: url },
      timeout: 30_000,
    });
  }
  it('validates arguments before constructing a database client', async () => {
    await expect(command(['recover'], 'invalid-scheme')).rejects.toMatchObject({
      stderr: expect.stringContaining('Use access list'),
    });
  });
  it('does not echo database credential material in configuration errors', async () => {
    await expect(command(['list'], 'secret-credential-must-not-appear')).rejects.toMatchObject({
      stderr: 'DATABASE_URL must start with postgresql:// or postgres://.\n',
    });
  });
  it('initializes canonical access without deployment credentials', async () => {
    expect(JSON.parse((await command(['list'])).stdout).principals).toEqual([]);
    expect(await database.sidedoorState.count()).toBe(0);
    await expect(sottoStorageInstance(database).read()).rejects.toThrow();
    expect(await database.sidedoorState.count()).toBe(0);
    const initialized = await command(['initialize']);
    expect(JSON.parse(initialized.stdout).operation).toBe('initialize');
    const listed = JSON.parse((await command(['list'])).stdout);
    expect(listed.principals).toEqual([]);
    const before = await sidedoorStateStore(database).read();
    const storageBefore = await sottoStorageInstance(database).read();
    expect(storageBefore).toEqual({
      instanceId: expect.any(String),
      subjectId: `instance:${storageBefore.instanceId}`,
      generation: 0,
    });
    await command(['initialize']);
    expect(await sidedoorStateStore(database).read()).toEqual(before);
    expect(await sottoStorageInstance(database).read()).toEqual(storageBefore);
    const claim = JSON.parse((await command(['claim'])).stdout);
    expect(claim).toMatchObject({
      operation: 'claim',
      code: expect.any(String),
      expiresInMinutes: 15,
    });
    expect(JSON.parse((await command(['list'])).stdout).principals).toEqual(listed.principals);
    expect(
      await database.user.findUnique({
        where: { id: 'existing' },
        select: { email: true, name: true },
      })
    ).toEqual({ email: 'learner@example.test', name: 'Existing learner' });
  });
});
