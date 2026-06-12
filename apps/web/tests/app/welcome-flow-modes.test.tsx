/**
 * Welcome flow mode split. SELF_HOSTED=true is real setup; SELF_HOSTED=false is
 * a public mock walkthrough that must not ask for keys, create profiles, or
 * route visitors into the authenticated learning app.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ImgHTMLAttributes } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WelcomeFlow } from '@/app/welcome/WelcomeFlow';
import type { AgentState } from '@/app/welcome/WelcomeFlow';
import { StepAgent } from '@/app/welcome/steps/StepAgent';
import { StepPlacement } from '@/app/welcome/steps/StepPlacement';
import { StepReady } from '@/app/welcome/steps/StepReady';
import { StepVoice } from '@/app/welcome/steps/StepVoice';
import { COMPOSE_LOG, MODULES } from '@/app/welcome/data';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('next/image', () => ({
  default: ({
    alt = '',
    priority: _priority,
    unoptimized: _unoptimized,
    ...props
  }: ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean; unoptimized?: boolean }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} {...props} />
  ),
}));

function mockConfigFetch(selfHosted: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ selfHosted, isOwner: false }),
    })
  );
}

function createMemoryStorage(): Storage {
  const entries = new Map<string, string>();

  return {
    get length() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
    getItem(key: string) {
      return entries.get(key) ?? null;
    },
    key(index: number) {
      return [...entries.keys()][index] ?? null;
    },
    removeItem(key: string) {
      entries.delete(key);
    },
    setItem(key: string, value: string) {
      entries.set(key, value);
    },
  };
}

describe('welcome hosted-demo mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
    });
    vi.stubGlobal('fetch', vi.fn());
    window.localStorage.clear();
    window.history.pushState({}, '', '/welcome');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    window.history.pushState({}, '', '/welcome');
  });

  it('keeps placement inside the welcome flow instead of linking to /learn', () => {
    render(
      <StepPlacement
        baseLang="es"
        language="en"
        understood={new Set()}
        toggleUnderstood={vi.fn()}
        level={null}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />
    );

    expect(
      screen.queryByRole('link', { name: /take the full placement test/i })
    ).not.toBeInTheDocument();
    expect(screen.getByText('Me llamo Luca.')).toBeInTheDocument();
  });

  it('shows the design agent choices without the removed Gemini card', () => {
    render(
      <StepAgent
        agent={{ provider: '', method: null, value: '', model: '', status: 'idle' }}
        demoMode={false}
        setAgent={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /Claude/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Codex/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Local/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Custom/i })).toBeInTheDocument();
    expect(screen.queryByText('Gemini')).not.toBeInTheDocument();
  });

  it('keeps welcome course copy away from podcast and video framing', () => {
    const copy = [
      ...COMPOSE_LOG.map((line) => line.text),
      ...MODULES.flatMap((module) => [module.name, module.meta]),
    ].join(' ');

    expect(copy).not.toMatch(/\b(podcast|episode|ep\.|video)\b/i);
    expect(copy).toMatch(/course|lesson/i);
  });

  it('keeps local endpoint setup to the design URL field only', () => {
    render(
      <StepAgent
        agent={{
          provider: 'local',
          method: 'url',
          value: 'http://localhost:11434',
          model: 'qwen3',
          status: 'idle',
        }}
        demoMode={false}
        setAgent={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />
    );

    expect(screen.getByLabelText(/endpoint URL/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/local model name/i)).not.toBeInTheDocument();
  });

  it('simulates every agent connection in hosted demo without key or endpoint prompts', async () => {
    const user = userEvent.setup();
    let agent: AgentState = { provider: '', method: null, value: '', model: '', status: 'idle' };
    const setAgent = vi.fn((updater: (prev: AgentState) => AgentState) => {
      agent = updater(agent);
    });
    const { rerender } = render(
      <StepAgent agent={agent} demoMode setAgent={setAgent} onNext={vi.fn()} onBack={vi.fn()} />
    );

    await user.click(screen.getByRole('button', { name: /Local/i }));

    rerender(
      <StepAgent agent={agent} demoMode setAgent={setAgent} onNext={vi.fn()} onBack={vi.fn()} />
    );

    expect(screen.getByText(/Local preview connected/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue/i })).toBeEnabled();
    expect(screen.queryByLabelText(/endpoint URL/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/API key/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Link$/i })).not.toBeInTheDocument();
  });

  it('previews voice providers in demo mode without asking for API keys', () => {
    render(
      <StepVoice
        voice={{ tts: 'elevenlabs', stt: 'deepgram', keys: {}, baseUrls: {} }}
        demoMode
        setVoice={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />
    );

    expect(screen.getAllByText(/no key or local endpoint is requested or saved/i)).toHaveLength(2);
    expect(screen.queryByLabelText(/ElevenLabs API key/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Deepgram API key/i)).not.toBeInTheDocument();
  });

  it('finishes the hosted demo without saving or navigating into the app', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    const onJump = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <StepReady
        baseLang="en"
        language="it"
        level="A2"
        sources={new Set(['reading'])}
        agent={{ provider: 'claude', method: 'cli', value: '', model: '', status: 'connected' }}
        voice={{ tts: 'elevenlabs', stt: 'whisper', keys: {}, baseUrls: {} }}
        config={{ selfHosted: false, isOwner: false }}
        onRestart={vi.fn()}
        onJump={onJump}
      />
    );

    await user.click(screen.getByTitle('Change language'));
    expect(onJump).toHaveBeenCalledWith(0);

    await user.click(screen.getByRole('button', { name: /finish demo/i }));

    expect(
      await screen.findByText(/hosted demo complete.*no profile was created/i)
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('finishes self-host setup by saving the course and entering /learn', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ demo: false, courseId: 'course_1' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <StepReady
        baseLang="en"
        language="it"
        level="A2"
        sources={new Set(['reading', 'repos'])}
        agent={{ provider: 'claude', method: 'cli', value: '', model: '', status: 'connected' }}
        voice={{ tts: 'elevenlabs', stt: 'whisper', keys: {}, baseUrls: {} }}
        config={{ selfHosted: true, isOwner: false }}
        onRestart={vi.fn()}
        onJump={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /open today's session/i }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/onboarding/save',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      course: { native: 'en', target: 'it', level: 'A2' },
      preferred: { language: 'it' },
    });
    expect(mockPush).toHaveBeenCalledWith('/learn');
  });

  it('supports design step deep-links without persisting hosted-demo state', async () => {
    mockConfigFetch(false);
    window.history.pushState({}, '', '/welcome?step=4&lang=es');

    render(<WelcomeFlow initialConfig={{ selfHosted: false, isOwner: false }} />);

    expect(await screen.findByText(/Where do you/i)).toBeInTheDocument();
    expect(screen.getByText(/Estimated level/i).textContent).toContain('B1');
    expect(window.localStorage.getItem('sotto.onboarding.v1')).toBeNull();
  });

  it('does not persist hosted-demo progress while visitors move through welcome', async () => {
    const user = userEvent.setup();
    mockConfigFetch(false);

    render(<WelcomeFlow initialConfig={{ selfHosted: false, isOwner: false }} />);

    await user.click(screen.getByRole('button', { name: /Learn Italian/i }));
    await user.keyboard('{Enter}');

    expect(await screen.findByText(/Connect the agent/i)).toBeInTheDocument();
    expect(window.localStorage.getItem('sotto.onboarding.v1')).toBeNull();
  });

  it('keeps self-host welcome progress resumable and keyboard navigable', async () => {
    const user = userEvent.setup();
    mockConfigFetch(true);

    render(<WelcomeFlow initialConfig={{ selfHosted: true, isOwner: false }} />);

    await user.click(screen.getByRole('button', { name: /Learn Italian/i }));
    await user.keyboard('{Enter}');

    expect(await screen.findByText(/Connect the agent/i)).toBeInTheDocument();

    await waitFor(() => {
      const raw = window.localStorage.getItem('sotto.onboarding.v1');
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw ?? '{}')).toMatchObject({ step: 1, language: 'it' });
    });
  });
});
