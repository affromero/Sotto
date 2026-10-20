// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  credentialSettingsSnapshotSchema,
  credentialSaveRequest,
  prepareCredentialSave,
  prepareCredentialRemoval,
} from 'thesidedoor-core/configuration/credential-client';
import { useProviderCredentialDatabase } from '../../helpers/runtime/provider-credentials-postgres';
import type { SottoCredentialEndpoint } from '@/lib/sidedoor/credentials/config/credential-http';
import { resolveSottoProfileCredential } from '@/lib/sidedoor/credentials/runtime/provider-credentials';

let database: PrismaClient;
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return database;
  },
  get prismaUnfiltered() {
    return database;
  },
}));

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('credential settings HTTP with canonical PostgreSQL storage', () => {
  const fixture = useProviderCredentialDatabase();
  let createHandler: (typeof import('@/lib/sidedoor/credentials/config/credential-http'))['createSottoCredentialSettingsHandler'];
  beforeAll(async () => {
    database = fixture.database;
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost');
    createHandler = (await import('@/lib/sidedoor/credentials/config/credential-http'))
      .createSottoCredentialSettingsHandler;
  });
  async function request(endpoint: SottoCredentialEndpoint, method: string, body?: unknown) {
    const admitted = await fixture.transaction((tx) => fixture.admission(tx));
    return new Request(`http://localhost/api/v1/settings/${endpoint}`, {
      method,
      headers: {
        cookie: admitted.request.headers.get('cookie')!,
        origin: 'http://localhost',
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  it.each([
    { endpoint: 'ai-keys' as const, provider: 'openai' },
    { endpoint: 'byok' as const, provider: 'cartesia' },
    { endpoint: 'visual-cues' as const, provider: 'pexels' },
  ])(
    'saves and removes $endpoint credentials through revision-bound commands',
    async ({ endpoint, provider }) => {
      const handler = createHandler(endpoint);
      const response = await handler(await request(endpoint, 'GET'));
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      const displayed = credentialSettingsSnapshotSchema.parse(await response.json());
      const draft = prepareCredentialSave(displayed, provider, {
        values: { apiKey: 'personal-provider-secret' },
      });
      vi.stubGlobal('fetch', async (url: URL | string) => {
        const host = new URL(String(url)).hostname;
        if (host === 'api.openai.com') return Response.json({ object: 'list', data: [] });
        if (host === 'api.cartesia.ai') return Response.json({ data: [], has_more: false });
        return Response.json({ photos: [], page: 1, per_page: 1, total_results: 0 });
      });
      const saved = await handler(await request(endpoint, 'POST', credentialSaveRequest(draft)));
      expect(saved.status).toBe(200);
      expect(await saved.json()).toMatchObject({ status: 'saved', revision: draft.operationId });
      const current = credentialSettingsSnapshotSchema.parse(
        await (await handler(await request(endpoint, 'GET'))).json()
      );
      expect(current.keys).toMatchObject([
        { provider, revision: draft.operationId, isValid: true },
      ]);
      expect(JSON.stringify(current)).not.toContain('personal-provider-secret');
      const removal = prepareCredentialRemoval(current, provider);
      expect(
        (await handler(await request(endpoint, 'DELETE', { ...removal, provider: undefined })))
          .status
      ).toBe(400);
      expect(
        credentialSettingsSnapshotSchema.parse(
          await (await handler(await request(endpoint, 'GET'))).json()
        )
      ).toEqual(current);
      const stored = await fixture.transaction((tx) =>
        resolveSottoProfileCredential(
          tx,
          'alice',
          endpoint === 'ai-keys' ? 'ai' : endpoint === 'byok' ? 'tts' : 'visual',
          provider,
          false
        )
      );
      expect(stored?.credential.values).toEqual({ apiKey: 'personal-provider-secret' });
      const removed = await handler(await request(endpoint, 'DELETE', removal));
      expect(removed.status).toBe(200);
      expect(await removed.json()).toMatchObject({
        status: 'removed',
        revision: removal.operationId,
      });
      const final = credentialSettingsSnapshotSchema.parse(
        await (await handler(await request(endpoint, 'GET'))).json()
      );
      expect(final.heads[provider]).toBe(removal.operationId);
      expect(final.keys).toEqual([]);
    }
  );
  it('rejects unauthenticated reads and oversized mutation bodies', async () => {
    const handler = createHandler('visual-cues');
    expect(
      (await handler(new Request('http://localhost/api/v1/settings/visual-cues'))).status
    ).toBe(401);
    expect(
      (
        await handler(
          await request('visual-cues', 'POST', { values: { apiKey: 'x'.repeat(40_000) } })
        )
      ).status
    ).toBe(413);
  });
  it.each(['ai-keys', 'byok', 'visual-cues'] as const)(
    'rejects unauthenticated mutations and malformed edits on %s',
    async (endpoint) => {
      const handler = createHandler(endpoint);
      for (const method of ['POST', 'DELETE']) {
        expect(
          (
            await handler(
              new Request(`http://localhost/api/v1/settings/${endpoint}`, {
                method,
              })
            )
          ).status
        ).toBe(401);
        const empty = await request(endpoint, method);
        expect((await handler(empty)).status).toBe(400);
        expect(
          (await handler(await request(endpoint, method, { provider: 'unknown' }))).status
        ).toBe(400);
      }
    }
  );
  it('preserves an existing credential when verification rejects a replacement', async () => {
    const handler = createHandler('ai-keys');
    async function snapshot() {
      return credentialSettingsSnapshotSchema.parse(
        await (await handler(await request('ai-keys', 'GET'))).json()
      );
    }
    vi.stubGlobal('fetch', async () => Response.json({ object: 'list', data: [] }));
    const first = prepareCredentialSave(await snapshot(), 'openai', {
      values: { apiKey: 'existing-secret' },
    });
    expect(
      (await handler(await request('ai-keys', 'POST', credentialSaveRequest(first)))).status
    ).toBe(200);
    const displayed = await snapshot();
    const invalid = prepareCredentialSave(displayed, 'openai', { values: { apiKey: '' } });
    expect(
      (await handler(await request('ai-keys', 'POST', credentialSaveRequest(invalid)))).status
    ).toBe(400);
    vi.stubGlobal('fetch', async () =>
      Response.json({ error: { message: 'Invalid API key' } }, { status: 401 })
    );
    const rejected = prepareCredentialSave(displayed, 'openai', {
      values: { apiKey: 'rejected-secret' },
    });
    expect(
      (await handler(await request('ai-keys', 'POST', credentialSaveRequest(rejected)))).status
    ).toBe(422);
    expect((await snapshot()).heads.openai).toBe(first.operationId);
  });
  it('patches Cartesia usage settings while preserving credentials and removing an obsolete custom limit', async () => {
    const handler = createHandler('byok');
    async function snapshot() {
      return credentialSettingsSnapshotSchema.parse(
        await (await handler(await request('byok', 'GET'))).json()
      );
    }
    const empty = await snapshot();
    const missing = prepareCredentialSave(empty, 'cartesia', { patch: { billingResetDay: 15 } });
    expect(
      (await handler(await request('byok', 'POST', credentialSaveRequest(missing)))).status
    ).toBe(400);
    vi.stubGlobal('fetch', async () => Response.json({ data: [], has_more: false }));
    const initial = prepareCredentialSave(empty, 'cartesia', {
      values: {
        apiKey: 'cartesia-personal-key',
        adminApiKey: 'cartesia-usage-key',
        usagePlan: 'custom',
        monthlyCreditLimit: 1234,
      },
    });
    expect(
      (await handler(await request('byok', 'POST', credentialSaveRequest(initial)))).status
    ).toBe(200);
    const patch = prepareCredentialSave(await snapshot(), 'cartesia', {
      patch: {
        usagePlan: 'pro',
        monthlyCreditLimit: null,
        billingResetDay: 15,
      },
    });
    expect(
      (await handler(await request('byok', 'POST', credentialSaveRequest(patch)))).status
    ).toBe(200);
    const stored = await fixture.transaction((tx) =>
      resolveSottoProfileCredential(tx, 'alice', 'tts', 'cartesia', false)
    );
    expect(stored?.credential.values).toEqual({
      apiKey: 'cartesia-personal-key',
      adminApiKey: 'cartesia-usage-key',
      usagePlan: 'pro',
      billingResetDay: 15,
    });
  });
});
