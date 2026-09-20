// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
import {
  captureSottoExecutionCredential,
  admitSottoExecutionCredential,
  validateSottoExecutionCredential,
} from '@/lib/sidedoor/credentials/runtime/credential-execution';
import {
  captureSottoCredentialOwner,
  sottoCredentialStorage,
} from '@/lib/sidedoor/credentials/runtime/provider-credentials';
import {
  resolveSottoRequest,
  requireOriginalSottoAdmission,
} from '@/lib/sidedoor/access/core/request-identity';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { captureSottoCredentialProbe } from '@/lib/providers/shared/credential-validation';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../../helpers/setup/shared-instance';

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('credential execution admission with PostgreSQL', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('credential_execution');
  });
  beforeEach(async () => {
    vi.stubEnv('BYOK_ENCRYPTION_KEY', '1'.repeat(64));
    identity = await instance.reset();
    await instance.seedAiCredential(identity.ownerId, 'openai', 'captured-key');
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await instance?.close();
  });

  async function authority(token = identity.ownerToken) {
    const request = new Request('http://localhost', {
      headers: { cookie: `sotto_session=${token}` },
    });
    const original = await sottoTransaction(instance.database, (tx) =>
      resolveSottoRequest(tx, request)
    );
    if (!original || original.kind !== 'content')
      throw new Error('Expected fixture content authority');
    return async (tx: Prisma.TransactionClient) => {
      await requireOriginalSottoAdmission(tx, request, original);
      return { userId: original.userId };
    };
  }
  async function head(userId = identity.ownerId) {
    return sottoTransaction(instance.database, async (tx) => {
      const storage = await sottoCredentialStorage(tx, 'ai', 'openai');
      return storage.owned.head({
        ...storage.slot,
        owner: await captureSottoCredentialOwner(tx, userId),
      });
    });
  }

  it('records use only when the original request and captured credential are admitted', async () => {
    const authorize = await authority();
    const captured = await sottoTransaction(instance.database, (tx) =>
      captureSottoExecutionCredential(tx, authorize, 'ai', 'openai', false)
    );
    expect(captured?.selected.credential.values).toEqual({ apiKey: 'captured-key' });
    expect(() => {
      captured!.selected.credential.values.apiKey = 'changed-key';
    }).toThrow();
    expect((await head()).credential?.metadata.lastUsedAt).toBeNull();
    await sottoTransaction(instance.database, (tx) =>
      validateSottoExecutionCredential(tx, authorize, captured!)
    );
    expect((await head()).credential?.metadata.lastUsedAt).toBeNull();
    await sottoTransaction(instance.database, (tx) =>
      admitSottoExecutionCredential(tx, authorize, captured!)
    );
    expect((await head()).credential?.metadata.lastUsedAt).toEqual(expect.any(Number));
  });

  it.each(['rotate', 'remove', 'cancel'] as const)(
    'rejects %s while execution is waiting without recording use',
    async (change) => {
      const authorize = await authority();
      const captured = await sottoTransaction(instance.database, (tx) =>
        captureSottoExecutionCredential(tx, authorize, 'ai', 'openai', false)
      );
      const controller = new AbortController();
      if (change === 'cancel') controller.abort();
      else
        await sottoTransaction(instance.database, async (tx) => {
          const storage = await sottoCredentialStorage(tx, 'ai', 'openai');
          const target = { ...storage.slot, owner: captured!.selected.credential.owner };
          const current = await storage.owned.head(target);
          if (change === 'remove')
            await storage.owned.remove(target, current.revision, randomUUID());
          else
            await storage.owned.replace(
              storage.owned.prepareReplacement(target, {
                expectedHeadRevision: current.revision,
                credentialRevision: randomUUID(),
                values: { apiKey: 'replacement-key' },
                binding: current.credential!.binding,
                availability: 'enabled',
                label: null,
                metadata: { createdAt: 1, updatedAt: 2, lastUsedAt: null },
              })
            );
        });
      await expect(
        sottoTransaction(instance.database, (tx) =>
          admitSottoExecutionCredential(tx, authorize, captured!, controller.signal)
        )
      ).rejects.toThrow();
      expect((await head()).credential?.metadata.lastUsedAt ?? null).toBeNull();
      expect(captured?.selected.credential.values.apiKey).toBe('captured-key');
    }
  );

  it('rejects a revoked request after capture', async () => {
    const authorize = await authority();
    const captured = await sottoTransaction(instance.database, (tx) =>
      captureSottoExecutionCredential(tx, authorize, 'ai', 'openai', false)
    );
    await identity.access.logout(identity.ownerToken);
    await expect(
      sottoTransaction(instance.database, (tx) =>
        admitSottoExecutionCredential(tx, authorize, captured!)
      )
    ).rejects.toThrow();
    expect((await head()).credential?.metadata.lastUsedAt).toBeNull();
  });

  it('rejects a changed sharing grant even when the owner key is unchanged', async () => {
    const recipient = await identity.household('Recipient');
    await sottoTransaction(instance.database, async (tx) => {
      const storage = await sottoCredentialStorage(tx, 'ai', 'openai');
      await storage.sharing.set(storage.slot, null, {
        owner: await captureSottoCredentialOwner(tx, identity.ownerId),
        audience: 'household',
        excludedRecipients: [],
        source: 'explicit',
      });
    });
    const authorize = await authority(recipient.token);
    const captured = await sottoTransaction(instance.database, (tx) =>
      captureSottoExecutionCredential(tx, authorize, 'ai', 'openai', true)
    );
    expect(captured?.selected.ownerUserId).toBe(identity.ownerId);
    await sottoTransaction(instance.database, async (tx) => {
      const storage = await sottoCredentialStorage(tx, 'ai', 'openai');
      const grant = await storage.sharing.head(storage.slot);
      await storage.sharing.set(storage.slot, grant.revision, {
        ...grant.policy!,
        excludedRecipients: [captured!.recipient.owner],
      });
    });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        admitSottoExecutionCredential(tx, authorize, captured!)
      )
    ).rejects.toThrow();
    expect((await head()).credential?.metadata.lastUsedAt).toBeNull();
    expect((await head(recipient.id)).credential).toBeNull();
  });

  it('admits Cartesia transcription using its TTS slot and separate transport version', async () => {
    await sottoTransaction(instance.database, async (tx) => {
      const storage = await sottoCredentialStorage(tx, 'tts', 'cartesia');
      const owner = await captureSottoCredentialOwner(tx, identity.ownerId);
      const values = { apiKey: 'cartesia-key' };
      const probe = captureSottoCredentialProbe('tts', 'cartesia', values);
      if (probe.kind === 'unsupported') throw new Error('Expected Cartesia credential support');
      await storage.owned.replace(
        storage.owned.prepareReplacement(
          { ...storage.slot, owner },
          {
            expectedHeadRevision: null,
            credentialRevision: randomUUID(),
            values,
            binding: probe.binding,
            availability: 'enabled',
            label: null,
            metadata: { createdAt: 1, updatedAt: 1, lastUsedAt: null },
          }
        )
      );
    });
    const authorize = await authority();
    const captured = await sottoTransaction(instance.database, (tx) =>
      captureSottoExecutionCredential(tx, authorize, 'stt', 'cartesia', false)
    );
    expect(captured?.selected.credential.modality).toBe('tts');
    expect(captured?.binding.protocol).not.toBe(captured?.selected.credential.binding.protocol);
    await sottoTransaction(instance.database, (tx) =>
      admitSottoExecutionCredential(tx, authorize, captured!)
    );
  });
});
