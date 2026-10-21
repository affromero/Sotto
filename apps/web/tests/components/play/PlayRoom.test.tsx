import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatPlayInviteCode, type PlayRoomView } from '@sotto/shared';
import { PlayRoom } from '@/components/play/PlayRoom';
import { advancePlayRound, createPlayRounds } from '@/lib/play/engine';
import { projectPlayRound } from '@/lib/play/projection';

const navigation = vi.hoisted(() => ({ destinations: [] as string[] }));
vi.mock('next/navigation', () => {
  const router = { push: (path: string) => navigation.destinations.push(path) };
  return { useRouter: () => router };
});
const settings = { nativeLang: 'en', targetLang: 'de', level: 'A1' } as const;
const instant = new Date(Date.now() + 600_000).toISOString();
function waiting(): PlayRoomView {
  return {
    id: 'game',
    status: 'WAITING',
    revision: 0,
    rematchRoomId: null,
    kind: 'KNOW_ME',
    theme: 'FOOD',
    questionStyle: 'CHOICES',
    ownSeat: 'HOST',
    host: { id: 'host', name: 'Host', settings },
    guest: null,
    hostWaiting: true,
    allowedActions: ['CANCEL'],
    round: null,
    completedRounds: [],
    points: 0,
    serverTime: instant,
  };
}
beforeEach(() => {
  navigation.destinations.length = 0;
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('game waiting room and reconnect', () => {
  it('keeps expiry when a historical action receipt has the same revision and an older server time', async () => {
    const privateRound = createPlayRounds({
      kind: 'KNOW_ME',
      theme: 'FOOD',
      players: { HOST: settings, GUEST: settings },
    })[0];
    const old: PlayRoomView = {
      ...waiting(),
      status: 'PLAYING',
      revision: 3,
      guest: { id: 'guest', name: 'Partner', settings },
      round: { ...projectPlayRound(privateRound, 'HOST'), id: 'round', order: 0 },
    };
    let view = old;
    let deliver: ((response: Response) => void) | undefined;
    let holdRefresh = false;
    let finishRefresh: ((response: Response) => void) | undefined;
    vi.stubGlobal('fetch', async (path: string) => {
      if (path.endsWith('/actions'))
        return new Promise<Response>((resolve) => {
          deliver = resolve;
        });
      if (holdRefresh)
        return new Promise<Response>((resolve) => {
          finishRefresh = resolve;
        });
      return Response.json(view);
    });
    render(<PlayRoom roomId="game" />);
    await screen.findByText('Connected');
    const card = screen
      .getAllByRole('button')
      .find((button) => button.textContent?.startsWith('A'));
    if (!card) throw new Error('Expected a prediction card');
    fireEvent.click(card);
    await waitFor(() => expect(deliver).toBeDefined());
    view = {
      ...old,
      status: 'EXPIRED',
      round: null,
      allowedActions: [],
      serverTime: new Date(Date.parse(old.serverTime) + 1000).toISOString(),
    };
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await screen.findByRole('heading', { name: 'This game has expired.' });
    holdRefresh = true;
    await act(async () => {
      deliver?.(Response.json(old));
    });
    await waitFor(() => expect(finishRefresh).toBeDefined());
    expect(screen.getByRole('heading', { name: 'This game has expired.' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Pick & predict' })).not.toBeInTheDocument();
    await act(async () => {
      finishRefresh?.(Response.json(view));
    });
  });

  it('does not restore private game data from a late mutation after admission is revoked', async () => {
    const privateRound = createPlayRounds({
      kind: 'KNOW_ME',
      theme: 'FOOD',
      players: { HOST: settings, GUEST: settings },
    })[0];
    const view = {
      ...waiting(),
      status: 'PLAYING',
      revision: 2,
      round: { ...projectPlayRound(privateRound, 'HOST'), id: 'round', order: 0 },
    };
    let revoked = false;
    let deliver: ((response: Response) => void) | undefined;
    vi.stubGlobal('fetch', async (path: string) => {
      if (path.endsWith('/actions'))
        return new Promise<Response>((resolve) => {
          deliver = resolve;
        });
      return revoked
        ? Response.json({ error: 'unauthorized' }, { status: 401 })
        : Response.json(view);
    });
    render(<PlayRoom roomId="game" />);
    await screen.findByText('Connected');
    const card = screen
      .getAllByRole('button')
      .find((button) => button.textContent?.startsWith('A'));
    if (!card) throw new Error('Expected a prediction card');
    fireEvent.click(card);
    await waitFor(() => expect(deliver).toBeDefined());
    revoked = true;
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await screen.findByRole('alert');
    await act(async () => {
      deliver?.(Response.json({ ...view, revision: 3 }));
    });
    expect(screen.queryByRole('region', { name: 'Pick & predict' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('unauthorized');
  });
  it('makes an invitation once and shows the same payload as a code, link and actual QR', async () => {
    let view = waiting();
    let invitation: { roomId: string; code: string; generation: number; expiresAt: string } | null =
      null;
    const issued: unknown[] = [];
    vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
      if (path.endsWith('/presence'))
        return Response.json({ hostWaiting: true, expiresAt: instant, serverTime: instant });
      if (path.endsWith('/join-requests')) return Response.json({ requests: [] });
      if (path.endsWith('/invitations')) {
        if (options?.method === 'POST') {
          issued.push(JSON.parse(String(options.body)));
          invitation = { roomId: 'game', code: 'ABCDEFGH2345', generation: 1, expiresAt: instant };
          view = { ...view, revision: 1 };
        }
        return Response.json(invitation);
      }
      return Response.json(view);
    });
    render(<PlayRoom roomId="game" />);
    expect(await screen.findByLabelText('Invitation code')).toHaveValue(
      formatPlayInviteCode('ABCDEFGH2345')
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Invitation link')).toHaveValue(
        `${location.origin}/play/join?v=1&code=ABCDEFGH2345`
      )
    );
    const qr = await screen.findByRole('img', { name: 'Scan to open this game invitation' });
    expect(qr.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await screen.findByText('Connected');
    expect(issued).toEqual([expect.objectContaining({ expectedRevision: 0 })]);
    expect(screen.getByText('You’re here and waiting.')).toBeInTheDocument();
  });

  it('keeps a committed pick when an older polling response arrives after the action', async () => {
    let privateRound = createPlayRounds({
      kind: 'KNOW_ME',
      theme: 'FOOD',
      players: { HOST: settings, GUEST: settings },
    })[0];
    let view: PlayRoomView = {
      ...waiting(),
      status: 'PLAYING',
      revision: 2,
      guest: { id: 'guest', name: 'Partner', settings },
      round: { ...projectPlayRound(privateRound, 'HOST'), id: 'round', order: 0 },
    };
    let delayNext = false;
    let deliver: ((response: Response) => void) | undefined;
    const actions: unknown[] = [];
    vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
      if (path.endsWith('/actions')) {
        const body = JSON.parse(String(options?.body));
        actions.push(body);
        privateRound = advancePlayRound(privateRound, 'HOST', body.command);
        view = {
          ...view,
          revision: 3,
          round: { ...projectPlayRound(privateRound, 'HOST'), id: 'round', order: 0 },
        };
        return Response.json(view);
      }
      if (delayNext) {
        delayNext = false;
        return new Promise<Response>((resolve) => {
          deliver = resolve;
        });
      }
      return Response.json(view);
    });
    render(<PlayRoom roomId="game" />);
    await screen.findByText('Connected');
    const old = structuredClone(view);
    delayNext = true;
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(deliver).toBeDefined());
    const card = screen
      .getAllByRole('button')
      .find((button) => button.textContent?.startsWith('A'));
    if (!card) throw new Error('Expected a prediction card');
    fireEvent.click(card);
    await screen.findByText(/Your pick is locked/);
    await act(async () => {
      deliver?.(Response.json(old));
    });
    expect(screen.getByText(/Your pick is locked/)).toBeInTheDocument();
    expect(actions).toEqual([
      expect.objectContaining({ expectedRevision: 2, command: { type: 'CHOOSE', optionId: 'A' } }),
    ]);
  });

  it('clears private cards when canonical room admission is no longer valid', async () => {
    const privateRound = createPlayRounds({
      kind: 'DESCRIBE',
      theme: 'FOOD',
      players: { HOST: settings, GUEST: settings },
    })[0];
    const view = {
      ...waiting(),
      status: 'PLAYING',
      revision: 2,
      round: { ...projectPlayRound(privateRound, 'HOST'), id: 'round', order: 0 },
    };
    let revoked = false;
    vi.stubGlobal('fetch', async () =>
      revoked ? Response.json({ error: 'unauthorized' }, { status: 401 }) : Response.json(view)
    );
    render(<PlayRoom roomId="game" />);
    await screen.findByRole('button', { name: /Apfel/ });
    revoked = true;
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('unauthorized');
    expect(screen.queryByRole('button', { name: /Apfel/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Check your active profile' })).toHaveAttribute(
      'href',
      '/profiles'
    );
  });
});
