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
import type { AgentState, ContextItem, VoiceState } from '@/app/welcome/WelcomeFlow';
import { StepAgent } from '@/app/welcome/steps/StepAgent';
import { StepContext } from '@/app/welcome/steps/StepContext';
import { StepContextReview } from '@/app/welcome/steps/StepContextReview';
import { StepLearnerProfile } from '@/app/welcome/steps/StepLearnerProfile';
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

type _WelcomeFlowTypes = [AgentState, ContextItem, VoiceState];
const _useWelcomeFlowTypes = (_value: _WelcomeFlowTypes) => undefined;
void _useWelcomeFlowTypes;
void StepAgent;
void StepContext;
void StepContextReview;
void StepLearnerProfile;
void StepPlacement;
void StepVoice;
void COMPOSE_LOG;
void MODULES;

describe('welcome hosted-demo mode', () => {
  it('saves the admin learner profile before continuing self-host onboarding', async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <StepLearnerProfile
        name="Andres"
        avatarSlug="capybara"
        timezone="America/Bogota"
        demoMode={false}
        setName={vi.fn()}
        setAvatarSlug={vi.fn()}
        setTimezone={vi.fn()}
        onNext={onNext}
        onBack={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /continue with admin profile/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/onboarding/name',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Andres',
          avatarSlug: 'capybara',
          timezone: 'America/Bogota',
        }),
      })
    );
    expect(onNext).toHaveBeenCalled();
  });

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

  it('saves an optional Google live conversation key during self-host setup', async () => {
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
        sources={new Set(['reading'])}
        contextItems={[]}
        agent={{
          provider: 'claude',
          method: 'cli',
          value: '',
          model: '',
          liveTranslationKey: 'AIza-live',
          status: 'connected',
        }}
        voice={{
          tts: 'elevenlabs',
          stt: 'whisper',
          visualCueProvider: 'pexels',
          keys: {},
          baseUrls: {},
          ttsModel: {},
          sttModel: {},
        }}
        config={{ selfHosted: true, isOwner: false }}
        onRestart={vi.fn()}
        onJump={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /open today's session/i }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/settings/ai-keys',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'google', apiKey: 'AIza-live' }),
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/onboarding/save',
      expect.objectContaining({ method: 'POST', credentials: 'include' })
    );
    expect(mockPush).toHaveBeenCalledWith('/learn');
  });

  it('saves an optional visual cue provider key during self-host setup', async () => {
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
        sources={new Set(['reading'])}
        contextItems={[]}
        agent={{ provider: 'claude', method: 'cli', value: '', model: '', status: 'connected' }}
        voice={{
          tts: 'elevenlabs',
          stt: 'whisper',
          visualCueProvider: 'pexels',
          keys: { 'visual:pexels': 'pexels_key_123' },
          baseUrls: {},
          ttsModel: {},
          sttModel: {},
        }}
        config={{ selfHosted: true, isOwner: false }}
        onRestart={vi.fn()}
        onJump={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /open today's session/i }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/settings/visual-cues',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'pexels', apiKey: 'pexels_key_123' }),
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/onboarding/save',
      expect.objectContaining({ method: 'POST', credentials: 'include' })
    );
    expect(mockPush).toHaveBeenCalledWith('/learn');
  });

  it('supports design step deep-links without persisting hosted-demo state', async () => {
    mockConfigFetch(false);
    window.history.pushState({}, '', '/welcome?step=8&lang=es');

    render(<WelcomeFlow initialConfig={{ selfHosted: false, isOwner: false }} />);

    expect(await screen.findByText(/Where do you/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/placement test available/i)).toHaveTextContent(
      /use this quick ladder, estimate from notes, or choose a CEFR level/i
    );
    expect(screen.getByText(/Estimated level/i).textContent).toContain('B1');
    expect(window.localStorage.getItem('sotto.onboarding.v1')).toBeNull();
  });

  it('deep-links to the context brief before compose', async () => {
    mockConfigFetch(false);
    window.history.pushState({}, '', '/welcome?step=9&lang=es');

    render(<WelcomeFlow initialConfig={{ selfHosted: false, isOwner: false }} />);

    expect(
      await screen.findByRole('heading', { name: /Review the practice brief/i })
    ).toBeInTheDocument();
    expect(screen.getAllByText(/example.com/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Invisible Cities/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/CEFR B1/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Composing your course/i)).not.toBeInTheDocument();
    expect(window.localStorage.getItem('sotto.onboarding.v1')).toBeNull();
  });

  it('links the sidebar logo back to home after entering the hosted demo setup', async () => {
    mockConfigFetch(false);
    window.history.pushState({}, '', '/welcome?step=2');

    render(<WelcomeFlow initialConfig={{ selfHosted: false, isOwner: false }} />);

    expect(await screen.findByRole('link', { name: /go to sotto home/i })).toHaveAttribute(
      'href',
      '/'
    );
  });

  it('does not persist hosted-demo progress while visitors move through welcome', async () => {
    const user = userEvent.setup();
    mockConfigFetch(false);

    render(<WelcomeFlow initialConfig={{ selfHosted: false, isOwner: false }} />);

    await user.click(screen.getByRole('button', { name: /^Skip$/i }));
    await user.click(screen.getByRole('button', { name: /^Get started$/i }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: /Get started/i }));
    await user.click(screen.getByRole('button', { name: /continue with admin profile/i }));
    await user.click(screen.getByRole('button', { name: /Learn Italian/i }));
    await user.keyboard('{Enter}');

    expect(await screen.findByText(/Connect the agent/i)).toBeInTheDocument();
    expect(window.localStorage.getItem('sotto.onboarding.v1')).toBeNull();
  });

  it('keeps self-host welcome progress resumable and keyboard navigable', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/onboarding/name')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        });
      }
      return Promise.resolve({
        ok: false,
        json: async () => ({ selfHosted: true, isOwner: false }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<WelcomeFlow initialConfig={{ selfHosted: true, isOwner: false }} />);

    await user.click(screen.getByRole('button', { name: /^Skip$/i }));
    await user.click(screen.getByRole('button', { name: /^Get started$/i }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: /Get started/i }));
    await user.click(screen.getByRole('button', { name: /continue with admin profile/i }));
    await user.click(screen.getByRole('button', { name: /Learn Italian/i }));
    await user.keyboard('{Enter}');

    expect(await screen.findByText(/Connect the agent/i)).toBeInTheDocument();

    await waitFor(() => {
      const raw = window.localStorage.getItem('sotto.onboarding.v1');
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw ?? '{}')).toMatchObject({
        step: 4,
        profileName: 'Learner',
        avatarSlug: 'capybara',
        language: 'it',
      });
    });
  });

  it('persists the owner CLI agent selection when leaving the connect-agent step', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/onboarding/config')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            selfHosted: true,
            isOwner: true,
            onboardingResumeKey: 'current-owner',
            agentStatuses: {
              'claude-code': { readiness: 'ready', version: 'claude 2.0.0', detail: null },
              codex: { readiness: 'not_installed', version: null, detail: null },
            },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);
    window.localStorage.setItem(
      'sotto.onboarding.v1',
      JSON.stringify({
        onboardingResumeKey: 'current-owner',
        step: 4,
        baseLang: 'en',
        language: 'de',
        agent: {
          provider: 'claude',
          method: 'cli',
          value: '',
          model: 'claude-code:opus',
          status: 'connected',
        },
      })
    );

    render(
      <WelcomeFlow
        initialConfig={{ selfHosted: true, isOwner: true, onboardingResumeKey: 'current-owner' }}
      />
    );

    await user.click(await screen.findByRole('button', { name: /^Continue/i }));

    // Placement's "estimate from material" resolves the AI server-side before the
    // final StepReady save, so the selection must already be in SiteConfig.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/site-config',
        expect.objectContaining({
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ aiProvider: 'claude-code', aiModel: 'claude-code:opus' }),
        })
      );
    });
  });

  it('persists a BYOK agent key when leaving the connect-agent step', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/onboarding/config')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            selfHosted: true,
            isOwner: false,
            onboardingResumeKey: 'current-owner',
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);
    window.localStorage.setItem(
      'sotto.onboarding.v1',
      JSON.stringify({
        onboardingResumeKey: 'current-owner',
        step: 4,
        baseLang: 'en',
        language: 'de',
        agent: {
          provider: 'claude',
          method: 'key',
          value: 'sk-ant-test',
          model: 'claude-sonnet-5',
          status: 'connected',
        },
      })
    );

    render(
      <WelcomeFlow
        initialConfig={{ selfHosted: true, isOwner: false, onboardingResumeKey: 'current-owner' }}
      />
    );

    await user.click(await screen.findByRole('button', { name: /^Continue/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/settings/ai-keys',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'anthropic', apiKey: 'sk-ant-test' }),
        })
      );
    });
    // A learner without owner rights never touches server infra.
    expect(fetchMock).not.toHaveBeenCalledWith('/api/v1/admin/site-config', expect.anything());
  });
});
