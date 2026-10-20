import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playRoundActionRequestSchema, type PlayRoomView, type PlaySeat } from '@sotto/shared';
import { PlayRoom } from '@/components/play/PlayRoom';
import { advancePlayRound, createPlayRounds } from '@/lib/play/engine';
import { projectPlayRound } from '@/lib/play/projection';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }));
const settings = { nativeLang: 'en', targetLang: 'de', level: 'A1' } as const;
const instant = new Date().toISOString();
function fixture(open = false) {
  const round = createPlayRounds({
    kind: 'KNOW_ME',
    theme: 'FOOD',
    questionStyle: open ? 'OPEN' : 'CHOICES',
    players: { HOST: settings, GUEST: settings },
  })[0];
  const initial: PlayRoomView = {
    id: 'game',
    status: 'PLAYING',
    revision: 2,
    rematchRoomId: null,
    kind: 'KNOW_ME',
    theme: 'FOOD',
    questionStyle: open ? 'OPEN' : 'CHOICES',
    ownSeat: 'HOST',
    host: { id: 'host', name: 'Host', settings },
    guest: { id: 'guest', name: 'Partner', settings },
    hostWaiting: false,
    allowedActions: [],
    points: 0,
    completedRounds: [],
    serverTime: instant,
    round: { ...projectPlayRound(round, 'HOST'), id: 'round', order: 0 },
  };
  const otherCommitted = advancePlayRound(
    round,
    'GUEST',
    open ? { type: 'ANSWER', text: 'Die Antwort' } : { type: 'CHOOSE', optionId: 'A' }
  );
  return {
    round,
    otherCommitted,
    initial,
    fresh: {
      ...initial,
      revision: 3,
      round: { ...projectPlayRound(otherCommitted, 'HOST'), id: 'round', order: 0 },
    },
  };
}
beforeEach(() => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});

function missionFixture(viewer: PlaySeat) {
  let round = createPlayRounds({
    kind: 'MISSION',
    theme: 'FOOD',
    players: { HOST: settings, GUEST: settings },
  })[0];
  for (let index = 0; index < 4; index++)
    round = advancePlayRound(round, index % 2 === 0 ? 'GUEST' : 'HOST', {
      type: 'MESSAGE',
      text: `Line ${index}`,
    });
  const initial: PlayRoomView = {
    ...fixture().initial,
    kind: 'MISSION',
    ownSeat: viewer,
    round: { ...projectPlayRound(round, viewer), id: 'round', order: 0 },
  };
  return { round, initial };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('independent round completion conflicts', () => {
  it.each(['HOST', 'GUEST'] as const)(
    'reconciles %s finishing the unchanged mission when the partner commits first',
    async (viewer) => {
      const { round, initial } = missionFixture(viewer);
      const other = viewer === 'HOST' ? 'GUEST' : 'HOST';
      const otherDone = advancePlayRound(round, other, { type: 'MISSION_DONE', achieved: true });
      const fresh = {
        ...initial,
        revision: 3,
        round: { ...projectPlayRound(otherDone, viewer), id: 'round', order: 0 },
      };
      let committed: PlayRoomView | null = null;
      const writes: ReturnType<typeof playRoundActionRequestSchema.parse>[] = [];
      vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
        if (path.endsWith('/actions')) {
          const body = playRoundActionRequestSchema.parse(JSON.parse(String(options?.body)));
          writes.push(body);
          if (writes.length === 1)
            return Response.json({ error: 'The game changed.' }, { status: 409 });
          const done = advancePlayRound(otherDone, viewer, body.command);
          committed = {
            ...fresh,
            revision: 4,
            round: { ...projectPlayRound(done, viewer), id: 'round', order: 0 },
          };
          return Response.json(committed);
        }
        return Response.json(committed ?? (writes.length ? fresh : initial));
      });
      render(<PlayRoom roomId="game" />);
      fireEvent.click(await screen.findByRole('button', { name: 'Yes, got it' }));
      await screen.findByText('Your objective: achieved.');
      expect(writes.map((body) => body.expectedRevision)).toEqual([2, 3]);
      expect(writes[0].actionId).not.toBe(writes[1].actionId);
      expect(writes[1].command).toEqual(writes[0].command);
    }
  );

  it.each(['new hint', 'own outcome', 'skip'] as const)(
    'does not recommit a mission outcome after a %s',
    async (change) => {
      const { round, initial } = missionFixture('HOST');
      const changed =
        change === 'new hint'
          ? advancePlayRound(round, 'GUEST', { type: 'HINT', text: 'Try a simpler sentence.' })
          : change === 'own outcome'
            ? advancePlayRound(round, 'HOST', { type: 'MISSION_DONE', achieved: true })
            : advancePlayRound(round, 'GUEST', { type: 'SKIP' });
      const fresh = {
        ...initial,
        revision: 3,
        round: { ...projectPlayRound(changed, 'HOST'), id: 'round', order: 0 },
      };
      const writes: unknown[] = [];
      vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
        if (path.endsWith('/actions')) {
          writes.push(JSON.parse(String(options?.body)));
          return Response.json({ error: 'The game changed.' }, { status: 409 });
        }
        return Response.json(writes.length ? fresh : initial);
      });
      render(<PlayRoom roomId="game" />);
      fireEvent.click(await screen.findByRole('button', { name: 'Yes, got it' }));
      await screen.findByRole('alert');
      if (change === 'new hint') {
        await screen.findByText('Try a simpler sentence.', { selector: 'p' });
        await waitFor(() =>
          expect(screen.getByRole('button', { name: 'Yes, got it' })).toBeEnabled()
        );
      } else if (change === 'own outcome') await screen.findByText('Your objective: achieved.');
      else await screen.findByText('Skipped. Try the next one.');
      expect(writes).toHaveLength(1);
    }
  );
  it('requires a fresh deliberate mission outcome after a partner changes the conversation', async () => {
    let mission = createPlayRounds({
      kind: 'MISSION',
      theme: 'FOOD',
      players: { HOST: settings, GUEST: settings },
    })[0];
    for (let index = 0; index < 4; index++)
      mission = advancePlayRound(mission, index % 2 === 0 ? 'GUEST' : 'HOST', {
        type: 'MESSAGE',
        text: `Line ${index}`,
      });
    const { initial } = fixture();
    const before = {
      ...initial,
      kind: 'MISSION',
      round: { ...projectPlayRound(mission, 'HOST'), id: 'round', order: 0 },
    };
    const counterproposal = advancePlayRound(mission, 'GUEST', {
      type: 'MESSAGE',
      text: 'Wait, can we eat out instead?',
    });
    const after = {
      ...before,
      revision: 3,
      round: { ...projectPlayRound(counterproposal, 'HOST'), id: 'round', order: 0 },
    };
    const writes: unknown[] = [];
    vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
      if (path.endsWith('/actions')) {
        writes.push(JSON.parse(String(options?.body)));
        return Response.json({ error: 'The game changed.' }, { status: 409 });
      }
      return Response.json(writes.length ? after : before);
    });
    render(<PlayRoom roomId="game" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, got it' }));
    await screen.findByText('Wait, can we eat out instead?', { selector: 'p' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Yes, got it' })).toBeEnabled());
    expect(writes).toHaveLength(1);
    expect(after.round.allowedActions).toContain('MISSION_DONE');
  });
  it.each([false, true])(
    'finishes a simultaneous independent answer after one confirmed conflict (open=%s)',
    async (open) => {
      const { initial, fresh, otherCommitted } = fixture(open);
      let committed: PlayRoomView | null = null;
      const writes: ReturnType<typeof playRoundActionRequestSchema.parse>[] = [];
      vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
        if (path.endsWith('/actions')) {
          const body = playRoundActionRequestSchema.parse(JSON.parse(String(options?.body)));
          writes.push(body);
          if (writes.length === 1)
            return Response.json({ error: 'The game changed.' }, { status: 409 });
          const round = advancePlayRound(otherCommitted, 'HOST', body.command);
          committed = {
            ...fresh,
            revision: 4,
            round: { ...projectPlayRound(round, 'HOST'), id: 'round', order: 0 },
          };
          return Response.json(committed);
        }
        return Response.json(committed ?? (writes.length ? fresh : initial));
      });
      render(<PlayRoom roomId="game" />);
      await screen.findByText('Connected');
      if (open) {
        fireEvent.change(screen.getByLabelText('Your answer'), {
          target: { value: 'Die Antwort' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Lock in answer' }));
        await screen.findByText('Your locked answer');
      } else {
        fireEvent.click(screen.getByRole('button', { name: /^A/ }));
        await screen.findByText('You picked the same card!');
      }
      expect(writes.map((body) => body.expectedRevision)).toEqual([2, 3]);
      expect(writes[0].actionId).not.toBe(writes[1].actionId);
      expect(writes[1].command).toEqual(writes[0].command);
    }
  );

  it.each(['failed read', 'new round', 'changed identity', 'already committed'] as const)(
    'does not resubmit after a %s',
    async (scenario) => {
      const { initial, fresh, round } = fixture();
      let refused = false;
      const writes: unknown[] = [];
      vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
        if (path.endsWith('/actions')) {
          writes.push(JSON.parse(String(options?.body)));
          refused = true;
          return Response.json({ error: 'The game changed.' }, { status: 409 });
        }
        if (!refused) return Response.json(initial);
        if (scenario === 'failed read')
          return Response.json({ error: 'Read unavailable' }, { status: 503 });
        if (scenario === 'new round')
          return Response.json({ ...fresh, round: { ...fresh.round, id: 'next-round' } });
        if (scenario === 'changed identity') return Response.json({ ...fresh, ownSeat: 'GUEST' });
        const ownCommitted = advancePlayRound(round, 'HOST', { type: 'CHOOSE', optionId: 'A' });
        return Response.json({
          ...fresh,
          round: { ...projectPlayRound(ownCommitted, 'HOST'), id: 'round', order: 0 },
        });
      });
      render(<PlayRoom roomId="game" />);
      await screen.findByText('Connected');
      fireEvent.click(screen.getByRole('button', { name: /^A/ }));
      await screen.findAllByRole('alert');
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /Show meanings/ })).toBeEnabled()
      );
      expect(writes).toHaveLength(1);
    }
  );

  it('stops after a second conflict instead of looping through new action identifiers', async () => {
    const { initial, fresh } = fixture();
    const writes: unknown[] = [];
    vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
      if (path.endsWith('/actions')) {
        writes.push(JSON.parse(String(options?.body)));
        return Response.json({ error: 'The game changed.' }, { status: 409 });
      }
      return Response.json(writes.length ? { ...fresh, revision: 2 + writes.length } : initial);
    });
    render(<PlayRoom roomId="game" />);
    await screen.findByText('Connected');
    fireEvent.click(screen.getByRole('button', { name: /^A/ }));
    await waitFor(() => expect(writes).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole('button', { name: /^B/ })).toBeEnabled());
    expect(screen.getByRole('alert')).toHaveTextContent(/game changed/i);
  });

  it('keeps card controls locked while the refused choice is being reconciled', async () => {
    const { initial, fresh, otherCommitted } = fixture();
    const writes: ReturnType<typeof playRoundActionRequestSchema.parse>[] = [];
    let deliver: ((response: Response) => void) | undefined;
    vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
      if (path.endsWith('/actions')) {
        const body = playRoundActionRequestSchema.parse(JSON.parse(String(options?.body)));
        writes.push(body);
        if (writes.length === 1)
          return Response.json({ error: 'The game changed.' }, { status: 409 });
        return Response.json({
          ...fresh,
          revision: 4,
          round: {
            ...projectPlayRound(advancePlayRound(otherCommitted, 'HOST', body.command), 'HOST'),
            id: 'round',
            order: 0,
          },
        });
      }
      if (writes.length === 1)
        return new Promise<Response>((resolve) => {
          deliver = resolve;
        });
      return Response.json(initial);
    });
    render(<PlayRoom roomId="game" />);
    await screen.findByText('Connected');
    fireEvent.click(screen.getByRole('button', { name: /^A/ }));
    await waitFor(() => expect(deliver).toBeDefined());
    expect(screen.getByRole('button', { name: /^B/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^B/ }));
    await act(async () => {
      deliver?.(Response.json(fresh));
    });
    await screen.findByText('You picked the same card!');
    expect(writes.map((body) => body.command)).toEqual([
      { type: 'CHOOSE', optionId: 'A' },
      { type: 'CHOOSE', optionId: 'A' },
    ]);
  });
});
