import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayLobby } from '@/components/play/PlayLobby';

const navigation = vi.hoisted(() => ({ destinations: [] as string[] }));
vi.mock('next/navigation', () => {
  const router = { push: (path: string) => navigation.destinations.push(path) };
  return { useRouter: () => router };
});
const settings = { nativeLang: 'en', targetLang: 'de', level: 'A1' } as const;
const instant = new Date().toISOString();
beforeEach(() => {
  navigation.destinations.length = 0;
  localStorage.clear();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('independent partner-play lobby', () => {
  it('keeps exact approval recovery available after the committed request disappears from polling', async () => {
    let approved = false;
    const candidate = {
      requestId: 'pending',
      roomId: 'game',
      roomRevision: 1,
      name: 'New partner',
      candidateKind: 'NEW',
      settings,
      status: 'WAITING_FOR_OWNER',
      profileId: null,
      allowedActions: ['APPROVE_PROFILE', 'DECLINE'],
      expiresAt: instant,
      serverTime: instant,
    };
    const sent: unknown[] = [];
    vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        sent.push(JSON.parse(String(options.body)));
        if (!approved) {
          approved = true;
          throw new TypeError('Response lost');
        }
        return Response.json({
          ...candidate,
          status: 'WAITING_FOR_HOST',
          profileId: 'new-profile',
          allowedActions: [],
        });
      }
      if (path.endsWith('/enrollments'))
        return Response.json({ requests: approved ? [] : [candidate] });
      return Response.json(
        path.endsWith('/phrases')
          ? { phrases: [], nextCursor: null }
          : { rooms: [], nextCursor: null }
      );
    });
    render(<PlayLobby isOwner />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve new profile' }));
    await screen.findByRole('button', { name: 'Recover the same approval' });
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() =>
      expect(screen.queryByText('People waiting to join')).not.toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Make a game for two' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Recover the same approval' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Make a game for two' })).toBeEnabled()
    );
    expect(sent[1]).toEqual(sent[0]);
  });
  it('defaults to mixed card rounds and sends the selected language direction and level without a course', async () => {
    const created: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        const body = JSON.parse(String(options.body));
        created.push(body);
        return Response.json({
          id: 'game',
          status: 'WAITING',
          revision: 0,
          rematchRoomId: null,
          kind: body.kind,
          theme: body.theme,
          questionStyle: body.questionStyle,
          ownSeat: 'HOST',
          host: { id: 'host', name: 'Host', settings: body.settings },
          guest: null,
          hostWaiting: false,
          allowedActions: ['CANCEL'],
          round: null,
          completedRounds: [],
          points: 0,
          serverTime: instant,
        });
      }
      return Response.json(
        path.endsWith('/phrases')
          ? { phrases: [], nextCursor: null }
          : { rooms: [], nextCursor: null }
      );
    });
    render(<PlayLobby isOwner={false} />);
    await screen.findByText('Your next game starts here.');
    fireEvent.change(screen.getByLabelText('Language to practice'), { target: { value: 'en' } });
    expect(screen.getByRole('button', { name: 'Make a game for two' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/two different languages/);
    fireEvent.change(screen.getByLabelText('Language to practice'), { target: { value: 'de' } });
    fireEvent.change(screen.getByLabelText('Language for meanings'), { target: { value: 'es' } });
    fireEvent.change(screen.getByLabelText('Your comfort level'), { target: { value: 'B1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Make a game for two' }));
    await waitFor(() => expect(navigation.destinations).toEqual(['/play/rooms/game']));
    expect(created).toEqual([
      expect.objectContaining({
        kind: 'MIXED',
        questionStyle: 'CHOICES',
        settings: { nativeLang: 'es', targetLang: 'de', level: 'B1' },
      }),
    ]);
    expect(created[0]).not.toHaveProperty('courseId');
  });

  it('normalizes a human code and retains only the nonsecret invitation before navigation', async () => {
    vi.stubGlobal('fetch', async (path: string) =>
      Response.json(
        path.endsWith('/phrases')
          ? { phrases: [], nextCursor: null }
          : { rooms: [], nextCursor: null }
      )
    );
    render(<PlayLobby isOwner={false} />);
    await screen.findByText('Your next game starts here.');
    fireEvent.change(screen.getByLabelText('Invitation code'), {
      target: { value: 'abcd efgh 2345' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Find the game' }));
    expect(navigation.destinations).toEqual(['/play/join?v=1&code=ABCDEFGH2345']);
    expect(JSON.parse(localStorage.getItem('sotto:play-invitation:v1')!)).toMatchObject({
      invitation: {
        serverUrl: location.origin,
        code: 'ABCDEFGH2345',
        version: 1,
      },
    });
    expect(sessionStorage.getItem('sotto:play-admission:v1')).toBeNull();
  });

  it('shows server-owner profile enrollment separately from host entry approval', async () => {
    const requested: string[] = [];
    vi.stubGlobal('fetch', async (path: string) => {
      requested.push(path);
      if (path.endsWith('/enrollments'))
        return Response.json({
          requests: [
            {
              requestId: 'pending',
              roomId: 'game',
              roomRevision: 1,
              name: 'New partner',
              candidateKind: 'NEW',
              settings,
              status: 'WAITING_FOR_OWNER',
              profileId: null,
              allowedActions: ['APPROVE_PROFILE', 'DECLINE'],
              expiresAt: instant,
              serverTime: instant,
            },
          ],
        });
      return Response.json(
        path.endsWith('/phrases')
          ? { phrases: [], nextCursor: null }
          : { rooms: [], nextCursor: null }
      );
    });
    const lobby = render(<PlayLobby isOwner={false} />);
    await screen.findByText('Your next game starts here.');
    expect(requested).not.toContain('/api/v1/play/enrollments');
    expect(screen.queryByRole('button', { name: 'Approve new profile' })).not.toBeInTheDocument();
    lobby.rerender(<PlayLobby isOwner />);
    expect(await screen.findByRole('button', { name: 'Approve new profile' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open waiting game' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Let them enter' })).not.toBeInTheDocument();
  });
});
