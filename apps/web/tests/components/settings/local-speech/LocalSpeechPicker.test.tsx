import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  LocalSpeechPicker,
  type LocalSpeechDraft,
} from '@/components/settings/local-speech/LocalSpeechPicker';

const originalURL = URL;
let sequence = 0;
const liveUrls = new Set<string>();
const catalogue = {
  engine: 'piper',
  model: { id: 'local', label: 'Local speech' },
  voices: [
    { id: 'thorsten', name: 'Thorsten', language: 'de' },
    { id: 'kerstin', name: 'Kerstin', language: 'de' },
  ],
};
const initial = {
  endpoint: 'http://local-tts:8000',
  model: 'local',
  voices: [],
};

function Picker({ draft = initial }: { draft?: LocalSpeechDraft }) {
  const [value, setValue] = useState<LocalSpeechDraft>(draft);
  return (
    <LocalSpeechPicker
      {...value}
      onChange={(change) => setValue((current) => ({ ...current, ...change }))}
    />
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function discover() {
  await userEvent.click(screen.getByRole('button', { name: 'Find voices' }));
  await screen.findByRole('checkbox', { name: /Thorsten/ });
}

beforeEach(() => {
  liveUrls.clear();
  vi.stubGlobal(
    'URL',
    class extends originalURL {
      static createObjectURL() {
        const url = `blob:voice-${++sequence}`;
        liveUrls.add(url);
        return url;
      }
      static revokeObjectURL(url: string) {
        liveUrls.delete(url);
      }
    }
  );
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
});

describe('draft local voice picker', () => {
  it('keeps voice edits made while discovery fills an empty model', async () => {
    const pending = deferred<Response>();
    vi.stubGlobal('fetch', async () => pending.promise);
    render(<Picker draft={{ ...initial, model: '', voices: ['saved-old'] }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Find voices' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /saved-old/ }));
    await act(async () => pending.resolve(Response.json(catalogue)));
    await screen.findByRole('checkbox', { name: /Thorsten/ });
    expect(screen.queryByText('saved-old')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('Advanced settings'));
    expect(screen.getByLabelText('Local speech model ID')).toHaveValue('local');
    expect(screen.getByLabelText('Local voice IDs')).toHaveValue('');
  });

  it('shows catalogue labels and languages without selecting voices or sending settings writes', async () => {
    const requests: Array<{
      url: string;
      body: unknown;
      method: string | undefined;
    }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      requests.push({
        url,
        body: JSON.parse(String(init.body)),
        method: init.method,
      });
      return Response.json(catalogue);
    });
    render(<Picker />);
    expect(requests).toEqual([]);
    await discover();
    expect(screen.getByText(/Connected: piper/)).toBeVisible();
    expect(screen.getByRole('checkbox', { name: /Thorsten.*\(de\)/ })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: /Kerstin.*\(de\)/ })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: /Thorsten/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Kerstin/ })).not.toBeChecked();
    expect(requests).toEqual([
      {
        url: '/api/v1/settings/local-speech/discover',
        body: { endpoint: initial.endpoint },
        method: 'POST',
      },
    ]);
  });

  it('retains unavailable saved IDs and custom models until the learner removes or edits them', async () => {
    vi.stubGlobal('fetch', async () => Response.json(catalogue));
    render(<Picker draft={{ ...initial, model: 'custom-model', voices: ['saved-old'] }} />);
    await discover();
    expect(screen.getByRole('checkbox', { name: /saved-old/ })).toBeChecked();
    expect(screen.getByText(/Not listed by this server/)).toBeVisible();
    await userEvent.click(screen.getByText('Advanced settings'));
    expect(screen.getByLabelText('Local speech model ID')).toHaveValue('custom-model');
    await userEvent.click(screen.getByRole('checkbox', { name: /saved-old/ }));
    expect(screen.queryByText('saved-old')).not.toBeInTheDocument();
  });

  it('reports denied discovery without changing the saved selection or inventing a voice list', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ error: 'Forbidden' }, { status: 403 }));
    render(<Picker draft={{ ...initial, voices: ['saved-one', 'saved-two'] }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Find voices' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Forbidden/);
    expect(screen.getByRole('checkbox', { name: /saved-one/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /saved-two/ })).toBeChecked();
    expect(screen.queryByRole('button', { name: /Listen to/ })).not.toBeInTheDocument();
  });

  it('discards an old endpoint response even when its HTTP implementation ignores cancellation', async () => {
    const old = deferred<Response>();
    vi.stubGlobal('fetch', async () => old.promise);
    const { rerender } = render(<LocalSpeechPicker {...initial} onChange={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Find voices' }));
    rerender(
      <LocalSpeechPicker {...initial} endpoint="http://replacement:8000" onChange={() => {}} />
    );
    await act(async () => old.resolve(Response.json(catalogue)));
    expect(screen.queryByRole('checkbox', { name: /Thorsten/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Connected/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Find voices' })).toBeEnabled();
  });

  it('allows discovery again after leaving and returning to a pending connection', async () => {
    const old = deferred<Response>();
    vi.stubGlobal('fetch', async () => old.promise);
    const { rerender } = render(<LocalSpeechPicker {...initial} onChange={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Find voices' }));
    rerender(<LocalSpeechPicker {...initial} endpoint="http://other:8000" onChange={() => {}} />);
    rerender(<LocalSpeechPicker {...initial} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Find voices' })).toBeEnabled();
    await act(async () => old.resolve(Response.json(catalogue)));
    expect(screen.queryByText(/Connected/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Find voices' })).toBeEnabled();
  });

  it('does not restore a released audio player after returning to its former connection', async () => {
    vi.stubGlobal('fetch', async (url: string) =>
      url.endsWith('/discover')
        ? Response.json(catalogue)
        : new Response('audio', { headers: { 'Content-Type': 'audio/wav' } })
    );
    const { rerender } = render(<LocalSpeechPicker {...initial} onChange={() => {}} />);
    await discover();
    await userEvent.click(screen.getByRole('button', { name: 'Listen to Thorsten' }));
    const player = (await screen.findByLabelText('Voice preview: Thorsten')) as HTMLAudioElement;
    await waitFor(() => expect(player.paused).toBe(false));
    rerender(<LocalSpeechPicker {...initial} model="another-model" onChange={() => {}} />);
    expect(player.paused).toBe(true);
    expect(liveUrls.size).toBe(0);
    rerender(<LocalSpeechPicker {...initial} onChange={() => {}} />);
    expect(screen.queryByLabelText('Voice preview: Thorsten')).not.toBeInTheDocument();
    expect(liveUrls.size).toBe(0);
  });

  it('previews the actual voice language, keeps one native player and releases audio on replacement and unmount', async () => {
    const previews: unknown[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (url.endsWith('/discover')) return Response.json(catalogue);
      previews.push(JSON.parse(String(init.body)));
      return new Response(new Uint8Array([82, 73, 70, 70]), {
        headers: { 'Content-Type': 'audio/wav' },
      });
    });
    const { unmount } = render(<Picker />);
    await discover();
    await userEvent.click(screen.getByRole('button', { name: 'Listen to Thorsten' }));
    const first = (await screen.findByLabelText('Voice preview: Thorsten')) as HTMLAudioElement;
    await waitFor(() => expect(first.paused).toBe(false));
    expect(first.controls).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Listen to Kerstin' }));
    await screen.findByLabelText('Voice preview: Kerstin');
    expect(first.paused).toBe(true);
    expect(liveUrls.size).toBe(1);
    expect(previews).toEqual([
      {
        endpoint: initial.endpoint,
        model: 'local',
        voiceId: 'thorsten',
        language: 'de',
        text: 'Sotto. 1, 2, 3.',
      },
      {
        endpoint: initial.endpoint,
        model: 'local',
        voiceId: 'kerstin',
        language: 'de',
        text: 'Sotto. 1, 2, 3.',
      },
    ]);
    unmount();
    expect(liveUrls.size).toBe(0);
  });

  it('offers native play after browser autoplay rejection', async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(
      new DOMException('Gesture required', 'NotAllowedError')
    );
    vi.stubGlobal('fetch', async (url: string) =>
      url.endsWith('/discover')
        ? Response.json(catalogue)
        : new Response('audio', { headers: { 'Content-Type': 'audio/wav' } })
    );
    render(<Picker />);
    await discover();
    await userEvent.click(screen.getByRole('button', { name: 'Listen to Thorsten' }));
    expect(await screen.findByText(/Press play/)).toBeVisible();
    expect(screen.getByLabelText('Voice preview: Thorsten')).toHaveAttribute('controls');
  });

  it('does not expose stale preview audio after the model changes', async () => {
    const old = deferred<Response>();
    vi.stubGlobal('fetch', async (url: string) =>
      url.endsWith('/discover') ? Response.json(catalogue) : old.promise
    );
    const { rerender } = render(<LocalSpeechPicker {...initial} onChange={() => {}} />);
    await discover();
    await userEvent.click(screen.getByRole('button', { name: 'Listen to Thorsten' }));
    rerender(<LocalSpeechPicker {...initial} model="different-model" onChange={() => {}} />);
    await act(async () =>
      old.resolve(new Response('audio', { headers: { 'Content-Type': 'audio/wav' } }))
    );
    expect(screen.queryByLabelText(/Voice preview/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Listen to/ })).not.toBeInTheDocument();
    expect(liveUrls.size).toBe(0);
  });

  it('rejects a response above the preview byte limit before allocating a playback URL', async () => {
    vi.stubGlobal('fetch', async (url: string) =>
      url.endsWith('/discover')
        ? Response.json(catalogue)
        : new Response(new Uint8Array(2 * 1024 * 1024 + 1), {
            headers: { 'Content-Type': 'audio/wav' },
          })
    );
    render(<Picker />);
    await discover();
    await userEvent.click(screen.getByRole('button', { name: 'Listen to Thorsten' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/too large/);
    expect(screen.queryByLabelText(/Voice preview/)).not.toBeInTheDocument();
    expect(liveUrls.size).toBe(0);
  });

  it('caps checkbox selection at eight and allows explicit removal', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({
        ...catalogue,
        voices: Array.from({ length: 9 }, (_, i) => ({
          id: `voice-${i}`,
          name: `Voice ${i}`,
        })),
      })
    );
    render(<Picker />);
    await userEvent.click(screen.getByRole('button', { name: 'Find voices' }));
    await screen.findByRole('checkbox', { name: /Voice 0/ });
    for (let i = 0; i < 8; i++)
      await userEvent.click(screen.getByRole('checkbox', { name: new RegExp(`Voice ${i}`) }));
    expect(screen.getByRole('checkbox', { name: /Voice 8/ })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /Voice 0/ }));
    expect(screen.getByRole('checkbox', { name: /Voice 8/ })).toBeEnabled();
  });
});
