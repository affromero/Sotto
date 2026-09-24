// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AccessService,
  AccessError,
  HouseholdProfileService,
  accessStateSchema,
  initialAccessState,
} from 'thesidedoor-core/access';
import { FileStateStore } from 'thesidedoor-core/storage';
import { accessHandler, accessOperation } from '@/lib/sidedoor/access/core/http';
import { sottoDeviceService } from '@/lib/sidedoor/access/state/device-identity';

describe('Sotto shared access HTTP configuration', () => {
  let directory: string;
  let access: AccessService;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sotto-access-http-'));
    access = new AccessService({
      store: new FileStateStore({
        path: join(directory, 'access.json'),
        initial: initialAccessState,
        parse: (value) => accessStateSchema.parse(value),
      }),
    });
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://sotto.example');
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
    vi.stubEnv('SIDEDOOR_TRUSTED_PROXY', 'false');
    await access.claimOwner(
      await access.issueOperatorToken(),
      'Owner',
      'owner password phrase',
      'household'
    );
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });
  function handler() {
    return accessHandler({
      access,
      profiles: new HouseholdProfileService(access),
      devices: sottoDeviceService(access),
    });
  }
  function householdRequest(url: string, headers: Record<string, string> = {}) {
    return new Request(`${url}/api/v1/access/household`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://sotto.example', ...headers },
      body: JSON.stringify({ password: 'owner password phrase' }),
    });
  }
  it('uses direct Host after framework URL normalization and revokes the resulting session', async () => {
    const route = handler();
    const response = await route(
      householdRequest('https://localhost', { host: 'sotto.example' }),
      'household'
    );
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie')!;
    expect(cookie).toMatch(/sotto_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const request = () =>
      new Request('https://sotto.example/api/v1/access/session', {
        headers: { cookie: cookie.split(';')[0]! },
      });
    expect((await route(request(), 'session')).status).toBe(200);
    await access.logout(cookie.split(';')[0]!.slice('sotto_session='.length));
    expect((await route(request(), 'session')).status).toBe(401);
  });
  it('accepts internal proxy URLs for the configured HTTPS origin', async () => {
    expect((await handler()(householdRequest('http://internal:3000'), 'household')).status).toBe(
      200
    );
  });
  it('allows password aliases while keeping passkey ceremonies on the canonical origin', async () => {
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '["https://lan.example"]');
    const route = handler();
    expect(
      (
        await route(
          householdRequest('https://lan.example', { origin: 'https://lan.example' }),
          'household'
        )
      ).status
    ).toBe(200);
    const request = new Request('https://lan.example/api/v1/access/authentication-options', {
      method: 'POST',
      headers: { origin: 'https://lan.example', 'content-type': 'application/json' },
      body: '{}',
    });
    expect((await route(request, 'authentication-options')).status).toBe(403);
  });
  it('rejects credential-bearing configuration before creating an access handler', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://secret@example.test');
    expect(handler).toThrow(/clean origin/);
  });
  it('checks browser origin before a custom operation can change access state', async () => {
    const response = await accessOperation(
      householdRequest('https://sotto.example', { origin: 'https://attacker.example' }),
      true,
      async () => {
        await access.store.transact((state) => {
          state.mode = 'individual';
        });
        return Response.json({ ok: true });
      }
    );
    expect(response.status).toBe(403);
    expect((await access.store.read()).mode).toBe('household');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('preserves native originless access and makes custom credential responses uncacheable', async () => {
    const response = await accessOperation(
      new Request('https://sotto.example/api/v1/auth/pair/redeem', { method: 'POST' }),
      false,
      async () => Response.json({ token: 'returned-once' })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ token: 'returned-once' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it.each([
    ['unauthorized', 401],
    ['forbidden', 403],
    ['invalid', 400],
    ['conflict', 409],
    ['rate_limited', 429],
  ] as const)('returns %s without exposing internal credential details', async (code, status) => {
    const response = await accessOperation(
      householdRequest('https://sotto.example'),
      true,
      async () => {
        throw new AccessError(code, 'internal credential detail');
      }
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: code });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('sanitizes unexpected storage failures', async () => {
    const response = await accessOperation(
      householdRequest('https://sotto.example'),
      true,
      async () => {
        throw new Error('postgres://secret');
      }
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('postgres://secret');
  });
  it('allows bodyless browser deletion only from the configured origin', async () => {
    for (const origin of ['https://sotto.example', 'https://attacker.example']) {
      const response = await accessOperation(
        new Request('https://sotto.example/api/v1/keys/id', {
          method: 'DELETE',
          headers: { origin },
        }),
        true,
        async () => new Response(null, { status: 204 })
      );
      expect(response.status).toBe(origin === 'https://sotto.example' ? 204 : 403);
    }
  });
  it('checks multipart browser origins without consuming or changing the upload body', async () => {
    for (const origin of ['https://sotto.example', 'https://attacker.example']) {
      const form = new FormData();
      form.set('avatar', new File(['image bytes'], 'avatar.png', { type: 'image/png' }));
      const request = new Request('https://sotto.example/api/v1/users/me/avatar', {
        method: 'POST',
        headers: { origin },
        body: form,
      });
      const response = await accessOperation(request, true, async () => {
        const file = (await request.formData()).get('avatar');
        if (!(file instanceof File)) throw new Error('Missing file');
        return Response.json({ contents: await file.text() });
      });
      expect(response.status).toBe(origin === 'https://sotto.example' ? 200 : 403);
      if (response.ok) expect(await response.json()).toEqual({ contents: 'image bytes' });
      else expect(request.bodyUsed).toBe(false);
    }
  });
});
