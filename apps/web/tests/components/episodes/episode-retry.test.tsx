// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EpisodeDetail } from '@/types/episode';

const boundary = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), status: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => boundary }));
vi.mock('@/lib/hooks/useEpisodeStatus', () => ({ useEpisodeStatus: boundary.status }));
vi.mock('@/components/providers/AudioPlayerProvider', () => ({
  usePlayer: () => ({ currentTime: 0, duration: 0, seek: vi.fn() }),
}));
vi.mock('@/components/ui/VisibilityToggle', () => ({ VisibilityToggle: () => null }));
vi.mock('@/components/ui/MetadataBadges', () => ({ MetadataBadges: () => null }));

import { EpisodePlayerView } from '@/app/episode/[episodeId]/EpisodePlayerView';
import { RetryButton } from '@/app/(admin)/admin/episodes/RetryButton';

describe('unconfirmed episode retry delivery', () => {
  const message =
    'Audio generation was admitted, but delivery could not be confirmed. Check its status before retrying.';
  const episode = {
    id: 'episode',
    title: 'Lesson',
    topic: '',
    status: 'FAILED',
    visibility: 'PRIVATE',
    audioUrl: null,
    duration: null,
    createdAt: '2026-01-01T00:00:00Z',
    source: 'CLASS',
    user: { id: 'user', name: 'Learner', image: null },
    tags: [],
    failureReason: 'Failed',
    failedAtStatus: null,
    currentVersion: 1,
    versions: [],
    segments: [],
    interactions: [],
    references: [],
    pdfUrl: null,
    isSaved: false,
  } as EpisodeDetail;
  beforeEach(() => {
    boundary.refresh.mockClear();
    boundary.status.mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: message, deliveryPending: true }),
      })
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('stops the player spinner and prevents another retry while delivery is unresolved', async () => {
    render(<EpisodePlayerView episode={episode} isOwner isAuthenticated />);
    fireEvent.click(screen.getByRole('button', { name: /retry generation/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: /retry generation/i })).toBeDisabled();
    expect(boundary.refresh).toHaveBeenCalled();
    expect(boundary.status).toHaveBeenLastCalledWith(
      expect.objectContaining({ episodeId: 'episode', initialStatus: undefined })
    );
    const monitor = boundary.status.mock.lastCall![0];
    act(() => monitor.onStatusChange({ status: 'FAILED', failureReason: 'Audio failed.' }));
    expect(screen.getByRole('button', { name: /retry generation/i })).toBeEnabled();
  });

  it.each(['FAILED', 'READY', 'SCRIPT_READY', 'DRAFT'])(
    'warns the admin and clears pending when status becomes %s',
    async (status) => {
      const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
      render(<RetryButton episodeId="episode" />);
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await waitFor(() => expect(alert).toHaveBeenCalledWith(message));
      expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
      expect(boundary.refresh).toHaveBeenCalled();
      const monitor = boundary.status.mock.lastCall![0];
      act(() => monitor.onStatusChange({ status }));
      expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    }
  );

  it('keeps retry disabled when a network error leaves admission unknown', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Connection lost'));
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    render(<RetryButton episodeId="episode" />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        'The retry could not be confirmed. Reload the page to check its status.'
      )
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
    expect(boundary.status).toHaveBeenLastCalledWith(expect.objectContaining({ episodeId: null }));
  });

  it('keeps the player retry disabled when admission is unknown', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Connection lost'));
    render(<EpisodePlayerView episode={episode} isOwner isAuthenticated />);
    fireEvent.click(screen.getByRole('button', { name: /retry generation/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The retry could not be confirmed. Reload the page to check its status.'
    );
    expect(screen.getByRole('button', { name: /retry generation/i })).toBeDisabled();
    expect(boundary.status).toHaveBeenLastCalledWith(expect.objectContaining({ episodeId: null }));
  });
});
