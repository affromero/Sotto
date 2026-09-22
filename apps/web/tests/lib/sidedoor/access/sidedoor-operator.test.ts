// @vitest-environment node
import { execFile } from 'node:child_process';
import { createCipheriv, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@/generated/prisma/client';
import { AccessService } from 'thesidedoor-core/access';
import { SottoAccessStore } from '@/lib/sidedoor/access/core/access-store';
import { sidedoorStateStore, sottoStorageInstance } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoCredentialStorage } from '@/lib/sidedoor/credentials/runtime/provider-credentials';

const execute = promisify(execFile);
const databaseUrl = process.env.SIDEDOOR_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const sourceSecret = 'operator-cutover-encryption-key';

function sourceCredential(value: string) {
  const salt = randomBytes(16);
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', scryptSync(sourceSecret, salt, 32), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([salt, iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

suite('bundled local access operator', () => {
  const previousEncryptionKey = process.env.BYOK_ENCRYPTION_KEY;
  let admin: PrismaClient;
  let database: PrismaClient;
  let operatorUrl: string;
  let runtimeDirectory: string;
  let created = false;
  const name = `sotto_operator_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    process.env.BYOK_ENCRYPTION_KEY = sourceSecret;
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
    for (const table of [
      'User',
      'ApiKey',
      'PairingToken',
      'UserTtsKey',
      'UserAiKey',
      'UserVisualCueKey',
      'AutoModelConfig',
      'SiteConfig',
    ]) {
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
    await database.$executeRawUnsafe(
      `INSERT INTO "SiteConfig" (id, "aiProvider", "aiModel", "storageProvider", "s3Bucket", "s3Region", "updatedAt", "updatedBy")
       VALUES ('singleton', 'anthropic', 'claude-test', 's3', 'installed-bucket', 'us-test-1', now(), 'existing')`
    );
    await database.$executeRawUnsafe(
      `INSERT INTO "AutoModelConfig" (id, "aiProvider", "aiModel", "ttsProvider", "ttsModel", "sttProvider", "sttModel", "platformAiProvider", "platformAiModel", "updatedAt", "updatedBy")
       VALUES ('singleton', 'anthropic', 'claude-haiku-4-5-20251001', 'openai', 'tts-1-hd', 'openai', 'whisper-1', 'anthropic', 'claude-haiku-4-5-20251001', now(), 'existing')`
    );
    await database.$executeRawUnsafe(
      `INSERT INTO "UserAiKey" (id, "userId", provider, "encryptedKey", "isValid", label, "createdAt", "updatedAt")
       VALUES ('installed-key', 'existing', 'anthropic', $1, true, 'Installed Anthropic', now(), now())`,
      'invalid-envelope'
    );
  });
  afterAll(async () => {
    await database?.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin?.$disconnect();
    if (runtimeDirectory) await rm(runtimeDirectory, { recursive: true, force: true });
    if (previousEncryptionKey === undefined) delete process.env.BYOK_ENCRYPTION_KEY;
    else process.env.BYOK_ENCRYPTION_KEY = previousEncryptionKey;
  });
  function command(args: string[], url = operatorUrl) {
    return execute(process.execPath, [join(runtimeDirectory, 'access.cjs'), ...args], {
      cwd: runtimeDirectory,
      env: { ...process.env, DATABASE_URL: url, BYOK_ENCRYPTION_KEY: sourceSecret },
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
  it('atomically converts installed state and binds the owner claim to retained learner data', async () => {
    expect(JSON.parse((await command(['list'])).stdout).principals).toEqual([]);
    expect(await database.sidedoorState.count()).toBe(0);
    await expect(sottoStorageInstance(database).read()).rejects.toThrow();
    expect(await database.sidedoorState.count()).toBe(0);
    await expect(command(['initialize'])).rejects.toMatchObject({
      stderr: expect.stringContaining('Stored credential envelope is invalid'),
    });
    expect(await database.sidedoorState.count()).toBe(0);
    await database.$executeRawUnsafe(
      `UPDATE "UserAiKey" SET "encryptedKey" = $1 WHERE id = 'installed-key'`,
      sourceCredential('installed-provider-secret')
    );
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
    expect(before.configuration.site).toMatchObject({
      aiProvider: 'anthropic',
      aiModel: 'claude-test',
      storageProvider: 's3',
      objectStorageBucket: 'installed-bucket',
      objectStorageRegion: 'us-test-1',
    });
    expect(before.access.householdProfiles).toEqual([
      expect.objectContaining({ id: 'existing', name: 'Existing learner' }),
    ]);
    expect(
      (
        await database.$queryRawUnsafe<{ name: string | null }[]>(
          `SELECT to_regclass('public."UserAiKey"')::text AS name`
        )
      )[0]?.name
    ).not.toBeNull();
    await sottoTransaction(database, async (tx) => {
      const storage = await sottoCredentialStorage(tx, 'ai', 'anthropic');
      const user = await tx.user.findUniqueOrThrow({
        where: { id: 'existing' },
        select: { createdAt: true },
      });
      const target = {
        ...storage.slot,
        owner: { subjectId: 'profile:existing', generation: user.createdAt.getTime() },
      };
      const head = await storage.owned.head(target);
      expect(head.credential).toMatchObject({ label: 'Installed Anthropic' });
      await expect(storage.owned.resolve(target, head.revision!)).resolves.toMatchObject({
        values: { apiKey: 'installed-provider-secret' },
      });
      expect((await storage.sharing.head(storage.slot)).policy).toMatchObject({
        owner: target.owner,
        audience: 'household',
        source: 'imported',
      });
    });
    await command(['initialize']);
    expect(await sidedoorStateStore(database).read()).toEqual(before);
    expect(await sottoStorageInstance(database).read()).toEqual(storageBefore);
    expect(JSON.parse((await command(['finalize'])).stdout)).toEqual({
      operation: 'finalize',
      removed: 5,
    });
    expect(JSON.parse((await command(['finalize'])).stdout)).toEqual({
      operation: 'finalize',
      removed: 0,
    });
    expect(
      await database.$queryRawUnsafe<{ name: string | null }[]>(
        `SELECT to_regclass('public."UserAiKey"')::text AS name`
      )
    ).toEqual([{ name: null }]);
    const claim = JSON.parse((await command(['claim'])).stdout);
    expect(claim).toMatchObject({
      operation: 'claim',
      code: expect.any(String),
      expiresInMinutes: 15,
    });
    await new AccessService({ store: new SottoAccessStore(database) }).claimOwner(
      claim.code,
      'Retained owner',
      'correct horse battery staple',
      'household'
    );
    expect(JSON.parse((await command(['list'])).stdout).principals).toEqual([
      expect.objectContaining({ id: 'existing', name: 'Retained owner', role: 'owner' }),
    ]);
    expect((await sidedoorStateStore(database).read()).access.householdProfiles).toEqual([]);
    expect(await database.user.count()).toBe(1);
    await sottoTransaction(database, async (tx) => {
      const storage = await sottoCredentialStorage(tx, 'ai', 'anthropic');
      expect((await storage.sharing.head(storage.slot)).policy).toMatchObject({
        owner: expect.objectContaining({ subjectId: 'profile:existing' }),
        audience: 'household',
      });
    });
    expect(
      await database.user.findUnique({
        where: { id: 'existing' },
        select: { email: true, name: true },
      })
    ).toEqual({ email: 'learner@example.test', name: 'Retained owner' });
  });
});
