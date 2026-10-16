import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LessonAudioPlayer } from '@/components/learn/audio/LessonAudioPlayer';

const episode = {
  id: 'lesson',
  title: 'Yesterday',
  status: 'READY',
  audioUrl: '/initial.mp3',
  references: [],
};
const detail = {
  ...episode,
  audioUrl: '/signed-full.mp3',
  language: 'de',
  duration: 170,
  segments: [
    {
      id: 'three',
      order: 3,
      speaker: 'Anna',
      text: 'Dann bin ich nach Hause gegangen.',
      audioUrl: '/three.mp3',
      startTime: null,
      duration: null,
    },
    {
      id: 'one',
      order: 1,
      speaker: 'Anna',
      text: 'Gestern habe ich einen Film gesehen.',
      audioUrl: '/one.mp3',
      startTime: null,
      duration: null,
    },
    {
      id: 'two',
      order: 2,
      speaker: 'Ben',
      text: 'Wie war der Film?',
      audioUrl: '/two.mp3',
      startTime: 40,
      duration: 12,
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => detail }));
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
    this: HTMLMediaElement
  ) {
    Object.defineProperty(this, 'paused', { configurable: true, value: false });
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
    this: HTMLMediaElement
  ) {
    Object.defineProperty(this, 'paused', { configurable: true, value: true });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function openTurns() {
  const summary = await screen.findByText('Replay turns and speakers (3 turns)');
  fireEvent.click(summary);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Play turn 1: Anna' })).toBeVisible()
  );
}

describe('lesson audio playback', () => {
  it('removes loaded turns and pauses the previous speaker when switching lessons', async () => {
    const view = render(<LessonAudioPlayer episode={episode} />);
    await openTurns();
    fireEvent.change(screen.getByRole('combobox', { name: 'Speaker' }), {
      target: { value: 'Anna' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Play this speaker' }));
    const retired = screen.getByLabelText('Turn 1 audio') as HTMLAudioElement;
    const next = Promise.withResolvers<Response>();
    vi.mocked(fetch).mockReturnValueOnce(next.promise);
    view.rerender(
      <LessonAudioPlayer
        episode={{ ...episode, id: 'different-lesson', audioUrl: '/different.mp3' }}
      />
    );
    expect(retired.paused).toBe(true);
    expect(screen.getByLabelText('Lesson audio')).toHaveAttribute('src', '/different.mp3');
    expect(screen.queryByText(/Replay turns and speakers/)).not.toBeInTheDocument();
    await act(async () => {
      next.resolve({ ok: false, status: 403 } as Response);
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load lesson audio');
    expect(screen.getByLabelText('Lesson audio')).toHaveAttribute('src', '/different.mp3');
  });

  it('discards old lesson state and late responses when the episode changes', async () => {
    const oldRequest = Promise.withResolvers<Response>();
    let oldSignal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementationOnce((_url, options) => {
      oldSignal = options?.signal ?? undefined;
      return oldRequest.promise;
    });
    const view = render(<LessonAudioPlayer episode={episode} />);
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 404 } as Response);
    view.rerender(
      <LessonAudioPlayer episode={{ ...episode, id: 'new-lesson', audioUrl: '/new.mp3' }} />
    );
    expect(oldSignal?.aborted).toBe(true);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load lesson audio');
    await act(async () => {
      oldRequest.resolve({ ok: true, json: async () => detail } as Response);
    });
    expect(screen.getByLabelText('Lesson audio')).toHaveAttribute('src', '/new.mp3');
    expect(screen.queryByText(/Replay turns and speakers/)).not.toBeInTheDocument();
  });

  it('ignores a retired audio element ending after a new speaker queue starts', async () => {
    render(<LessonAudioPlayer episode={episode} />);
    await openTurns();
    fireEvent.click(screen.getByRole('button', { name: 'Play turn 2: Ben' }));
    const old = screen.getByLabelText('Turn 2 audio') as HTMLAudioElement;
    fireEvent.change(screen.getByRole('combobox', { name: 'Speaker' }), {
      target: { value: 'Anna' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Play this speaker' }));
    expect(old.paused).toBe(true);
    fireEvent.ended(old);
    expect(screen.getByLabelText('Turn 1 audio')).toHaveAttribute('src', '/one.mp3');
    expect(screen.getByRole('status')).toHaveTextContent('1 of 2 selected turns');
  });

  it('supports native seeking, bounded skips and speed changes without restarting the lesson', async () => {
    render(<LessonAudioPlayer episode={episode} />);
    await openTurns();
    const audio = screen.getByLabelText('Lesson audio') as HTMLAudioElement;
    expect(audio).toHaveAttribute('controls');
    expect(audio).toHaveAttribute('src', '/signed-full.mp3');
    Object.defineProperty(audio, 'duration', { configurable: true, value: 170 });
    audio.currentTime = 5;
    fireEvent.click(screen.getByRole('button', { name: 'Back 10 seconds' }));
    expect(audio.currentTime).toBe(0);
    audio.currentTime = 165;
    fireEvent.click(screen.getByRole('button', { name: 'Forward 10 seconds' }));
    expect(audio.currentTime).toBe(170);
    audio.currentTime = 37;
    fireEvent.change(screen.getByRole('combobox', { name: 'Playback speed' }), {
      target: { value: '0.75' },
    });
    expect(audio.playbackRate).toBe(0.75);
    expect(audio.currentTime).toBe(37);
  });

  it('replays one exact turn without timestamps, stops there and returns to the full lesson', async () => {
    render(<LessonAudioPlayer episode={episode} />);
    await openTurns();
    fireEvent.change(screen.getByRole('combobox', { name: 'Playback speed' }), {
      target: { value: '0.75' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Play turn 1: Anna' }));
    const audio = screen.getByLabelText('Turn 1 audio') as HTMLAudioElement;
    expect(audio).toHaveAttribute('src', '/one.mp3');
    expect(audio.paused).toBe(false);
    expect(audio.playbackRate).toBe(0.75);
    audio.currentTime = 9;
    fireEvent.click(screen.getByRole('button', { name: 'Play turn 1: Anna' }));
    const replay = screen.getByLabelText('Turn 1 audio') as HTMLAudioElement;
    expect(audio.paused).toBe(true);
    expect(replay.currentTime).toBe(0);
    fireEvent.ended(replay);
    expect(replay).toHaveAttribute('src', '/one.mp3');
    expect(screen.queryByLabelText('Turn 2 audio')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Play full lesson' }));
    expect(screen.getByLabelText('Lesson audio')).toHaveAttribute('src', '/signed-full.mp3');
    expect((screen.getByLabelText('Lesson audio') as HTMLAudioElement).paused).toBe(false);
  });

  it('plays only the selected speaker in script order and pauses on unmount', async () => {
    const view = render(<LessonAudioPlayer episode={episode} />);
    await openTurns();
    fireEvent.change(screen.getByRole('combobox', { name: 'Speaker' }), {
      target: { value: 'Anna' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Play this speaker' }));
    const audio = screen.getByLabelText('Turn 1 audio') as HTMLAudioElement;
    expect(audio).toHaveAttribute('src', '/one.mp3');
    fireEvent.ended(audio);
    const last = screen.getByLabelText('Turn 3 audio') as HTMLAudioElement;
    expect(last).toHaveAttribute('src', '/three.mp3');
    expect(screen.getByRole('status')).toHaveTextContent('2 of 2 selected turns');
    fireEvent.ended(last);
    expect(last).toHaveAttribute('src', '/three.mp3');
    view.unmount();
    expect(last.paused).toBe(true);
  });

  it('surfaces playback rejection and reloads authorized audio URLs without resuming old clips', async () => {
    render(<LessonAudioPlayer episode={episode} />);
    await openTurns();
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(
      new DOMException('Blocked', 'NotAllowedError')
    );
    fireEvent.click(screen.getByRole('button', { name: 'Play turn 2: Ben' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Playback could not start');
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...detail, audioUrl: '/renewed.mp3' }),
    } as Response);
    fireEvent.click(screen.getByRole('button', { name: 'Reload audio links' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Lesson audio')).toHaveAttribute('src', '/renewed.mp3')
    );
    expect((screen.getByLabelText('Lesson audio') as HTMLAudioElement).paused).toBe(true);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a failed request and recovers through an explicit reload', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 403 } as Response);
    render(<LessonAudioPlayer episode={episode} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load lesson audio and turns'
    );
    expect(screen.queryByText(/Replay turns and speakers/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reload audio links' }));
    await openTurns();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('rejects a different episode response and aborts an unfinished request when leaving', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...detail, id: 'another-learner-episode' }),
    } as Response);
    const first = render(<LessonAudioPlayer episode={episode} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not read lesson audio and turns'
    );
    expect(screen.queryByText(/Replay turns and speakers/)).not.toBeInTheDocument();
    first.unmount();
    let signal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementationOnce((_url, options) => {
      signal = options?.signal ?? undefined;
      return new Promise(() => {});
    });
    const second = render(<LessonAudioPlayer episode={episode} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading audio turns');
    second.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('refreshes pending generation and distinguishes a terminal failure', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...detail, status: 'GENERATING_AUDIO', audioUrl: null, segments: [] }),
    } as Response);
    render(
      <LessonAudioPlayer episode={{ ...episode, status: 'GENERATING_AUDIO', audioUrl: null }} />
    );
    await act(async () => {});
    expect(screen.getByRole('status')).toHaveTextContent('Listening audio is generating');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByLabelText('Lesson audio')).toHaveAttribute('src', '/signed-full.mp3');
    cleanup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...detail, status: 'FAILED', audioUrl: null, segments: [] }),
    } as Response);
    render(<LessonAudioPlayer episode={{ ...episode, status: 'FAILED', audioUrl: null }} />);
    await act(async () => {});
    expect(screen.getByRole('alert')).toHaveTextContent('Listening audio is unavailable');
    expect(screen.queryByText(/audio is generating/)).not.toBeInTheDocument();
  });

  it('keeps unavailable turn audio explicit and never substitutes another speaker', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...detail,
        segments: detail.segments.map((turn) =>
          turn.id === 'two' ? { ...turn, audioUrl: null } : turn
        ),
      }),
    } as Response);
    render(<LessonAudioPlayer episode={episode} />);
    await openTurns();
    expect(screen.getByRole('button', { name: 'Play turn 2: Ben' })).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Speaker' }), {
      target: { value: 'Ben' },
    });
    expect(screen.getByRole('button', { name: 'Play this speaker' })).toBeDisabled();
    expect(screen.getByText(/Speaker playback includes available turns/)).toBeVisible();
    expect(screen.getByLabelText('Lesson audio')).toHaveAttribute('src', '/signed-full.mp3');
  });
});
