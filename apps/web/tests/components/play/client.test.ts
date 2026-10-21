import { afterEach, describe, expect, it, vi } from 'vitest';
import { playInvitationActionSchema, playJoinStatusViewSchema } from '@sotto/shared';
import { newPlayActionId, playFetch } from '@/components/play/client/api';
import {
  clearPendingPlayAdmission,
  readPendingPlayAdmission,
  savePendingPlayAdmission,
  rememberPlayInvitation,
  readPlayInvitationIntent,
  type PendingPlayAdmission,
} from '@/components/play/client/intent';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});
const instant = '2026-10-20T17:00:00.000Z';

describe('private game browser transport', () => {
  it('creates valid action identifiers on local HTTP without randomUUID', () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const first = newPlayActionId();
    expect(
      playInvitationActionSchema.parse({ actionId: first, expectedRevision: 0 }).actionId
    ).toBe(first);
    expect(newPlayActionId()).not.toBe(first);
  });
  it('sends proof only in a header and refuses redirecting its request', async () => {
    const sent: { path: string; options: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (path: string, options: RequestInit) => {
      sent.push({ path, options });
      return Response.json({
        requestId: 'pending',
        status: 'ACCEPTED',
        expiresAt: instant,
        serverTime: instant,
      });
    });
    const proof = 'a'.repeat(43);
    expect(
      await playFetch('/api/v1/play/join-requests/pending', playJoinStatusViewSchema, { proof })
    ).toMatchObject({ status: 'ACCEPTED' });
    expect(sent[0]).toMatchObject({
      path: '/api/v1/play/join-requests/pending',
      options: {
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        headers: { 'X-Sotto-Play-Proof': proof },
      },
    });
    expect(sent[0]?.path).not.toContain(proof);
  });

  it('surfaces a server refusal and rejects incomplete or secret-bearing status responses', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({ error: 'Invitation unavailable.' }, { status: 409 })
    );
    await expect(
      playFetch('/api/v1/play/join-requests/pending', playJoinStatusViewSchema)
    ).rejects.toMatchObject({ status: 409 });
    vi.stubGlobal('fetch', async () =>
      Response.json({
        requestId: 'pending',
        status: 'ACCEPTED',
        expiresAt: instant,
        serverTime: instant,
        token: 'unexpected-secret',
      })
    );
    await expect(
      playFetch('/api/v1/play/join-requests/pending', playJoinStatusViewSchema)
    ).rejects.toMatchObject({ status: 0 });
  });

  it('distinguishes an uncertain network outcome from a refused request', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Connection interrupted');
    });
    await expect(
      playFetch('/api/v1/play/rooms', playJoinStatusViewSchema, {
        body: { actionId: 'retained-action' },
      })
    ).rejects.toMatchObject({ status: 0 });
  });
});

describe('versioned invitation return and credential-free admission recovery', () => {
  const invitation = { version: 1 as const, serverUrl: location.origin, code: 'ABCDEFGH2345' };
  function pending(): PendingPlayAdmission {
    return {
      version: 1,
      serverUrl: location.origin,
      proof: 'a'.repeat(43),
      originalProfileId: null,
      savedAt: Date.now(),
      received: null,
      command: {
        requestId: '1f413a64-eb31-4221-b922-184475eac8b4',
        code: invitation.code,
        client: 'BROWSER',
        deviceName: 'Browser',
        candidate: {
          kind: 'NEW',
          name: 'Partner',
          consentToProfile: true,
          settings: { nativeLang: 'en', targetLang: 'de', level: 'A1' },
        },
      },
    };
  }

  it('retains the exact invitation, proof and idempotency ID through a page reload', () => {
    rememberPlayInvitation(invitation);
    const saved = pending();
    savePendingPlayAdmission(saved);
    expect(readPlayInvitationIntent()).toEqual(invitation);
    expect(readPendingPlayAdmission()).toEqual(saved);
    expect(Object.values(localStorage).join('')).not.toContain(saved.proof);
    sessionStorage.clear();
    expect(readPendingPlayAdmission()).toBeNull();
    savePendingPlayAdmission(saved);
    clearPendingPlayAdmission();
    expect(readPendingPlayAdmission()).toBeNull();
    expect(readPlayInvitationIntent()).toEqual(invitation);
  });

  it('discards tampered credentials, unsupported versions and expired admission state', () => {
    const saved = pending();
    savePendingPlayAdmission(saved);
    sessionStorage.setItem(
      'sotto:play-admission:v1',
      JSON.stringify({ ...saved, token: 'never-store-a-session-here' })
    );
    expect(readPendingPlayAdmission()).toBeNull();
    sessionStorage.setItem('sotto:play-admission:v1', JSON.stringify({ ...saved, version: 2 }));
    expect(readPendingPlayAdmission()).toBeNull();
    sessionStorage.setItem(
      'sotto:play-admission:v1',
      JSON.stringify({ ...saved, savedAt: Date.now() - 25 * 60 * 60 * 1000 })
    );
    expect(readPendingPlayAdmission()).toBeNull();
  });

  it('refuses reusing a pending browser admission on another server or as a native token exchange', () => {
    const saved = pending();
    expect(() =>
      savePendingPlayAdmission({ ...saved, serverUrl: 'https://other.example' })
    ).toThrow();
    expect(() =>
      savePendingPlayAdmission({ ...saved, command: { ...saved.command, client: 'NATIVE' } })
    ).toThrow();
    expect(readPendingPlayAdmission()).toBeNull();
  });

  it('reports unavailable browser storage before an admission can be sent', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage denied', 'SecurityError');
    });
    expect(() => savePendingPlayAdmission(pending())).toThrow(DOMException);
  });
});
