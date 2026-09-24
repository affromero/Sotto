// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { OutboxJob } from 'thesidedoor-core/runtime/outbox';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  credentialValidationPayloadSchema,
  processCredentialValidation,
  scheduleCredentialValidationPage,
} from '@/lib/sidedoor/credentials/runtime/credential-validation-work';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  captureSottoCredentialOwner,
  resolveSottoProfileCredential,
  sottoCredentialStorage,
} from '@/lib/sidedoor/credentials/runtime/provider-credentials';
import { processDurableNotification } from '@/workers/durable/notifications/durable-notification';
import { processDurableNotificationDelivery } from '@/workers/durable/notifications/durable-notification-delivery';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null, publish: vi.fn() }));
vi.mock('@/lib/redis', () => ({ publishNotification: boundary.publish }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('canonical credential validation with PostgreSQL', () => {
  let instance: SharedTestInstance;
  let ownerId: string;
  let identity: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('credential_validation');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    boundary.publish.mockReset().mockResolvedValue(undefined);
    vi.stubEnv('BYOK_ENCRYPTION_KEY', '1'.repeat(64));
    identity = await instance.reset();
    ownerId = identity.ownerId;
    await instance.seedAiCredential(ownerId, 'openai', 'personal-test-key');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await instance?.close();
    boundary.database = null;
  });
  const queued = (record: OutboxJob) => ({
    id: record.job.id,
    name: `${record.job.handler}.v${record.job.version}`,
    data: { operationId: record.job.id, fingerprint: record.fingerprint },
  });
  async function jobs(handler: string) {
    return sottoTransaction(instance.database, async (tx) => {
      const outbox = sottoJobOutbox(tx);
      const records: OutboxJob[] = [];
      let cursor: string | null = null;
      do {
        const page = await outbox.listIncomplete(cursor);
        for (const job of page.jobs) {
          const record = await outbox.read(job.id);
          if (record?.job.handler === handler) records.push(record);
        }
        cursor = page.cursor;
      } while (cursor !== null);
      return records;
    });
  }
  async function schedule() {
    expect(await scheduleCredentialValidationPage(instance.database, null)).toMatchObject({
      scheduled: 1,
      cursor: null,
    });
    return (await jobs('key-validation')).at(-1)!;
  }
  async function head() {
    return sottoTransaction(instance.database, async (tx) => {
      const storage = await sottoCredentialStorage(tx, 'ai', 'openai');
      const owner = await captureSottoCredentialOwner(tx, ownerId);
      return storage.owned.head({ ...storage.slot, owner });
    });
  }

  it('schedules every owner and exact revision across credential pages without decrypting keys', async () => {
    const users: Array<{ id: string }> = [];
    for (let index = 0; index < 103; index++)
      users.push(await identity.household(`Credential owner ${index}`));
    for (const user of users)
      await instance.seedAiCredential(user.id, 'openai', `test-key-${user.id}`);
    // Scheduling needs metadata only, even when the current key cannot decrypt saved secrets.
    vi.stubEnv('BYOK_ENCRYPTION_KEY', '2'.repeat(64));
    vi.stubGlobal('fetch', () => {
      throw new Error('Scheduling must not contact a provider');
    });
    const first = await scheduleCredentialValidationPage(instance.database, null);
    expect(first.scheduled).toBe(100);
    expect(first.cursor).not.toBeNull();
    const second = await scheduleCredentialValidationPage(instance.database, first.cursor);
    expect(second).toEqual({ scheduled: 4, cursor: null });
    const records = await jobs('key-validation');
    const expectedOwners = new Set([ownerId, ...users.map((user) => user.id)]);
    expect(records).toHaveLength(expectedOwners.size);
    const actualOwners = new Set<string>();
    for (const record of records) {
      const payload = credentialValidationPayloadSchema.parse(record.job.payload);
      actualOwners.add(payload.userId);
      expect(record.job.scopes).toEqual(payload.storage.scopes);
      const revision = await sottoTransaction(instance.database, async (tx) => {
        const storage = await sottoCredentialStorage(tx, 'ai', 'openai');
        const owner = await captureSottoCredentialOwner(tx, payload.userId);
        return (await storage.owned.head({ ...storage.slot, owner })).revision;
      });
      expect(payload.revision).toBe(revision);
      expect(payload.storage.owner.subjectId).toBe(`profile:${payload.userId}`);
    }
    expect(actualOwners).toEqual(expectedOwners);
  }, 60_000);

  it('preserves enabled credentials during an outage and records an inconclusive attempt', async () => {
    const work = await schedule();
    vi.stubGlobal('fetch', async () => Response.json({}, { status: 503 }));
    await processCredentialValidation(instance.database, queued(work));
    expect((await head()).credential).toMatchObject({
      availability: 'enabled',
      verification: { lastAttempt: { status: 'inconclusive' }, lastConfirmed: null },
    });
    expect(await jobs('notifications')).toEqual([]);
  });

  it('attributes a rejected shared credential to its owner without disabling recipient credentials', async () => {
    const recipient = await identity.household('Shared recipient');
    await sottoTransaction(instance.database, async (tx) => {
      const storage = await sottoCredentialStorage(tx, 'ai', 'openai');
      const owner = await captureSottoCredentialOwner(tx, ownerId);
      await storage.sharing.set(storage.slot, null, {
        owner,
        audience: 'household',
        excludedRecipients: [],
        source: 'explicit',
      });
      const selected = await resolveSottoProfileCredential(tx, recipient.id, 'ai', 'openai', true);
      expect(selected).toMatchObject({ shared: true, ownerUserId: ownerId });
    });
    const work = await schedule();
    vi.stubGlobal('fetch', async () => Response.json({}, { status: 401 }));
    await processCredentialValidation(instance.database, queued(work));
    const notices = await jobs('notifications');
    expect(notices).toHaveLength(1);
    await processDurableNotification(queued(notices[0]!));
    expect(
      await instance.database.notification.findMany({ select: { userId: true, type: true } })
    ).toEqual([{ userId: ownerId, type: 'KEY_INVALID' }]);
    await sottoTransaction(instance.database, async (tx) => {
      const storage = await sottoCredentialStorage(tx, 'ai', 'openai');
      const owner = await captureSottoCredentialOwner(tx, recipient.id);
      expect((await storage.owned.head({ ...storage.slot, owner })).credential).toBeNull();
    });
    expect((await head()).credential?.availability).toBe('disabled');
  });

  it('commits a rejection and its owner notification together, then creates the canonical inbox', async () => {
    const work = await schedule();
    vi.stubGlobal('fetch', async () =>
      Response.json({ error: { message: 'Invalid key' } }, { status: 401 })
    );
    await processCredentialValidation(instance.database, queued(work));
    expect((await head()).credential?.availability).toBe('disabled');
    const notices = await jobs('notifications');
    expect(notices).toHaveLength(1);
    await processDurableNotification(queued(notices[0]!));
    expect(
      await instance.database.notification.findMany({ select: { userId: true, type: true } })
    ).toEqual([{ userId: ownerId, type: 'KEY_INVALID' }]);
    await processCredentialValidation(instance.database, queued(work));
    expect(await instance.database.notification.count()).toBe(1);
  });

  it.each(['rotate', 'remove'] as const)(
    'does not apply an old rejection after a credential is %s during its probe',
    async (change) => {
      const work = await schedule();
      vi.stubGlobal('fetch', async () => {
        await sottoTransaction(instance.database, async (tx) => {
          const storage = await sottoCredentialStorage(tx, 'ai', 'openai');
          const owner = await captureSottoCredentialOwner(tx, ownerId);
          const target = { ...storage.slot, owner };
          const current = await storage.owned.head(target);
          if (change === 'remove') {
            await storage.owned.remove(target, current.revision, randomUUID());
            return;
          }
          await storage.owned.replace(
            storage.owned.prepareReplacement(target, {
              expectedHeadRevision: current.revision,
              credentialRevision: randomUUID(),
              values: { apiKey: 'rotated-key' },
              binding: current.credential!.binding,
              availability: 'enabled',
              label: 'OpenAI',
              metadata: { createdAt: 1, updatedAt: 2, lastUsedAt: null },
            })
          );
        });
        return Response.json({}, { status: 401 });
      });
      await processCredentialValidation(instance.database, queued(work));
      expect((await head()).credential?.availability ?? null).toBe(
        change === 'remove' ? null : 'enabled'
      );
      expect(await jobs('notifications')).toEqual([]);
    }
  );

  it('keeps a newer successful verification when an older rejection finishes later', async () => {
    const first = await schedule();
    await scheduleCredentialValidationPage(instance.database, null);
    const second = (await jobs('key-validation')).find((job) => job.job.id !== first.job.id)!;
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<Response>();
    vi.stubGlobal('fetch', async () => {
      started.resolve();
      return response.promise;
    });
    const older = processCredentialValidation(instance.database, queued(first));
    await started.promise;
    vi.stubGlobal('fetch', async () => Response.json({ object: 'list', data: [] }));
    await processCredentialValidation(instance.database, queued(second));
    response.resolve(Response.json({}, { status: 401 }));
    await older;
    expect((await head()).credential).toMatchObject({
      availability: 'enabled',
      verification: { lastConfirmed: { status: 'verified' } },
    });
    expect(await jobs('notifications')).toEqual([]);
  });

  it.each(['inbox', 'delivery'] as const)(
    'suppresses a rejection alert when newer verification succeeds before %s',
    async (stage) => {
      const first = await schedule();
      await scheduleCredentialValidationPage(instance.database, null);
      const second = (await jobs('key-validation')).find((job) => job.job.id !== first.job.id)!;
      vi.stubGlobal('fetch', async () => Response.json({}, { status: 401 }));
      await processCredentialValidation(instance.database, queued(first));
      const notice = (await jobs('notifications'))[0]!;
      if (stage === 'delivery') await processDurableNotification(queued(notice));
      vi.stubGlobal('fetch', async () => Response.json({ object: 'list', data: [] }));
      await processCredentialValidation(instance.database, queued(second));
      expect((await head()).credential).toMatchObject({
        availability: 'disabled',
        verification: { lastConfirmed: { status: 'verified' } },
      });
      if (stage === 'inbox') {
        await processDurableNotification(queued(notice));
        expect(await instance.database.notification.count()).toBe(0);
      } else {
        const deliveries = (await jobs('notifications')).filter((job) => job.job.version === 2);
        expect(deliveries.length).toBeGreaterThan(0);
        for (const delivery of deliveries)
          await processDurableNotificationDelivery(queued(delivery));
        expect(boundary.publish).not.toHaveBeenCalled();
      }
      expect(await jobs('notifications')).toEqual([]);
    }
  );

  it('leaves validation retryable without disabling the key when the probe is cancelled', async () => {
    const work = await schedule();
    const controller = new AbortController();
    vi.stubGlobal('fetch', async () => {
      controller.abort(new Error('fixture cancelled'));
      return Response.json({}, { status: 401 });
    });
    await expect(
      processCredentialValidation(instance.database, queued(work), controller.signal)
    ).rejects.toThrow('fixture cancelled');
    expect((await head()).credential).toMatchObject({
      availability: 'enabled',
      verification: { lastAttempt: null },
    });
    expect((await jobs('key-validation')).map((job) => job.job.id)).toContain(work.job.id);
    expect(await jobs('notifications')).toEqual([]);
  });

  it('rolls back rejection and parent completion when durable notification enqueue fails', async () => {
    const work = await schedule();
    await instance.database
      .$executeRawUnsafe(`CREATE FUNCTION reject_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.state->>'kind' = 'outbox_job' AND NEW.state->'job'->>'handler' = 'notifications' THEN
        RAISE EXCEPTION 'fixture notification write rejected';
      END IF; RETURN NEW; END $$`);
    await instance.database.$executeRawUnsafe(
      'CREATE TRIGGER reject_notice BEFORE INSERT ON "SidedoorState" FOR EACH ROW EXECUTE FUNCTION reject_notice()'
    );
    vi.stubGlobal('fetch', async () => Response.json({}, { status: 401 }));
    try {
      await expect(processCredentialValidation(instance.database, queued(work))).rejects.toThrow(
        'fixture notification write rejected'
      );
      expect((await head()).credential).toMatchObject({
        availability: 'enabled',
        verification: { lastAttempt: null },
      });
      expect((await jobs('key-validation')).map((job) => job.job.id)).toContain(work.job.id);
    } finally {
      await instance.database.$executeRawUnsafe('DROP TRIGGER reject_notice ON "SidedoorState"');
      await instance.database.$executeRawUnsafe('DROP FUNCTION reject_notice()');
    }
  });
});
