import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayJoin } from '@/components/play/PlayJoin';
import {
  readPendingPlayAdmission,
  readRetainedPlayAdmissions,
  savePendingPlayAdmission,
  type PendingPlayAdmission,
} from '@/components/play/client/intent';
import { safety, safetyRoom } from './fixtures';

const navigation = vi.hoisted(() => ({ destinations: [] as string[] }));
vi.mock('next/navigation', () => {
  const router = { replace: (path: string) => navigation.destinations.push(path) };
  return { useRouter: () => router };
});
const requestId = '1f413a64-eb31-4221-b922-184475eac8b4';
const code = 'ABCDEFGH2345';
const instant = '2026-10-21T11:00:00.000Z';
const settings = { nativeLang: 'en', targetLang: 'de', level: 'A1' } as const;
const preview = {
  roomId: 'fixture-room',
  hostName: 'Alex',
  kind: 'MIXED',
  theme: 'FOOD',
  questionStyle: 'CHOICES',
  hostWaiting: true,
  expiresAt: instant,
  serverTime: instant,
};
function pending(): PendingPlayAdmission {
  return {
    version: 1,
    serverUrl: location.origin,
    proof: 'a'.repeat(43),
    originalProfileId: null,
    savedAt: Date.now(),
    received: null,
    command: {
      requestId,
      code,
      client: 'BROWSER',
      deviceName: 'Original browser',
      candidate: { kind: 'NEW', name: 'Sam', settings, consentToProfile: true },
    },
  };
}
function show() {
  render(
    <PlayJoin
      distribution={{ ios: null, androidStore: null, androidApk: null }}
      installationError={null}
    />
  );
}
beforeEach(() => {
  navigation.destinations.length = 0;
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, '', `/play/join?v=1&code=${code}`);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('explicit browser conduct and immutable old invitations', () => {
  it('keeps the new name local and refuses intake until both conduct and profile creation are accepted', async () => {
    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
      if (path === '/api/v1/users/me') return Response.json({}, { status: 401 });
      if (path === '/api/v1/play/policy') return Response.json(safety.policy);
      if (options?.method === 'POST') {
        const body = JSON.parse(String(options.body));
        sent.push(body);
        return Response.json({
          requestId: body.requestId,
          status: 'WAITING_FOR_OWNER',
          expiresAt: instant,
          serverTime: instant,
        });
      }
      if (path.includes('join-requests'))
        return Response.json({
          requestId: sent[0]?.requestId,
          status: 'WAITING_FOR_OWNER',
          expiresAt: instant,
          serverTime: instant,
        });
      return Response.json(preview);
    });
    show();
    const name = await screen.findByLabelText('What should your partner call you?');
    expect(name).toBeDisabled();
    const checkbox = await screen.findByRole('checkbox', { name: /I accept this server/ });
    expect(checkbox).not.toBeChecked();
    expect(sent).toEqual([]);
    fireEvent.click(checkbox);
    expect(name).toBeEnabled();
    fireEvent.change(name, { target: { value: 'Sam' } });
    expect(screen.getByRole('button', { name: 'Ask to join' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Create a persistent profile/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    await screen.findByText(/server owner needs to approve/);
    expect(sent).toEqual([
      expect.objectContaining({
        acceptedConductVersion: 1,
        candidate: expect.objectContaining({ kind: 'NEW', name: 'Sam', consentToProfile: true }),
      }),
    ]);
  });

  it('accepts conduct for a waiting legacy request using its proof without rewriting or reposting the command', async () => {
    const original = pending();
    savePendingPlayAdmission(original);
    const posts: { path: string; body: unknown; proof: string | null }[] = [];
    vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
      if (path === '/api/v1/users/me') return Response.json({}, { status: 401 });
      if (path === '/api/v1/play/policy') return Response.json(safety.policy);
      if (options?.method === 'POST') {
        posts.push({
          path,
          body: JSON.parse(String(options.body)),
          proof: new Headers(options.headers).get('X-Sotto-Play-Proof'),
        });
        return Response.json({ requestId, version: 1 });
      }
      return Response.json({
        requestId,
        status: 'WAITING_FOR_OWNER',
        expiresAt: instant,
        serverTime: instant,
      });
    });
    show();
    const checkbox = await screen.findByRole('checkbox', { name: /I accept this server/ });
    expect(readPendingPlayAdmission()).toEqual(original);
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: 'Accept conduct for saved invitation' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Accept conduct for saved invitation' })
      ).not.toBeInTheDocument()
    );
    expect(readPendingPlayAdmission()).toEqual({ ...original, conductVersion: 1 });
    expect(posts).toEqual([
      {
        path: `/api/v1/play/join-requests/${requestId}/conduct`,
        body: { version: 1, expectedProfileId: null },
        proof: original.proof,
      },
    ]);
  });

  it.each([401, 404])(
    'retains an unknown old command and proof after explicit current conduct when status returns %s',
    async (status) => {
      const original = pending();
      savePendingPlayAdmission(original);
      const posts: string[] = [];
      vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
        if (options?.method === 'POST') posts.push(path);
        if (path === '/api/v1/users/me') return Response.json({}, { status: 401 });
        if (path === '/api/v1/play/policy') return Response.json(safety.policy);
        if (path.includes('join-requests'))
          return Response.json({ error: 'Request unavailable.' }, { status });
        return Response.json(preview);
      });
      show();
      fireEvent.click(await screen.findByRole('checkbox', { name: /I accept this server/ }));
      fireEvent.click(
        screen.getByRole('button', { name: 'Keep unavailable old request and start again' })
      );
      await screen.findByLabelText('What should your partner call you?');
      expect(readPendingPlayAdmission()).toBeNull();
      expect(readRetainedPlayAdmissions()).toEqual([original]);
      expect(posts).toEqual([]);
      expect(Object.values(localStorage).join('')).not.toContain(original.proof);
    }
  );

  it('keeps an already-issued legacy browser receipt through explicit consent and an uncertain acknowledgment', async () => {
    const original = {
      ...pending(),
      received: {
        deliveryId: 'original-delivery',
        roomId: 'fixture-room',
        profileId: 'guest-profile',
      },
    };
    savePendingPlayAdmission(original);
    const posts: { path: string; body: unknown; proof: string | null }[] = [];
    let acknowledged = false;
    vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
      if (path === '/api/v1/users/me') return Response.json({ id: 'guest-profile', name: 'Sam' });
      if (path === '/api/v1/play/policy') return Response.json(safety.policy);
      if (options?.method === 'POST') {
        posts.push({
          path,
          body: JSON.parse(String(options.body)),
          proof: new Headers(options.headers).get('X-Sotto-Play-Proof'),
        });
        if (path.endsWith('/conduct')) return Response.json({ requestId, version: 1 });
        if (path.endsWith('/ack')) {
          if (!acknowledged) {
            acknowledged = true;
            return Response.json({ error: 'Lost confirmation' }, { status: 503 });
          }
          return Response.json({ acknowledged: true });
        }
        throw new Error('The issued legacy request must not be claimed or uploaded again.');
      }
      if (path.includes('/rooms/')) return Response.json(safetyRoom('playing-GUEST'));
      return Response.json({
        requestId,
        status: 'CLAIMED',
        expiresAt: instant,
        serverTime: instant,
      });
    });
    show();
    const checkbox = await screen.findByRole('checkbox', { name: /I accept this server/ });
    expect(posts).toEqual([]);
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: 'Accept conduct for saved invitation' }));
    const retry = await screen.findByRole('button', { name: 'Recover my game connection' });
    expect(readPendingPlayAdmission()).toEqual({ ...original, conductVersion: 1 });
    fireEvent.click(retry);
    await waitFor(() => expect(navigation.destinations).toEqual(['/play/rooms/fixture-room']));
    expect(posts.map((item) => item.path)).toEqual([
      `/api/v1/play/join-requests/${requestId}/conduct`,
      `/api/v1/play/join-requests/${requestId}/ack`,
      `/api/v1/play/join-requests/${requestId}/ack`,
    ]);
    expect(posts[0].body).toEqual({ version: 1, expectedProfileId: 'guest-profile' });
    expect(posts[1]).toEqual(posts[2]);
    expect(posts.every((item) => item.proof === original.proof)).toBe(true);
    expect(readPendingPlayAdmission()).toBeNull();
  });
});
