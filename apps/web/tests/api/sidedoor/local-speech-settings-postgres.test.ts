// @vitest-environment node
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { NextRequest } from 'next/server';
import type { PrismaClient } from '@/generated/prisma/client';
import { useProviderCredentialDatabase } from '../../helpers/runtime/provider-credentials-postgres';
import { EMPTY_INFRA, getSiteConfig, setSiteConfig } from '@/lib/site-config';
import { sidedoorStateStore } from '@/lib/sidedoor/access/state/store';
import * as authentication from '@/lib/api-keys';
import {
  captureSottoCredentialOwner,
  sottoCredentialStorage,
} from '@/lib/sidedoor/credentials/runtime/provider-credentials';
import { captureConfiguredSottoCredentialProbe } from '@/lib/providers/shared/credential-validation';
import { getProviderMeta } from '@/lib/providers/tts-registry';
import { AccessService, HouseholdProfileService } from 'thesidedoor-core/access';
import { sottoAccessStore } from '@/lib/sidedoor/access/core/access-store';

let database: PrismaClient;
vi.mock('openai', async () => {
  const { createRequire } = await import('node:module');
  return { default: createRequire(import.meta.url)('openai') };
});
vi.mock('@/lib/prisma', () => ({
  get prismaUnfiltered() {
    return database;
  },
}));
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('atomic explicit local speech settings with canonical PostgreSQL authority', () => {
  const fixture = useProviderCredentialDatabase();
  let patch: (request: NextRequest) => Promise<Response>;
  let get: (request: NextRequest) => Promise<Response>;
  let cloudKey: string;
  beforeAll(async () => {
    database = fixture.database;
    const baseline = await readFile(
      'prisma/migrations/20260720021500_baseline/migration.sql',
      'utf8'
    );
    const courseTable = baseline.match(/CREATE TABLE "Course" \([\s\S]*?\n\);/);
    if (!courseTable) throw new Error('Missing baseline Course table');
    await fixture.transaction((tx) => tx.$executeRawUnsafe(courseTable[0]));
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost');
    patch = (await import('@/app/api/v1/settings/local-speech/route')).PATCH;
    get = (await import('@/app/api/v1/settings/local-speech/route')).GET;
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    cloudKey = `local-speech-fixture-${randomUUID()}`;
    await fixture.transaction(async (tx) => {
      await tx.$executeRawUnsafe('DELETE FROM "Course"');
      await tx.$executeRawUnsafe(
        'INSERT INTO "Course" (id, "userId", "nativeLang", "targetLang", "curriculumId", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6)',
        'fixture-course',
        'alice',
        'en',
        'fr',
        'fixture-curriculum',
        new Date()
      );
      await sidedoorStateStore(tx).transact((state) => {
        state.configuration.site = { ...EMPTY_INFRA, ttsProvider: 'cartesia', aiProvider: 'codex' };
        const owner = state.access.principals.find((principal) => principal.role === 'owner');
        const profile = state.access.householdProfiles?.find((entry) => entry.id === 'alice');
        if (!owner || !profile) throw new Error('Missing fixture owner profile');
        profile.ownerPrincipalId = owner.id;
      });
      await tx.user.update({
        where: { id: 'alice' },
        data: {
          preferredAiModel: 'codex:gpt-6-luna',
          preferredTtsModel: 'sonic-3.5',
          preferredLanguage: 'de',
        },
        select: { id: true },
      });
      const storage = await sottoCredentialStorage(tx, 'tts', 'cartesia');
      const owner = await captureSottoCredentialOwner(tx, 'alice');
      const probe = await captureConfiguredSottoCredentialProbe(tx, 'tts', 'cartesia', {
        apiKey: cloudKey,
      });
      if (probe.kind === 'unsupported') throw new Error('Missing fixture provider');
      await storage.owned.replace(
        storage.owned.prepareReplacement(
          { ...storage.slot, owner },
          {
            expectedHeadRevision: null,
            credentialRevision: randomUUID(),
            values: { apiKey: cloudKey },
            binding: probe.binding,
            availability: 'enabled',
            label: 'Fixture Cartesia',
            metadata: { createdAt: 1, updatedAt: 1, lastUsedAt: null },
          }
        )
      );
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const local = {
    mode: 'local',
    endpoint: 'http://local-tts:8090',
    model: 'piper',
    voices: ['de_DE-thorsten-high', 'de_DE-eva_k-x_low'],
  };
  async function request(body: unknown, origin = 'http://localhost') {
    const admission = await fixture.transaction((tx) => fixture.admission(tx));
    return new NextRequest('http://localhost/api/v1/settings/local-speech', {
      method: 'PATCH',
      headers: {
        origin,
        cookie: admission.request.headers.get('cookie')!,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }
  async function state() {
    return fixture.transaction(async (tx) => ({
      site: await getSiteConfig({ database: tx }),
      profile: await tx.user.findUniqueOrThrow({
        where: { id: 'alice' },
        select: { preferredTtsProvider: true, preferredTtsModel: true, preferredAiModel: true },
      }),
      access: (await sidedoorStateStore(tx).read()).access,
      cloud: await (
        await sottoCredentialStorage(tx, 'tts', 'cartesia')
      ).owned.head({
        ...(await sottoCredentialStorage(tx, 'tts', 'cartesia')).slot,
        owner: await captureSottoCredentialOwner(tx, 'alice'),
      }),
    }));
  }
  it('selects local speech atomically and preserves configured cloud and owner authority', async () => {
    const incoming = await request(local),
      before = await state();
    const response = await patch(incoming);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      mode: 'local',
      preferredTtsProvider: 'local',
      preferredTtsModel: 'piper',
    });
    const after = await state();
    expect(after.site).toEqual({
      ...before.site,
      ttsBaseUrl: local.endpoint,
      ttsVoices: local.voices.join(','),
    });
    expect(after.profile).toEqual({
      preferredTtsProvider: 'local',
      preferredTtsModel: 'piper',
      preferredAiModel: 'codex:gpt-6-luna',
    });
    expect(after.access).toEqual(before.access);
    expect(after.cloud).toEqual(before.cloud);
  });
  it('returns to configured speech by clearing both preferences and retaining local server configuration', async () => {
    expect((await patch(await request(local))).status).toBe(200);
    const incoming = await request({ mode: 'configured' }),
      before = await state();
    expect((await patch(incoming)).status).toBe(200);
    const after = await state();
    expect(after.profile).toEqual({
      preferredTtsProvider: null,
      preferredTtsModel: null,
      preferredAiModel: 'codex:gpt-6-luna',
    });
    expect(after.site).toEqual(before.site);
  });
  it('explicitly disables audio while preserving local and cloud configuration and the AI preference', async () => {
    expect((await patch(await request(local))).status).toBe(200);
    const incoming = await request({ mode: 'disabled' }),
      before = await state();
    expect((await patch(incoming)).status).toBe(200);
    const after = await state();
    expect(after.profile).toEqual({
      preferredTtsProvider: 'disabled',
      preferredTtsModel: null,
      preferredAiModel: 'codex:gpt-6-luna',
    });
    expect(after.site).toEqual(before.site);
  });
  it('rolls back shared local configuration when the profile update fails', async () => {
    await fixture.transaction((tx) =>
      tx.$executeRawUnsafe(
        'ALTER TABLE "User" ADD CONSTRAINT local_model_test CHECK ("preferredTtsModel" IS DISTINCT FROM \'rejected-model\')'
      )
    );
    try {
      const incoming = await request({ ...local, model: 'rejected-model' }),
        before = await state();
      expect((await patch(incoming)).status).toBe(503);
      expect(await state()).toEqual(before);
    } finally {
      await fixture.transaction((tx) =>
        tx.$executeRawUnsafe('ALTER TABLE "User" DROP CONSTRAINT local_model_test')
      );
    }
  });
  it.each([
    { ...local, endpoint: 'file:///tmp/speech' },
    { ...local, endpoint: 'http://key@local-tts:8090' },
    { ...local, endpoint: 'http://local-tts:8090?key=secret' },
    { ...local, model: '' },
    { ...local, model: 'x'.repeat(129) },
    { ...local, voices: ['voice-a'] },
    { ...local, voices: [' voice-a ', 'voice-a'] },
    { ...local, voices: ['voice-a', ''] },
    { ...local, voices: ['voice-a', 'x'.repeat(129)] },
    { ...local, ttsProvider: 'cartesia' },
  ])('rejects malformed local selections without changing state: %j', async (body) => {
    const incoming = await request(body),
      before = await state();
    expect((await patch(incoming)).status).toBe(400);
    expect(await state()).toEqual(before);
  });
  it('rejects a hostile origin before authentication or configuration writes', async () => {
    const incoming = await request(local, 'https://attacker.example'),
      before = await state();
    expect((await patch(incoming)).status).toBe(403);
    expect(await state()).toEqual(before);
  });
  it('requires an authenticated owner instead of trusting the selected profile role', async () => {
    const anonymous = new NextRequest('http://localhost/api/v1/settings/local-speech', {
      method: 'PATCH',
      headers: { origin: 'http://localhost', 'content-type': 'application/json' },
      body: JSON.stringify(local),
    });
    expect((await patch(anonymous)).status).toBe(401);
    const incoming = await request(local);
    await fixture.transaction((tx) =>
      sidedoorStateStore(tx).transact((shared) => {
        const owner = shared.access.principals.find((principal) => principal.role === 'owner');
        if (!owner) throw new Error('Missing fixture owner');
        owner.role = 'member';
      })
    );
    const before = await state();
    expect((await patch(incoming)).status).toBe(403);
    expect(await state()).toEqual(before);
  });
  it('rechecks owner authority after initial authentication before writing', async () => {
    const incoming = await request(local);
    const actual = authentication.authenticateRequest;
    vi.spyOn(authentication, 'authenticateRequest').mockImplementationOnce(async (req) => {
      const identity = await actual(req);
      await fixture.transaction((tx) =>
        sidedoorStateStore(tx).transact((shared) => {
          const owner = shared.access.principals.find((principal) => principal.role === 'owner');
          if (!owner) throw new Error('Missing fixture owner');
          owner.role = 'member';
        })
      );
      return identity;
    });
    const before = await state();
    expect((await patch(incoming)).status).toBe(409);
    const after = await state();
    expect(after.site).toEqual(before.site);
    expect(after.profile).toEqual(before.profile);
  });
  it('persists configured voice IDs through canonical shared state updates', async () => {
    await fixture.transaction((tx) => setSiteConfig({ ttsVoices: 'voice-a,voice-b' }, 'alice', tx));
    expect((await state()).site.ttsVoices).toBe('voice-a,voice-b');
  });
  it('lets an ordinary learner disable and restore configured audio without editing shared settings', async () => {
    await fixture.transaction((tx) =>
      sidedoorStateStore(tx).transact((shared) => {
        const profile = shared.access.householdProfiles?.find((entry) => entry.id === 'alice');
        if (!profile) throw new Error('Missing fixture profile');
        delete profile.ownerPrincipalId;
      })
    );
    const before = await state();
    expect((await patch(await request({ mode: 'disabled' }))).status).toBe(200);
    expect((await state()).profile).toMatchObject({
      preferredTtsProvider: 'disabled',
      preferredTtsModel: null,
    });
    expect((await patch(await request({ mode: 'configured' }))).status).toBe(200);
    const after = await state();
    expect(after.profile).toMatchObject({ preferredTtsProvider: null, preferredTtsModel: null });
    expect(after.site).toEqual(before.site);
    expect(after.cloud).toEqual(before.cloud);
    const localRequest = await request(local);
    const checkRequest = await request({ mode: 'check-credits', expectedProvider: 'cartesia' });
    const beforeRejectedSelections = await state();
    expect((await patch(localRequest)).status).toBe(403);
    expect((await patch(checkRequest)).status).toBe(403);
    expect(await state()).toEqual(beforeRejectedSelections);
    const incoming = await request({ mode: 'configured' });
    const metadata = await get(new NextRequest(incoming.url, { headers: incoming.headers }));
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toMatchObject({
      provider: 'cartesia',
      creditsBlocked: false,
      status: { state: 'unobserved' },
    });
  });
  it.each(['changed', 'revoked'])(
    'rejects %s profile admission before preference changes',
    async (change) => {
      const incoming = await request({ mode: 'disabled' });
      const authenticate = authentication.authenticateRequest;
      vi.spyOn(authentication, 'authenticateRequest').mockImplementationOnce(async (req) => {
        const identity = await authenticate(req);
        await fixture.transaction(async (tx) => {
          const access = new AccessService({ store: await sottoAccessStore(tx) });
          const token = req.headers.get('cookie')!.split('=')[1];
          if (change === 'revoked') await access.logout(token);
          else await new HouseholdProfileService(access).select(token, 'bob');
        });
        return identity;
      });
      const before = await state();
      expect((await patch(incoming)).status).toBe(change === 'revoked' ? 401 : 409);
      const after = await state();
      expect(after.profile).toEqual(before.profile);
      expect(after.site).toEqual(before.site);
      expect(after.cloud).toEqual(before.cloud);
    }
  );
  it('reports the known credit block without provider calls or preference changes', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response('Model credits limit reached: Fixture credits exhausted', { status: 402 })
    );
    expect(
      (await patch(await request({ mode: 'check-credits', expectedProvider: 'cartesia' }))).status
    ).toBe(402);
    vi.stubGlobal('fetch', () => {
      throw new Error('Unexpected provider request');
    });
    const incoming = await request({ mode: 'configured' }),
      before = await state();
    const response = await get(new NextRequest(incoming.url, { headers: incoming.headers }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      provider: 'cartesia',
      creditsBlocked: true,
      status: { state: 'credits_exhausted' },
    });
    expect(await state()).toEqual(before);
  });
  it.each(['cartesia', 'openai'] as const)(
    'checks selected %s through canonical captured transport without changing preferences',
    async (selected) => {
      if (selected === 'openai')
        await fixture.transaction(async (tx) => {
          const storage = await sottoCredentialStorage(tx, 'tts', selected);
          const owner = await captureSottoCredentialOwner(tx, 'alice');
          const values = { apiKey: cloudKey };
          const probe = await captureConfiguredSottoCredentialProbe(tx, 'tts', selected, values);
          if (probe.kind === 'unsupported') throw new Error('Missing fixture provider');
          await storage.owned.replace(
            storage.owned.prepareReplacement(
              { ...storage.slot, owner },
              {
                expectedHeadRevision: null,
                credentialRevision: randomUUID(),
                values,
                binding: probe.binding,
                availability: 'enabled',
                label: selected,
                metadata: { createdAt: 1, updatedAt: 1, lastUsedAt: null },
              }
            )
          );
          await tx.user.update({
            where: { id: 'alice' },
            data: { preferredTtsProvider: selected, preferredTtsModel: 'tts-1-hd' },
            select: { id: true },
          });
        });
      if (selected === 'cartesia') {
        vi.stubGlobal(
          'fetch',
          async () =>
            new Response('Model credits limit reached: Fixture credits exhausted', { status: 402 })
        );
        expect(
          (await patch(await request({ mode: 'check-credits', expectedProvider: selected }))).status
        ).toBe(402);
      }
      const delivered: Request[] = [];
      const audio = Buffer.alloc(44 + 3200);
      audio.write('RIFF');
      audio.writeUInt32LE(audio.length - 8, 4);
      audio.write('WAVEfmt ', 8);
      audio.writeUInt32LE(16, 16);
      audio.writeUInt16LE(1, 20);
      audio.writeUInt16LE(1, 22);
      audio.writeUInt32LE(16000, 24);
      audio.writeUInt32LE(32000, 28);
      audio.writeUInt16LE(2, 32);
      audio.writeUInt16LE(16, 34);
      audio.write('data', 36);
      audio.writeUInt32LE(3200, 40);
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const actual = new Request(input, init);
        if (
          actual.url !==
          (selected === 'cartesia'
            ? 'https://api.cartesia.ai/tts/bytes'
            : 'https://api.openai.com/v1/audio/speech')
        )
          throw new Error('Unexpected provider');
        delivered.push(actual);
        return new Response(audio, { headers: { 'Content-Type': 'audio/wav' } });
      });
      const before = await state();
      const response = await patch(
        await request({ mode: 'check-credits', expectedProvider: selected })
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        mode: 'check-credits',
        provider: selected,
        creditsBlocked: false,
      });
      const statusRequest = await request({ mode: 'configured' });
      const metadata = await get(
        new NextRequest(statusRequest.url, { headers: statusRequest.headers })
      );
      expect(await metadata.json()).toMatchObject({ provider: selected, creditsBlocked: false });
      expect(delivered.map((call) => call.method)).toEqual(['POST']);
      const body = await delivered[0].json();
      expect(body).toMatchObject(
        selected === 'cartesia'
          ? { transcript: 'Sot-toe.', language: 'fr', model_id: 'sonic-3.5' }
          : { input: 'Sotto.', model: 'tts-1-hd' }
      );
      const after = await state();
      expect(after.profile).toEqual(before.profile);
      expect(after.site).toEqual(before.site);
      expect(after.cloud.credential?.credentialRevision).toEqual(
        before.cloud.credential?.credentialRevision
      );
    }
  );
  it('retains the credit block and preferences on an actual payment rejection', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response('Model credits limit reached: Private provider rejection', { status: 402 })
    );
    const before = await state();
    const response = await patch(
      await request({ mode: 'check-credits', expectedProvider: 'cartesia' })
    );
    expect(response.status).toBe(402);
    expect(JSON.stringify(await response.json())).not.toContain('Private provider rejection');
    const incoming = await request({ mode: 'configured' });
    const metadata = await get(new NextRequest(incoming.url, { headers: incoming.headers }));
    expect(await metadata.json()).toMatchObject({ provider: 'cartesia', creditsBlocked: true });
    const after = await state();
    expect(after.profile).toEqual(before.profile);
    expect(after.site).toEqual(before.site);
  });
  it.each(['fal', 'replicate'] as const)(
    'keeps %s selectable without offering or dispatching an unsupported credit probe',
    async (selected) => {
      await fixture.transaction(async (tx) => {
        const storage = await sottoCredentialStorage(tx, 'tts', selected);
        const owner = await captureSottoCredentialOwner(tx, 'alice');
        const values = { apiKey: cloudKey };
        const probe = await captureConfiguredSottoCredentialProbe(tx, 'tts', selected, values);
        if (probe.kind === 'unsupported') throw new Error('Missing fixture provider');
        await storage.owned.replace(
          storage.owned.prepareReplacement(
            { ...storage.slot, owner },
            {
              expectedHeadRevision: null,
              credentialRevision: randomUUID(),
              values,
              binding: probe.binding,
              availability: 'enabled',
              label: selected,
              metadata: { createdAt: 1, updatedAt: 1, lastUsedAt: null },
            }
          )
        );
        await tx.user.update({
          where: { id: 'alice' },
          data: {
            preferredTtsProvider: selected,
            preferredTtsModel: getProviderMeta(selected).defaultModel,
          },
          select: { id: true },
        });
      });
      vi.stubGlobal('fetch', () => {
        throw new Error('Unexpected provider request');
      });
      const incoming = await request({ mode: 'check-credits', expectedProvider: selected });
      const before = await state();
      const metadata = await get(new NextRequest(incoming.url, { headers: incoming.headers }));
      expect(metadata.status).toBe(200);
      expect(await metadata.json()).toMatchObject({ provider: selected, canCheckCredits: false });
      const response = await patch(incoming);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: 'The selected speech provider does not support a direct audio credit check.',
      });
      expect(await state()).toEqual(before);
    }
  );
  it('rejects stale provider selection before any paid request', async () => {
    vi.stubGlobal('fetch', () => {
      throw new Error('Unexpected provider request');
    });
    const incoming = await request({ mode: 'check-credits', expectedProvider: 'openai' }),
      before = await state();
    expect((await patch(incoming)).status).toBe(409);
    expect(await state()).toEqual(before);
  });
  it.each(['local', 'disabled'])('does not make a paid check for %s speech', async (mode) => {
    expect((await patch(await request(mode === 'local' ? local : { mode }))).status).toBe(200);
    vi.stubGlobal('fetch', () => {
      throw new Error('Unexpected provider request');
    });
    const incoming = await request({ mode: 'check-credits', expectedProvider: mode }),
      before = await state();
    expect((await patch(incoming)).status).toBe(mode === 'disabled' ? 409 : 400);
    const metadata = await get(new NextRequest(incoming.url, { headers: incoming.headers }));
    expect(await metadata.json()).toMatchObject({
      provider: mode === 'disabled' ? null : 'local',
      creditsBlocked: null,
      canCheckCredits: false,
    });
    expect(await state()).toEqual(before);
  });
});
