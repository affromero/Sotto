import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocalSpeechSettings } from '@/components/settings/LocalSpeechSettings';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const props = {
  initialEndpoint: 'http://local-tts:8090',
  initialModel: 'piper',
  initialVoices: ['de_DE-thorsten-high', 'de_DE-eva_k-x_low'],
  initialMode: 'configured' as const,
  configuredProviderLabel: 'Cartesia',
  configuredModelLabel: 'Sonic 3.5',
  selectedProviderLabel: 'Cartesia',
  initialUsesConfiguredProvider: true,
  canManageSharedSpeech: true,
};
const creditStatus = (blocked = false, provider = 'cartesia', providerLabel = 'Cartesia') =>
  Response.json({
    provider,
    providerLabel,
    creditsBlocked: blocked,
    canCheckCredits: true,
  });

describe('explicit local speech settings', () => {
  it('shows a personal cloud provider and allows an explicit return to the actual server default', async () => {
    const posted: unknown[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      if (init.method !== 'PATCH') return creditStatus(false, 'openai', 'OpenAI');
      posted.push(JSON.parse(String(init.body)));
      return Response.json({ mode: 'configured' });
    });
    render(
      <LocalSpeechSettings
        {...props}
        selectedProviderLabel="OpenAI"
        initialUsesConfiguredProvider={false}
      />
    );
    expect(screen.getByText('Selected speech: OpenAI.')).toBeVisible();
    const useDefault = screen.getByRole('button', { name: 'Use Cartesia default (Sonic 3.5)' });
    expect(useDefault).toBeEnabled();
    await userEvent.click(useDefault);
    await screen.findByText('Configured speech: Cartesia.');
    expect(posted).toEqual([{ mode: 'configured' }]);
    expect(useDefault).toBeDisabled();
  });
  it('shows the missing server provider and cannot activate an invented default', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({
        provider: null,
        providerLabel: 'No speech provider selected',
        creditsBlocked: null,
        canCheckCredits: false,
      })
    );
    render(
      <LocalSpeechSettings
        {...props}
        configuredProviderLabel={null}
        configuredModelLabel={null}
        selectedProviderLabel={null}
      />
    );
    expect(screen.getByText('No speech provider selected.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'No configured speech provider' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Disable audio' })).toBeEnabled();
  });
  it('lets a learner disable audio while hiding owner configuration and paid checks', async () => {
    const posted: unknown[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      if (init.method !== 'PATCH') return creditStatus();
      posted.push(JSON.parse(String(init.body)));
      return Response.json({ mode: 'disabled' });
    });
    render(<LocalSpeechSettings {...props} canManageSharedSpeech={false} />);
    expect(screen.queryByLabelText('Speech endpoint URL')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use local speech' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Check Cartesia credits' })
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Disable audio' }));
    await screen.findByText('Audio disabled for your profile.');
    expect(posted).toEqual([{ mode: 'disabled' }]);
  });
  it('does not activate speech on render and saves only after the learner selects local speech', async () => {
    const requests: unknown[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      expect(url).toBe('/api/v1/settings/local-speech');
      if (init.method !== 'PATCH') return creditStatus();
      requests.push(JSON.parse(String(init.body)));
      return Response.json({
        mode: 'local',
        preferredTtsProvider: 'local',
        preferredTtsModel: 'piper',
      });
    });
    render(<LocalSpeechSettings {...props} />);
    expect(requests).toEqual([]);
    expect(screen.getByRole('button', { name: 'Use Cartesia default (Sonic 3.5)' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Use local speech' }));
    await screen.findByText('Local speech selected for your profile.');
    expect(requests).toEqual([
      {
        mode: 'local',
        endpoint: props.initialEndpoint,
        model: 'piper',
        voices: props.initialVoices,
      },
    ]);
    expect(screen.getByText('Local speech is selected.')).toBeVisible();
  });

  it('returns to the displayed configured provider default without submitting the stale local model', async () => {
    const requests: unknown[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      if (init.method !== 'PATCH') return creditStatus();
      requests.push(JSON.parse(String(init.body)));
      return Response.json({
        mode: 'configured',
        preferredTtsProvider: null,
        preferredTtsModel: null,
      });
    });
    render(<LocalSpeechSettings {...props} initialMode="local" />);
    await userEvent.click(screen.getByRole('button', { name: 'Use Cartesia default (Sonic 3.5)' }));
    await screen.findByText('Cartesia selected with its configured default model.');
    expect(requests).toEqual([{ mode: 'configured' }]);
    expect(screen.getByText('Configured speech: Cartesia.')).toBeVisible();
  });

  it('rejects invalid endpoints and duplicate voices before saving', async () => {
    const submitted: unknown[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      if (init.method !== 'PATCH') return creditStatus();
      submitted.push(init.body);
      return Response.json({});
    });
    const user = userEvent.setup();
    render(<LocalSpeechSettings {...props} initialEndpoint="http://secret@local-tts:8090" />);
    await user.click(screen.getByRole('button', { name: 'Use local speech' }));
    await screen.findByRole('alert');
    expect(submitted).toEqual([]);
    await user.clear(screen.getByLabelText('Speech endpoint URL'));
    await user.type(screen.getByLabelText('Speech endpoint URL'), props.initialEndpoint);
    await user.clear(screen.getByLabelText('Local voice IDs'));
    await user.type(screen.getByLabelText('Local voice IDs'), 'voice-a, voice-a');
    await user.click(screen.getByRole('button', { name: 'Use local speech' }));
    expect(screen.getByRole('alert')).toBeVisible();
    expect(submitted).toEqual([]);
  });

  it('shows a rejected save and retains the existing provider selection', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ error: 'Forbidden' }, { status: 403 }));
    render(<LocalSpeechSettings {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Use local speech' }));
    await screen.findByRole('alert');
    expect(screen.getByText('Configured speech: Cartesia.')).toBeVisible();
    expect(screen.queryByText('Local speech is selected.')).not.toBeInTheDocument();
  });

  it('disables audio only on selection and offers an explicit configured-provider return', async () => {
    const requests: unknown[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      if (init.method !== 'PATCH') return creditStatus();
      requests.push(JSON.parse(String(init.body)));
      return Response.json({
        mode: 'disabled',
        preferredTtsProvider: 'disabled',
        preferredTtsModel: null,
      });
    });
    render(<LocalSpeechSettings {...props} initialMode="local" />);
    await userEvent.click(screen.getByRole('button', { name: 'Disable audio' }));
    await screen.findByText('Audio disabled for your profile.');
    expect(requests).toEqual([{ mode: 'disabled' }]);
    expect(
      screen.getByText(
        'Audio disabled. Text learning continues; listening and speaking are skipped.'
      )
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Turn on Cartesia default (Sonic 3.5)' })
    ).toBeEnabled();
  });

  it('shows the selected provider credit block and checks that provider only after an explicit click', async () => {
    const posted: unknown[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      if (init.method !== 'PATCH') return creditStatus(true, 'openai', 'OpenAI');
      posted.push(JSON.parse(String(init.body)));
      return Response.json({ creditsBlocked: false });
    });
    render(<LocalSpeechSettings {...props} configuredProviderLabel="OpenAI" />);
    await screen.findByText(/OpenAI credits are exhausted/);
    expect(posted).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Check OpenAI credits' }));
    await screen.findByText(
      'OpenAI speech checked successfully. Your speech selection has not changed.'
    );
    expect(posted).toEqual([{ mode: 'check-credits', expectedProvider: 'openai' }]);
    expect(screen.getByText('Configured speech: OpenAI.')).toBeVisible();
    expect(screen.queryByText(/OpenAI credits are exhausted/)).not.toBeInTheDocument();
  });

  it('retains the credits warning after a rejected credit check', async () => {
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) =>
      init.method === 'PATCH'
        ? Response.json({ error: 'Exhausted' }, { status: 402 })
        : creditStatus(true)
    );
    render(<LocalSpeechSettings {...props} />);
    await screen.findByText(/Cartesia credits are exhausted/);
    await userEvent.click(screen.getByRole('button', { name: 'Check Cartesia credits' }));
    await screen.findByText(/Cartesia credits are still exhausted/);
    expect(screen.getByText('Configured speech: Cartesia.')).toBeVisible();
  });
  it('keeps an unsupported provider blocked without promising an unavailable credit check', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({
        provider: 'fal',
        providerLabel: 'Fal',
        creditsBlocked: true,
        canCheckCredits: false,
      })
    );
    render(
      <LocalSpeechSettings
        {...props}
        selectedProviderLabel="Fal"
        initialUsesConfiguredProvider={false}
      />
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This provider does not support a credit check in Settings.'
    );
    expect(screen.queryByRole('button', { name: /Check .* credits/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disable audio' })).toBeEnabled();
  });
  it('does not offer a paid check for an explicitly selected keyless local provider', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({
        provider: 'local',
        providerLabel: 'Local TTS sidecar',
        creditsBlocked: null,
        status: null,
        canCheckCredits: false,
      })
    );
    render(<LocalSpeechSettings {...props} initialMode="local" />);
    await screen.findByText('Local speech is selected.');
    expect(screen.queryByRole('button', { name: /Check .* credits/ })).not.toBeInTheDocument();
  });
});
