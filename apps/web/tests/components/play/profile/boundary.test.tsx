import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayProfileBoundary } from '@/components/play/client/profile';
import { PlayNotebook } from '@/components/play/PlayNotebook';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('private Play profile lifetime', () => {
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
