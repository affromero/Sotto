// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  credentialSettingsSnapshotSchema,
  credentialSaveRequest,
  prepareCredentialSave,
  prepareCredentialRemoval,
} from 'thesidedoor-core/configuration/credential-client';
import { useProviderCredentialDatabase } from '../../../helpers/runtime/provider-credentials-postgres';
import { EMPTY_INFRA, setSiteConfig } from '@/lib/site-config';
import { sidedoorStateStore } from '@/lib/sidedoor/access/state/store';
import { resolveSottoProfileCredential } from '@/lib/sidedoor/credentials/runtime/provider-credentials';

let connection: PrismaClient;
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return connection;
  },
  get prismaUnfiltered() {
    return connection;
  },
}));

const databaseSuite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
databaseSuite('compatible AI credential HTTP boundary', () => {
  const fixture = useProviderCredentialDatabase();
  let handler: ReturnType<
    typeof import('@/lib/sidedoor/credentials/config/credential-http').createSottoCredentialSettingsHandler
  >;
  const original = 'https://model-one.example/tenant/v1';
  const replacement = 'https://model-two.example/tenant/v1';
  beforeAll(async () => {
    connection = fixture.database;
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost');
    const { createSottoCredentialSettingsHandler } =
      await import('@/lib/sidedoor/credentials/config/credential-http');
    handler = createSottoCredentialSettingsHandler('ai-keys');
  });
  beforeEach(async () => {
    await fixture.transaction((tx) =>
      sidedoorStateStore(tx).transact((state) => {
        state.configuration.site = { ...EMPTY_INFRA };
      })
    );
  });
  async function invoke(method = 'GET', body?: unknown, reviewed = original) {
    const access = await fixture.transaction((tx) => fixture.admission(tx));
    const headers = new Headers(access.request.headers);
    headers.set('origin', 'http://localhost');
    headers.set('content-type', 'application/json');
    headers.set('x-sotto-reviewed-ai-endpoint', reviewed);
    return handler(
      new Request('http://localhost/api/v1/settings/ai-keys', {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    );
  }
  async function display() {
    return credentialSettingsSnapshotSchema.parse(await (await invoke()).json());
  }
  const configure = (url: string) => setSiteConfig({ aiBaseUrl: url }, 'alice', fixture.database);
  const selected = () =>
    fixture.transaction((tx) => resolveSottoProfileCredential(tx, 'alice', 'ai', 'local', false));

  it.each(['before dispatch', 'during verification', 'before confirmation'] as const)(
    'rejects a destination change %s without retaining the submitted key',
    async (movement) => {
      await configure(original);
      const draft = prepareCredentialSave(await display(), 'local', {
        values: { apiKey: 'tenant-key' },
      });
      const destinations: string[] = [];
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        destinations.push(request.url);
        expect(request.headers.get('authorization')).toBe('Bearer tenant-key');
        if (movement === 'during verification') await configure(replacement);
        return movement === 'before confirmation'
          ? Response.json({}, { status: 503 })
          : Response.json({ object: 'list', data: [{ id: 'tenant-model' }] });
      });
      if (movement === 'before confirmation') {
        const provisional = await invoke('POST', credentialSaveRequest(draft));
        expect(await provisional.json()).toMatchObject({ status: 'needs_confirmation' });
      }
      if (movement !== 'during verification') await configure(replacement);
      const refused = await invoke('POST', credentialSaveRequest(draft, true));
      expect(refused.status).toBe(409);
      expect(destinations).toEqual(movement === 'before dispatch' ? [] : [`${original}/models`]);
      expect(await selected()).toBeNull();
      expect((await display()).heads.local).toBeNull();
    }
  );

  it('stores an exact destination binding, exposes metadata only, and removes the same revision', async () => {
    await configure(original);
    const draft = prepareCredentialSave(await display(), 'local', {
      values: { apiKey: 'private-tenant-key' },
    });
    vi.stubGlobal('fetch', async () => Response.json({ object: 'list', data: [] }));
    const saved = await invoke('POST', credentialSaveRequest(draft, true));
    expect(await saved.json()).toMatchObject({ status: 'saved', revision: draft.operationId });
    expect((await selected())?.credential).toMatchObject({
      binding: { protocol: 'compatible', endpoint: original },
      values: { apiKey: 'private-tenant-key' },
    });
    const shown = await display();
    expect(JSON.stringify(shown)).not.toContain('private-tenant-key');
    const removal = prepareCredentialRemoval(shown, 'local');
    const removed = await invoke('DELETE', removal);
    expect(await removed.json()).toMatchObject({
      status: 'removed',
      revision: removal.operationId,
    });
    expect((await display()).heads.local).toBe(removal.operationId);
    expect(await selected()).toBeNull();
  });
});
