import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayProfileBoundary } from '@/components/play/client/profile';
import { PlayNotebook } from '@/components/play/PlayNotebook';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function deferredResponse() {
  let resolve: (value: Response) => void = () => {
    throw new Error('Response resolver is unavailable');
  };
  let reject: (reason: Error) => void = () => {
    throw new Error('Response rejecter is unavailable');
  };
  const promise = new Promise<Response>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function PrivateAction() {
  const [count, setCount] = useState(0);
  return (
    <>
      <p>Private game content</p>
      <button onClick={() => setCount((value) => value + 1)}>Take action</button>
      <output aria-label="completed actions">{count}</output>
    </>
  );
}

async function startWithPendingPeriodicCheck() {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const pending = deferredResponse();
  const foreground = deferredResponse();
  let requests = 0;
  vi.stubGlobal('fetch', async () => {
    requests += 1;
    if (requests === 1) return Response.json({ id: 'first' });
    return requests === 2 ? pending.promise : foreground.promise;
  });
  render(
    <PlayProfileBoundary profileId="first">
      <PrivateAction />
    </PlayProfileBoundary>
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByRole('button', { name: 'Take action' })).toBeEnabled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  return { pending, foreground };
}

describe('private Play profile lifetime', () => {
  it('allows one action while a periodic profile check is pending', async () => {
    const { pending } = await startWithPendingPeriodicCheck();
    const action = screen.getByRole('button', { name: 'Take action' });
    expect(action).toBeEnabled();
    fireEvent.click(action);
    expect(screen.getByLabelText('completed actions')).toHaveTextContent('1');
    await act(async () => pending.resolve(Response.json({ id: 'first' })));
  });

  it('removes private content when a pending periodic check finds another profile', async () => {
    const { pending } = await startWithPendingPeriodicCheck();
    await act(async () => pending.resolve(Response.json({ id: 'second' })));
    expect(screen.getByRole('alert')).toHaveTextContent(/active profile changed/);
    expect(screen.queryByText('Private game content')).not.toBeInTheDocument();
  });

  it('disables the private view if a periodic profile check fails', async () => {
    const { pending } = await startWithPendingPeriodicCheck();
    await act(async () => pending.reject(new Error('Profile check failed')));
    expect(screen.getByRole('alert')).toHaveTextContent('Profile check failed');
    expect(screen.getByRole('button', { name: 'Take action' })).toBeDisabled();
  });

  it('keeps content hidden until a foreground check supersedes a pending periodic check', async () => {
    const { pending, foreground } = await startWithPendingPeriodicCheck();
    act(() => window.dispatchEvent(new Event('focus')));
    expect(screen.queryByText('Private game content')).not.toBeVisible();
    await act(async () => pending.resolve(Response.json({ id: 'first' })));
    expect(screen.queryByText('Private game content')).not.toBeVisible();
    await act(async () => foreground.resolve(Response.json({ id: 'first' })));
    expect(screen.getByText('Private game content')).toBeVisible();
  });

  it('clears notebook and course caches on a foreground profile change and sends the original profile assertion', async () => {
    let current = 'first';
    const assertions: (string | null)[] = [];
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
      if (path === '/api/v1/users/me') return Response.json({ id: current });
      assertions.push(new Headers(options?.headers).get('X-Sotto-Play-Profile'));
      return Response.json({
        phrases: [
          {
            id: 'private',
            roomId: 'game',
            roundId: 'round',
            kind: 'WORD',
            text: 'Apfel',
            contextText: null,
            targetLang: 'de',
            createdAt: new Date().toISOString(),
          },
        ],
        nextCursor: null,
      });
    });
    render(
      <PlayProfileBoundary profileId="first">
        <PlayNotebook />
      </PlayProfileBoundary>
    );
    await screen.findByText('Apfel');
    expect(assertions).toEqual(['first']);
    current = 'second';
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/active profile changed/)
    );
    expect(screen.queryByText('Apfel')).not.toBeInTheDocument();
    expect(screen.queryByText('Add to study')).not.toBeInTheDocument();
    current = 'first';
    fireEvent.click(screen.getByRole('button', { name: 'Use current profile' }));
    expect(await screen.findByText('Apfel')).toBeInTheDocument();
  });

  it('keeps an ordinary notebook authorization error local when the active profile is unchanged', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.stubGlobal('fetch', async (path: string) =>
      path === '/api/v1/users/me'
        ? Response.json({ id: 'first' })
        : Response.json({ error: 'Notebook unavailable' }, { status: 403 })
    );
    render(
      <PlayProfileBoundary profileId="first">
        <PlayNotebook />
      </PlayProfileBoundary>
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Notebook unavailable');
    expect(screen.getByRole('button', { name: 'Refresh notebook' })).toBeInTheDocument();
    expect(screen.queryByText('Your active profile changed.')).not.toBeInTheDocument();
  });
});
