import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayRoomView } from '@sotto/shared';
import { PlayJoin } from '@/components/play/PlayJoin';
import { safetyResponse } from './safety/fixtures';
import {
  readPendingPlayAdmission,
  savePendingPlayAdmission,
  type PendingPlayAdmission,
} from '@/components/play/client/intent';

const navigation = vi.hoisted(() => ({ destinations: [] as string[] }));
vi.mock('next/navigation', () => ({
  useRouter: (() => {
    const router = { replace: (path: string) => navigation.destinations.push(path) };
    return () => router;
  })(),
}));

const settings = { nativeLang: 'en', targetLang: 'de', level: 'A1' } as const;
const requestId = '1f413a64-eb31-4221-b922-184475eac8b4';
const code = 'ABCDEFGH2345';
const instant = new Date(Date.now() + 600_000).toISOString();
const distribution = { ios: null, androidStore: null, androidApk: null };

function saved(existing = false): PendingPlayAdmission {
  return {
    version: 1,
    serverUrl: location.origin,
    proof: 'a'.repeat(43),
    originalProfileId: existing ? 'first-profile' : null,
    savedAt: Date.now(),
    received: null,
    command: {
      requestId,
      code,
      client: 'BROWSER',
      deviceName: 'Browser',
      acceptedConductVersion: 1,
      candidate: existing
        ? { kind: 'EXISTING', expectedProfileId: 'first-profile', settings }
        : { kind: 'NEW', name: 'Partner', consentToProfile: true, settings },
    },
  };
}

function status(value = 'WAITING_FOR_OWNER') {
  return { requestId, status: value, expiresAt: instant, serverTime: instant };
}

function room(profileId = 'new-profile'): PlayRoomView {
  return {
    id: 'game',
    status: 'WAITING',
    revision: 2,
    rematchRoomId: null,
    kind: 'MIXED',
    theme: 'FOOD',
    questionStyle: 'CHOICES',
    ownSeat: 'GUEST',
    host: { id: 'host', name: 'Host', settings },
    guest: { id: profileId, name: 'Partner', settings },
    hostWaiting: true,
    allowedActions: [],
    round: null,
    completedRounds: [],
    points: 0,
    serverTime: instant,
  };
}

function show() {
  return render(<PlayJoin distribution={distribution} installationError={null} />);
}

function reconnect() {
  window.dispatchEvent(new Event('online'));
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
  localStorage.clear();
  sessionStorage.clear();
});

describe('browser invitation admission and recovery', () => {
  it('rechecks profile-switch consent against the actual active profile before claiming', async () => {
    savePendingPlayAdmission(saved());
    let current: string | null = null;
    let admission = 'WAITING_FOR_OWNER';
    const claims: unknown[] = [];
    vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
      const safety = safetyResponse(path);
      if (safety) return safety;
      if (path === '/api/v1/users/me')
        return current
          ? Response.json({ id: current, name: current })
          : Response.json({}, { status: 401 });
      if (path.endsWith('/claim')) {
        claims.push(JSON.parse(String(options?.body)));
        current = 'new-profile';
        return Response.json({
          kind: 'BROWSER',
          deliveryId: 'delivery',
          roomId: 'game',
          profile: { id: 'new-profile', name: 'Partner', settings },
          expiresAt: instant,
        });
      }
      if (path.endsWith('/ack')) return Response.json({ acknowledged: true });
      if (path.includes('/rooms/')) return Response.json(room());
      return Response.json(status(admission));
    });
    show();
    await screen.findByText(/server owner needs to approve/);
    current = 'Owner';
    admission = 'ACCEPTED';
    act(reconnect);
    await screen.findByText(/currently signed in as Owner/);
    expect(claims).toEqual([]);
    current = 'Another learner';
    fireEvent.click(screen.getByRole('button', { name: /Switch this browser/ }));
    await screen.findByText(/currently signed in as Another learner/);
    expect(claims).toEqual([]);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Switch this browser/ })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: /Switch this browser/ }));
    await waitFor(() => expect(navigation.destinations).toContain('/play/rooms/game'));
    expect(claims).toEqual([{ expectedProfileId: 'Another learner' }]);
    expect(readPendingPlayAdmission()).toBeNull();
  });

  it('retains an existing request when another tab changes its selected profile', async () => {
    savePendingPlayAdmission(saved(true));
    let current = 'first-profile';
    let admission = 'WAITING_FOR_HOST';
    const writes: string[] = [];
    vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
      const safety = safetyResponse(path);
      if (safety) return safety;
      if (options?.method === 'POST') writes.push(path);
      if (path === '/api/v1/users/me') return Response.json({ id: current, name: current });
      return Response.json(status(admission));
    });
    show();
    await screen.findByText(/game host needs to let you enter/);
    current = 'second-profile';
    admission = 'ACCEPTED';
    act(reconnect);
    await screen.findByRole('alert');
    expect(screen.getByText(/Choose the profile that requested entry/)).toBeInTheDocument();
    expect(writes).toEqual([]);
    expect(readPendingPlayAdmission()?.originalProfileId).toBe('first-profile');
    expect(navigation.destinations).toEqual([]);
  });

  it('rejects an existing delivery for a different profile before clearing recovery information', async () => {
    savePendingPlayAdmission(saved(true));
    vi.stubGlobal('fetch', async (path: string) => {
      const safety = safetyResponse(path);
      if (safety) return safety;
      if (path === '/api/v1/users/me') return Response.json({ id: 'first-profile' });
      if (path.endsWith('/claim'))
        return Response.json({
          kind: 'EXISTING',
          roomId: 'game',
          profile: { id: 'second-profile', name: 'Other', settings },
        });
      return Response.json(status('ACCEPTED'));
    });
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent(/different profile/);
    expect(readPendingPlayAdmission()?.originalProfileId).toBe('first-profile');
    expect(navigation.destinations).toEqual([]);
  });

  it('leaves an in-flight claim recoverable after the waiting page unmounts', async () => {
    savePendingPlayAdmission(saved());
    let deliver: ((response: Response) => void) | undefined;
    let claimSignal: AbortSignal | null | undefined;
    const writes: string[] = [];
    vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
      const safety = safetyResponse(path);
      if (safety) return safety;
      if (path === '/api/v1/users/me') return Response.json({}, { status: 401 });
      if (options?.method === 'POST') writes.push(path);
      if (path.endsWith('/claim')) {
        claimSignal = options?.signal;
        return new Promise<Response>((resolve) => {
          deliver = resolve;
        });
      }
      return Response.json(status('ACCEPTED'));
    });
    const page = show();
    await waitFor(() => expect(claimSignal).toBeDefined());
    page.unmount();
    expect(claimSignal?.aborted).toBe(true);
    await act(async () => {
      deliver?.(
        Response.json({
          kind: 'BROWSER',
          deliveryId: 'delivery',
          roomId: 'game',
          profile: { id: 'new-profile', name: 'Partner', settings },
          expiresAt: instant,
        })
      );
    });
    expect(readPendingPlayAdmission()?.received).toBeNull();
    expect(writes).toEqual([`/api/v1/play/join-requests/${requestId}/claim`]);
    expect(navigation.destinations).toEqual([]);
  });

  it('checks the displayed existing profile again before creating an entry request', async () => {
    let current = 'First';
    const writes: string[] = [];
    vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
      const safety = safetyResponse(path);
      if (safety) return safety;
      if (options?.method === 'POST') writes.push(path);
      if (path === '/api/v1/users/me') return Response.json({ id: current, name: current });
      return Response.json({
        roomId: 'game',
        hostName: 'Host',
        kind: 'MIXED',
        theme: 'FOOD',
        questionStyle: 'CHOICES',
        hostWaiting: true,
        expiresAt: instant,
        serverTime: instant,
      });
    });
    show();
    const submit = await screen.findByRole('button', { name: 'Ask to join as First' });
    fireEvent.click(await screen.findByRole('checkbox', { name: /I accept this server/ }));
    await waitFor(() => expect(submit).toBeEnabled());
    current = 'Second';
    fireEvent.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent(/profile changed/);
    expect(screen.getByRole('button', { name: 'Ask to join as Second' })).toBeInTheDocument();
    expect(writes).toEqual([]);
    expect(readPendingPlayAdmission()).toBeNull();
  });

  it('retries an uncertain intake with the same request and private proof', async () => {
    let unavailable = true;
    const sent: { body: unknown; proof: string | null }[] = [];
    vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
      const safety = safetyResponse(path);
      if (safety) return safety;
      if (path === '/api/v1/users/me') return Response.json({ id: 'First', name: 'First' });
      if (options?.method === 'POST') {
        sent.push({
          body: JSON.parse(String(options.body)),
          proof: new Headers(options.headers).get('X-Sotto-Play-Proof'),
        });
        if (unavailable) {
          unavailable = false;
          throw new TypeError('Disconnected');
        }
        return Response.json(status('WAITING_FOR_HOST'));
      }
      if (path.includes('/join-requests/')) return Response.json({}, { status: 404 });
      return Response.json({
        roomId: 'game',
        hostName: 'Host',
        kind: 'MIXED',
        theme: 'FOOD',
        questionStyle: 'CHOICES',
        hostWaiting: true,
        expiresAt: instant,
        serverTime: instant,
      });
    });
    show();
    const submit = await screen.findByRole('button', { name: 'Ask to join as First' });
    expect(submit).toBeDisabled();
    fireEvent.click(await screen.findByRole('checkbox', { name: /I accept this server/ }));
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    const retry = await screen.findByRole('button', { name: 'Retry the same join request' });
    await waitFor(() => expect(retry).toBeEnabled());
    fireEvent.click(retry);
    await screen.findByText(/game host needs to let you enter/);
    expect(sent[1]).toEqual(sent[0]);
    expect(readPendingPlayAdmission()?.command.candidate).toMatchObject({
      kind: 'EXISTING',
      expectedProfileId: 'First',
    });
    expect(readPendingPlayAdmission()?.command.acceptedConductVersion).toBe(1);
    expect(Object.values(localStorage).join('')).not.toContain(sent[0].proof);
  });
});
