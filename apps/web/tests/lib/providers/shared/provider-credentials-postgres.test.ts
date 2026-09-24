// @vitest-environment node
import { randomUUID, randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { useProviderCredentialDatabase } from '../../../helpers/runtime/provider-credentials-postgres';
import type { CredentialValues } from 'thesidedoor-core/ai';
import { OwnedCredentials } from 'thesidedoor-core/configuration/owned-credentials';
import { prepareStorageTombstone } from 'thesidedoor-core/storage';
import { PrismaClient, type Prisma } from '@/generated/prisma/client';
import { getAiKey, getSharedAiKey, getSharedByokKey, listAiProviders } from '@/lib/byok';
import {
  saveSottoCredential,
  removeSottoCredential,
  listSottoCredentialSettings,
} from '@/lib/sidedoor/credentials/config/credential-settings';
import {
  sidedoorStateStore,
  sottoStorageInstance,
  SIDEDOOR_STATE_ID,
} from '@/lib/sidedoor/access/state/store';
import {
  revokeSottoCredentialSharing,
  eraseSottoProviderCredentials,
} from '@/lib/sidedoor/credentials/config/credential-sharing';
import {
  sottoCredentialStorage,
  captureSottoCredentialOwner,
  resolveSottoRequestCredential,
  sottoCredentialSlot,
  listSottoProfileCredentials,
} from '@/lib/sidedoor/credentials/runtime/provider-credentials';

const databaseUrl = process.env.SIDEDOOR_TEST_DATABASE_URL;
let database: PrismaClient;
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return database;
  },
  get prismaUnfiltered() {
    return database;
  },
}));
const suite = databaseUrl ? describe : describe.skip;
suite('Sotto provider ownership with PostgreSQL', () => {
  const fixture = useProviderCredentialDatabase();
  const { transaction, admission } = fixture;
  beforeAll(() => {
    database = fixture.database;
  });
  it('saves verified credentials through shared storage and retains a removed head for the next edit', async () => {
    const admitted = await transaction((tx) => admission(tx));
    const input = {
      request: admitted.request,
      identity: admitted.identity,
      scope: 'visual' as const,
      provider: 'pexels',
    };
    vi.stubGlobal('fetch', async (_url: URL, options: RequestInit) => {
      expect(new Headers(options.headers).get('authorization')).toBe('personal-photo-key');
      return Response.json({ photos: [], page: 1, per_page: 1, total_results: 0 });
    });
    const operationId = randomUUID();
    expect(
      await saveSottoCredential(database, {
        ...input,
        operationId,
        expectedRevision: null,
        values: { apiKey: 'personal-photo-key' },
        allowUnverified: false,
      })
    ).toMatchObject({ status: 'saved', revision: operationId, validation: { status: 'valid' } });
    const saved = await listSottoCredentialSettings(database, { ...input, providers: ['pexels'] });
    expect(saved.heads.pexels).toBe(operationId);
    expect(saved.keys[0]?.verification.lastConfirmed?.status).toBe('verified');
    expect(JSON.stringify(saved)).not.toContain('personal-photo-key');
    await expect(
      saveSottoCredential(database, {
        ...input,
        context: { ...saved.context, owner: { subjectId: 'profile:bob', generation: 1000 } },
        expectedRevision: operationId,
        operationId: randomUUID(),
        values: { apiKey: 'personal-photo-key' },
        allowUnverified: false,
      })
    ).rejects.toThrow(/owner changed/);
    const removed = randomUUID();
    await removeSottoCredential(database, {
      ...input,
      operationId: removed,
      expectedRevision: operationId,
    });
    expect(
      await listSottoCredentialSettings(database, { ...input, providers: ['pexels'] })
    ).toMatchObject({ heads: { pexels: removed }, keys: [] });
    await expect(
      saveSottoCredential(database, {
        ...input,
        operationId: randomUUID(),
        expectedRevision: null,
        values: { apiKey: 'personal-photo-key' },
        allowUnverified: false,
      })
    ).rejects.toThrow('changed');
  });

  it('requires explicit unverified saving and preserves the previous credential after rejection', async () => {
    const admitted = await transaction((tx) => admission(tx));
    const input = {
      request: admitted.request,
      identity: admitted.identity,
      scope: 'visual' as const,
      provider: 'pexels',
      operationId: randomUUID(),
      expectedRevision: null,
      values: { apiKey: 'unverified-photo-key' },
      allowUnverified: false,
    };
    vi.stubGlobal('fetch', async () => new Response(null, { status: 503 }));
    expect(await saveSottoCredential(database, input)).toMatchObject({
      status: 'needs_confirmation',
    });
    expect(
      (await listSottoCredentialSettings(database, { ...input, providers: ['pexels'] })).keys
    ).toEqual([]);
    await saveSottoCredential(database, { ...input, allowUnverified: true });
    const saved = await listSottoCredentialSettings(database, { ...input, providers: ['pexels'] });
    expect(saved.keys[0]).toMatchObject({
      isValid: true,
      verification: { lastConfirmed: null, lastAttempt: { status: 'inconclusive' } },
    });
    vi.stubGlobal('fetch', async () => new Response(null, { status: 401 }));
    await expect(
      saveSottoCredential(database, {
        ...input,
        expectedRevision: input.operationId,
        operationId: randomUUID(),
        values: { apiKey: 'rejected-photo-key' },
        allowUnverified: true,
      })
    ).rejects.toThrow('rejected');
    expect(
      (await listSottoCredentialSettings(database, { ...input, providers: ['pexels'] })).heads
        .pexels
    ).toBe(input.operationId);
  });

  it('edits usage settings without losing saved secrets and rejects an edit based on an older revision', async () => {
    const admitted = await transaction((tx) => admission(tx));
    const input = {
      request: admitted.request,
      identity: admitted.identity,
      scope: 'tts' as const,
      provider: 'cartesia',
      allowUnverified: false,
    };
    vi.stubGlobal('fetch', async (_url: URL, options: RequestInit) => {
      expect(new Headers(options.headers).get('authorization')).toBe(
        'Bearer personal-cartesia-key'
      );
      return Response.json({ data: [], has_more: false });
    });
    const original = randomUUID();
    const saved = await saveSottoCredential(database, {
      ...input,
      operationId: original,
      expectedRevision: null,
      values: {
        apiKey: 'personal-cartesia-key',
        adminApiKey: 'personal-usage-key',
        usagePlan: 'custom',
        monthlyCreditLimit: 5000,
      },
    });
    expect(saved).toMatchObject({ status: 'saved', revision: original });
    await transaction(async (tx) => {
      const storage = await sottoCredentialStorage(tx, 'tts', 'cartesia');
      const owner = await captureSottoCredentialOwner(tx, 'alice');
      const ticket = await storage.owned.beginVerification({ ...storage.slot, owner }, original);
      await storage.owned.finishVerification(ticket!, {
        status: 'rejected',
        readiness: { code: 'not_authenticated', checkedAt: Date.now() },
      });
    });
    await expect(getSharedByokKey('alice', 'cartesia')).rejects.toThrow('disabled');
    const replacement = randomUUID();
    await saveSottoCredential(database, {
      ...input,
      operationId: replacement,
      expectedRevision: original,
      patch: { usagePlan: 'pro', monthlyCreditLimit: null, billingResetDay: 15 },
    });
    const selected = await transaction((tx) =>
      resolveSottoRequestCredential(tx, input.request, input.identity, 'tts', 'cartesia')
    );
    expect(selected?.credential.values).toEqual({
      apiKey: 'personal-cartesia-key',
      adminApiKey: 'personal-usage-key',
      usagePlan: 'pro',
      billingResetDay: 15,
    });
    expect(selected?.credential.credentialRevision).toBe(replacement);
    expect(await getSharedByokKey('alice', 'cartesia')).toMatchObject({
      apiKey: 'personal-cartesia-key',
      ownerUserId: 'alice',
      shared: false,
      extraData: { adminApiKey: 'personal-usage-key', usagePlan: 'pro', billingResetDay: '15' },
      provenance: {
        revision: replacement,
        owner: { subjectId: 'profile:alice', generation: 1000 },
      },
    });
    await expect(
      saveSottoCredential(database, {
        ...input,
        operationId: randomUUID(),
        expectedRevision: original,
        patch: { adminApiKey: 'stale-usage-key' },
      })
    ).rejects.toThrow('changed');
    expect(
      (await listSottoCredentialSettings(database, { ...input, providers: ['cartesia'] })).heads
        .cartesia
    ).toBe(replacement);
  });

  it('cannot publish a delayed validation result over a concurrent credential creation', async () => {
    const admitted = await transaction((tx) => admission(tx));
    const input = {
      request: admitted.request,
      identity: admitted.identity,
      scope: 'visual' as const,
      provider: 'pexels',
      operationId: randomUUID(),
      expectedRevision: null,
      values: { apiKey: 'delayed-key' },
      allowUnverified: false,
    };
    let releaseProbe!: (response: Response) => void;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    vi.stubGlobal('fetch', () => {
      signalStarted();
      return new Promise<Response>((resolve) => {
        releaseProbe = resolve;
      });
    });
    const pending = saveSottoCredential(database, input);
    const conflict = expect(pending).rejects.toThrow('changed');
    await started;
    const replacementId = randomUUID();
    await transaction(async (tx) => {
      const storage = await sottoCredentialStorage(tx, 'visual', 'pexels');
      const owner = await captureSottoCredentialOwner(tx, 'alice');
      await storage.owned.replace(
        storage.owned.prepareReplacement(
          { ...storage.slot, owner },
          {
            expectedHeadRevision: null,
            credentialRevision: replacementId,
            values: { apiKey: 'newer-key' },
            binding: { protocol: 'pexels', endpoint: 'https://api.pexels.com' },
            availability: 'enabled',
            label: 'Pexels',
            metadata: { createdAt: 1, updatedAt: 1, lastUsedAt: null },
          }
        )
      );
    });
    releaseProbe(Response.json({ photos: [], page: 1, per_page: 1, total_results: 0 }));
    await conflict;
    expect(
      (await listSottoCredentialSettings(database, { ...input, providers: ['pexels'] })).heads
        .pexels
    ).toBe(replacementId);
  });

  it('reconciles a lost commit response against the saved operation without probing again', async () => {
    const admitted = await transaction((tx) => admission(tx));
    const input = {
      request: admitted.request,
      identity: admitted.identity,
      scope: 'visual' as const,
      provider: 'pexels',
      operationId: randomUUID(),
      expectedRevision: null,
      values: { apiKey: 'committed-key' },
      allowUnverified: false,
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ photos: [], page: 1, per_page: 1, total_results: 0 })
        )
        .mockRejectedValue(new Error('Provider went offline after the first probe'))
    );
    let disconnect = true;
    const connection = new Proxy(database, {
      get(target, property, receiver) {
        if (property !== '$transaction') return Reflect.get(target, property, receiver);
        return async (
          operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
          options: Parameters<PrismaClient['$transaction']>[1]
        ) => {
          const result = await target.$transaction(operation, options);
          if (
            disconnect &&
            result &&
            typeof result === 'object' &&
            'status' in result &&
            result.status === 'saved'
          ) {
            disconnect = false;
            throw new Error('Database connection closed after commit');
          }
          return result;
        };
      },
    });
    expect(await saveSottoCredential(connection, input)).toMatchObject({
      status: 'saved',
      revision: input.operationId,
    });
    expect(
      (await listSottoCredentialSettings(database, { ...input, providers: ['pexels'] })).heads
        .pexels
    ).toBe(input.operationId);
  });

  it('rolls back an accepted credential write when the caller cancels before transaction completion', async () => {
    const admitted = await transaction((tx) => admission(tx));
    const controller = new AbortController();
    const input = {
      request: new Request(admitted.request, { signal: controller.signal }),
      identity: admitted.identity,
      scope: 'visual' as const,
      provider: 'pexels',
      operationId: randomUUID(),
      expectedRevision: null,
      values: { apiKey: 'cancelled-key' },
      allowUnverified: false,
    };
    vi.stubGlobal('fetch', async () =>
      Response.json({ photos: [], page: 1, per_page: 1, total_results: 0 })
    );
    const connection = new Proxy(database, {
      get(target, property, receiver) {
        if (property !== '$transaction') return Reflect.get(target, property, receiver);
        return (
          operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
          options: Parameters<PrismaClient['$transaction']>[1]
        ) =>
          target.$transaction(
            (tx) =>
              operation(
                new Proxy(tx, {
                  get(transaction, method, transactionReceiver) {
                    if (method !== '$queryRawUnsafe')
                      return Reflect.get(transaction, method, transactionReceiver);
                    return async (sql: string, ...values: unknown[]) => {
                      const result = await transaction.$queryRawUnsafe(sql, ...values);
                      if (
                        values.some(
                          (value) =>
                            typeof value === 'string' && value.includes('"kind":"owned_credential"')
                        )
                      )
                        controller.abort(new Error('Caller cancelled before commit'));
                      return result;
                    };
                  },
                })
              ),
            options
          );
      },
    });
    await expect(saveSottoCredential(connection, input)).rejects.toThrow('cancelled');
    expect(
      await listSottoCredentialSettings(database, {
        request: admitted.request,
        identity: admitted.identity,
        scope: 'visual',
        providers: ['pexels'],
      })
    ).toMatchObject({ heads: { pexels: null }, keys: [] });
  });
  async function storeBob(tx: Prisma.TransactionClient) {
    const storage = await sottoCredentialStorage(tx, 'ai', 'openai');
    const owner = await captureSottoCredentialOwner(tx, 'bob');
    await storage.owned.replace(
      storage.owned.prepareReplacement(
        { ...storage.slot, owner },
        {
          expectedHeadRevision: null,
          credentialRevision: randomUUID(),
          values: { apiKey: 'bob-private-key' },
          binding: { protocol: 'openai', endpoint: 'https://api.openai.com/v1' },
          availability: 'enabled',
          label: 'Bob',
          metadata: { createdAt: 1, updatedAt: 1, lastUsedAt: null },
        }
      )
    );
    return { storage, owner };
  }
  it('requires an explicit grant before another household learner can use a key', async () => {
    await transaction(async (tx) => {
      const { request, identity } = await admission(tx);
      const { storage, owner } = await storeBob(tx);
      expect(await resolveSottoRequestCredential(tx, request, identity, 'ai', 'openai')).toBeNull();
      await storage.sharing.set(storage.slot, null, {
        owner,
        audience: 'household',
        excludedRecipients: [],
        source: 'explicit',
      });
      const selected = await resolveSottoRequestCredential(tx, request, identity, 'ai', 'openai');
      expect(selected).toMatchObject({
        shared: true,
        ownerUserId: 'bob',
        credential: { values: { apiKey: 'bob-private-key' }, owner },
      });
      expect(await listSottoProfileCredentials(tx, 'alice', ['ai'], false)).toEqual([]);
      expect(await listSottoProfileCredentials(tx, 'alice', ['ai'], true)).toMatchObject([
        { shared: true, ownerUserId: 'bob', credential: { provider: 'openai' } },
      ]);
    });
    expect(await getAiKey('alice', 'openai')).toBeNull();
    expect(await getSharedAiKey('alice', 'openai')).toMatchObject({
      apiKey: 'bob-private-key',
      provider: 'openai',
      ownerUserId: 'bob',
      shared: true,
    });
    vi.stubEnv('BYOK_ENCRYPTION_KEY', '');
    try {
      expect(await listAiProviders('bob')).toMatchObject([{ provider: 'openai', isValid: true }]);
    } finally {
      vi.stubEnv('BYOK_ENCRYPTION_KEY', 'provider-storage-test-secret');
    }
  });
  it('prefers personal AI credentials before shared providers and preserves Anthropic preference', async () => {
    async function add(userId: string, provider: string, createdAt: number, shared = false) {
      await transaction(async (tx) => {
        const storage = await sottoCredentialStorage(tx, 'ai', provider);
        const owner = await captureSottoCredentialOwner(tx, userId);
        await storage.owned.replace(
          storage.owned.prepareReplacement(
            { ...storage.slot, owner },
            {
              expectedHeadRevision: null,
              credentialRevision: randomUUID(),
              values: { apiKey: `${userId}-${provider}` },
              binding: { protocol: 'test', endpoint: 'https://example.com/v1' },
              availability: 'enabled',
              label: provider,
              metadata: { createdAt, updatedAt: createdAt, lastUsedAt: null },
            }
          )
        );
        if (shared)
          await storage.sharing.set(storage.slot, null, {
            owner,
            audience: 'household',
            excludedRecipients: [],
            source: 'explicit',
          });
      });
    }
    await add('bob', 'anthropic', 1, true);
    await add('alice', 'openai', 2);
    await add('alice', 'google', 3);
    expect(await getSharedAiKey('alice')).toMatchObject({ apiKey: 'alice-openai', shared: false });
    await add('alice', 'anthropic', 4);
    expect(await getAiKey('alice')).toMatchObject({
      apiKey: 'alice-anthropic',
      provider: 'anthropic',
    });
    expect(await getAiKey('alice', 'google')).toMatchObject({
      apiKey: 'alice-google',
      provider: 'google',
    });
  });
  it.each(['profile', 'instance'])(
    'rejects credential access after %s erasure starts',
    async (kind) => {
      await transaction(async (tx) => {
        const { request, identity } = await admission(tx, 'bob');
        const { storage, owner } = await storeBob(tx);
        const scope = kind === 'profile' ? owner : storage.instance;
        await storage.writes.forbidWrites(
          prepareStorageTombstone({
            namespace: SIDEDOOR_STATE_ID,
            subjectId: scope.subjectId,
            generation: scope.generation,
            jobId: randomUUID(),
          })
        );
        await expect(
          resolveSottoRequestCredential(tx, request, identity, 'ai', 'openai')
        ).rejects.toMatchObject({ code: 'conflict' });
      });
    }
  );
  it('does not let a caller replace its original authenticated learner', async () => {
    await transaction(async (tx) => {
      const { request, identity } = await admission(tx);
      await storeBob(tx);
      await expect(
        resolveSottoRequestCredential(tx, request, { ...identity, userId: 'bob' }, 'ai', 'openai')
      ).rejects.toMatchObject({ code: 'conflict' });
    });
  });
  it('keeps transcription attached to the existing AI or TTS key slot', () => {
    expect(sottoCredentialSlot('stt', 'openai')).toEqual({ modality: 'ai', provider: 'openai' });
    expect(sottoCredentialSlot('stt', 'elevenlabs')).toEqual({
      modality: 'tts',
      provider: 'elevenlabs',
    });
    expect(sottoCredentialSlot('stt', 'cartesia')).toEqual({
      modality: 'tts',
      provider: 'cartesia',
    });
  });

  it('does not replace a disabled personal key with a household key', async () => {
    await transaction(async (tx) => {
      const { request, identity } = await admission(tx);
      const { storage, owner } = await storeBob(tx);
      await storage.sharing.set(storage.slot, null, {
        owner,
        audience: 'household',
        excludedRecipients: [],
        source: 'explicit',
      });
      const personal = { ...storage.slot, owner: await captureSottoCredentialOwner(tx, 'alice') };
      const prepared = storage.owned.prepareReplacement(personal, {
        expectedHeadRevision: null,
        credentialRevision: randomUUID(),
        values: { apiKey: 'alice-disabled-key' },
        binding: { protocol: 'openai', endpoint: 'https://api.openai.com/v1' },
        availability: 'disabled',
        label: null,
        metadata: { createdAt: 1, updatedAt: 1, lastUsedAt: null },
      });
      await storage.owned.replace(prepared);
      await expect(
        resolveSottoRequestCredential(tx, request, identity, 'ai', 'openai')
      ).rejects.toThrow(/disabled/);
      expect(await listSottoProfileCredentials(tx, 'alice', ['ai'], true)).toMatchObject([
        { shared: false, ownerUserId: 'alice', credential: { availability: 'disabled' } },
      ]);
    });
    await expect(getSharedAiKey('alice', 'openai')).rejects.toThrow(/disabled/);
  });

  it.each(['cartesia', 'elevenlabs'])(
    'retains %s auxiliary fields when transcription uses the TTS slot',
    async (provider) => {
      await transaction(async (tx) => {
        const { request, identity } = await admission(tx, 'bob');
        const storage = await sottoCredentialStorage(tx, 'tts', provider);
        const owner = await captureSottoCredentialOwner(tx, 'bob');
        const values: CredentialValues =
          provider === 'cartesia'
            ? {
                apiKey: 'tts-key',
                adminApiKey: 'usage-key',
                usagePlan: 'previous-plan',
                monthlyCreditLimit: 1234,
                billingResetDay: 12,
              }
            : { apiKey: 'tts-key' };
        await storage.owned.replace(
          storage.owned.prepareReplacement(
            { ...storage.slot, owner },
            {
              expectedHeadRevision: null,
              credentialRevision: randomUUID(),
              values,
              binding: { protocol: provider, endpoint: 'https://example.com' },
              availability: 'enabled',
              label: null,
              metadata: { createdAt: 1, updatedAt: 1, lastUsedAt: null },
            }
          )
        );
        expect(
          (await resolveSottoRequestCredential(tx, request, identity, 'stt', provider))?.credential
            .values
        ).toEqual(values);
      });
    }
  );

  it('rolls back sharing revocation when the state write cannot persist', async () => {
    await transaction(async (tx) => {
      const { storage, owner } = await storeBob(tx);
      await storage.sharing.set(storage.slot, null, {
        owner,
        audience: 'household',
        excludedRecipients: [],
        source: 'explicit',
      });
      await tx.$executeRawUnsafe(
        `ALTER TABLE "SidedoorState" ADD CONSTRAINT retain_bob CHECK (id <> 'sotto-platform-v2' OR state #> '{access,householdProfiles}' @> '[{"id":"bob"}]'::jsonb)`
      );
    });
    await expect(
      transaction(async (tx) => {
        await revokeSottoCredentialSharing(tx, ['bob']);
        await sidedoorStateStore(tx).transact((state) => {
          state.access.householdProfiles = state.access.householdProfiles?.filter(
            (profile) => profile.id !== 'bob'
          );
        });
      })
    ).rejects.toThrow();
    await transaction(async (tx) => {
      const storage = await sottoCredentialStorage(tx, 'ai', 'openai');
      expect((await storage.sharing.head(storage.slot)).policy?.owner.subjectId).toBe(
        'profile:bob'
      );
      expect(
        (await sidedoorStateStore(tx).read()).access.householdProfiles?.some(
          (profile) => profile.id === 'bob'
        )
      ).toBe(true);
      await tx.$executeRawUnsafe('ALTER TABLE "SidedoorState" DROP CONSTRAINT retain_bob');
    });
  });

  it('revokes all pages of an owner grants and preserves unrelated sharing', async () => {
    await transaction(async (tx) => {
      const { storage, owner } = await storeBob(tx);
      for (let index = 0; index < 101; index++)
        await storage.sharing.set({ modality: 'ai', provider: `provider-${index}` }, null, {
          owner,
          audience: 'household',
          excludedRecipients: [],
          source: 'explicit',
        });
      const alice = await captureSottoCredentialOwner(tx, 'alice');
      await storage.sharing.set(storage.slot, null, {
        owner: alice,
        audience: 'household',
        excludedRecipients: [],
        source: 'explicit',
      });
      await revokeSottoCredentialSharing(tx, ['bob']);
      const retained = [];
      let cursor: string | null = null;
      do {
        const page = await storage.sharing.list(cursor);
        retained.push(...page.items);
        cursor = page.cursor;
      } while (cursor !== null);
      expect(retained).toEqual([
        expect.objectContaining({
          provider: 'openai',
          policy: expect.objectContaining({ owner: alice }),
        }),
      ]);
    });
  });

  it('erases ciphertext without its encryption secret and removes exact-generation exclusions', async () => {
    await transaction(async (tx) => {
      const { storage, owner } = await storeBob(tx);
      await storage.sharing.set(storage.slot, null, {
        owner,
        audience: 'household',
        excludedRecipients: [],
        source: 'explicit',
      });
      const other = { modality: 'tts', provider: 'openai' };
      const alice = await captureSottoCredentialOwner(tx, 'alice');
      const later = { ...owner, generation: owner.generation + 1 };
      await storage.sharing.set(other, null, {
        owner: alice,
        audience: 'household',
        excludedRecipients: [owner, later],
        source: 'imported',
      });
      vi.stubEnv('BYOK_ENCRYPTION_KEY', '');
      try {
        await eraseSottoProviderCredentials(tx, 'bob');
      } finally {
        vi.stubEnv('BYOK_ENCRYPTION_KEY', 'provider-storage-test-secret');
      }
      expect((await storage.owned.head({ ...storage.slot, owner })).credential).toBeNull();
      expect((await storage.sharing.head(storage.slot)).policy).toBeNull();
      expect((await storage.sharing.head(other)).policy?.excludedRecipients).toEqual([later]);
      const rows = await tx.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*) FROM "SidedoorState" WHERE state->>'kind' = 'owned_credential' AND state->'owner'->>'subjectId' = 'profile:bob'`
      );
      expect(rows[0]?.count).toBe(0n);
    });
  });

  it('rolls back erased ciphertext when the surrounding deletion fails', async () => {
    await transaction((tx) => storeBob(tx));
    await expect(
      transaction(async (tx) => {
        await eraseSottoProviderCredentials(tx, 'bob');
        throw new Error('Deletion failed after credential removal');
      })
    ).rejects.toThrow(/Deletion failed/);
    await transaction(async (tx) => {
      const storage = await sottoCredentialStorage(tx, 'ai', 'openai');
      const owner = await captureSottoCredentialOwner(tx, 'bob');
      expect((await storage.owned.resolve({ ...storage.slot, owner }))?.values.apiKey).toBe(
        'bob-private-key'
      );
    });
  });

  it('erases every page of credential slots while preserving another owner', async () => {
    await transaction(async (tx) => {
      const instance = await sottoStorageInstance(tx).read();
      const owner = await captureSottoCredentialOwner(tx, 'bob');
      const alice = await captureSottoCredentialOwner(tx, 'alice');
      const credentials = new OwnedCredentials(
        { query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
        'postgres',
        {
          namespace: SIDEDOOR_STATE_ID,
          instanceId: instance.instanceId,
          encryptionKey: randomBytes(32),
          descriptors: () => [
            {
              id: 'test',
              label: 'Test',
              transport: 'api',
              capabilities: [],
              models: [],
              fields: [
                { id: 'apiKey', label: 'Key', kind: 'string', required: true, secret: true },
              ],
            },
          ],
        }
      );
      for (let index = 0; index < 102; index++) {
        await credentials.replace(
          credentials.prepareReplacement(
            { owner: index === 101 ? alice : owner, modality: `scope-${index}`, provider: 'test' },
            {
              expectedHeadRevision: null,
              credentialRevision: randomUUID(),
              values: { apiKey: 'test-only-key' },
              binding: { protocol: 'test', endpoint: 'https://example.com' },
              availability: 'enabled',
              label: null,
              metadata: { createdAt: 1, updatedAt: 1, lastUsedAt: null },
            }
          )
        );
      }
      await storeBob(tx);
      expect(await listSottoProfileCredentials(tx, 'bob', ['ai'], false)).toMatchObject([
        { credential: { provider: 'openai' }, ownerUserId: 'bob', shared: false },
      ]);
      await eraseSottoProviderCredentials(tx, 'bob');
      const remaining = [];
      let cursor: string | null = null;
      do {
        const page = await credentials.listOwner(owner, cursor);
        remaining.push(...page.items);
        cursor = page.cursor;
      } while (cursor !== null);
      expect(remaining).toEqual([]);
      expect((await credentials.listOwner(alice)).items).toHaveLength(1);
    });
  });
});
