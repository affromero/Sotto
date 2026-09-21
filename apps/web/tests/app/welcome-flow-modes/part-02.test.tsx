/**
 * Welcome flow mode split. SELF_HOSTED=true is real setup; SELF_HOSTED=false is
 * a public mock walkthrough that must not ask for keys, create profiles, or
 * route visitors into the authenticated learning app.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ImgHTMLAttributes } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  credentialSaveRequestSchema,
  credentialSettingsSnapshotSchema,
  type CredentialSaveRequest,
} from 'thesidedoor-core/configuration/credential-client';
import { WelcomeFlow } from '@/app/welcome/WelcomeFlow';
import type { AgentState, ContextItem, VoiceState } from '@/app/welcome/WelcomeFlow';
import { StepAgent } from '@/app/welcome/steps/StepAgent';
import { StepContext } from '@/app/welcome/steps/StepContext';
import { StepContextReview } from '@/app/welcome/steps/StepContextReview';
import { StepLearnerProfile } from '@/app/welcome/steps/StepLearnerProfile';
import { StepPlacement } from '@/app/welcome/steps/StepPlacement';
import { StepReady } from '@/app/welcome/steps/StepReady';
import {
  createWelcomeCredentialBoundary,
  withWelcomeCredentialBoundary,
} from '../../helpers/setup/welcome-credentials';
let credentialBoundary = createWelcomeCredentialBoundary();
beforeEach(() => {
  credentialBoundary = createWelcomeCredentialBoundary();
});
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
    withWelcomeCredentialBoundary(credentialBoundary, async () => ({
      ok: false,
      json: async () => ({ selfHosted, isOwner: false }),
    }))
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
    vi.stubGlobal('fetch', withWelcomeCredentialBoundary(credentialBoundary, fetchMock));

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
    vi.stubGlobal('fetch', withWelcomeCredentialBoundary(credentialBoundary, fetchMock));

    render(
      <StepReady
        saveCredentials={credentialBoundary.saveCredentials}
        submitSetup={credentialBoundary.submitSetup}
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

    expect(credentialBoundary.saved.get('ai-keys:google')).toEqual({ apiKey: 'AIza-live' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/onboarding/save',
      expect.objectContaining({ method: 'POST' })
    );
    expect(mockPush).toHaveBeenCalledWith('/learn');
  });

  it('saves an optional visual cue provider key during self-host setup', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ demo: false, courseId: 'course_1' }),
    });
    vi.stubGlobal('fetch', withWelcomeCredentialBoundary(credentialBoundary, fetchMock));

    render(
      <StepReady
        saveCredentials={credentialBoundary.saveCredentials}
        submitSetup={credentialBoundary.submitSetup}
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

    expect(credentialBoundary.saved.get('visual-cues:pexels')).toEqual({
      apiKey: 'pexels_key_123',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/onboarding/save',
      expect.objectContaining({ method: 'POST' })
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
    expect(screen.getAllByText(/^example\.com$/i).length).toBeGreaterThan(0);
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
    vi.stubGlobal('fetch', withWelcomeCredentialBoundary(credentialBoundary, fetchMock));

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
    vi.stubGlobal('fetch', withWelcomeCredentialBoundary(credentialBoundary, fetchMock));
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

  it('reports an endpoint as configured only after the owner configuration save succeeds', async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<Response>();
    let payload: unknown;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/v1/admin/site-config') {
        payload = JSON.parse(String(init?.body));
        return pending.promise;
      }
      return (
        credentialBoundary.handle(input, init) ??
        Response.json({ selfHosted: true, isOwner: true, onboardingResumeKey: 'current-owner' })
      );
    });
    window.localStorage.setItem(
      'sotto.onboarding.v1',
      JSON.stringify({
        onboardingResumeKey: 'current-owner',
        step: 4,
        language: 'de',
        agent: {
          provider: 'local',
          method: 'url',
          value: 'http://localhost:8000/v1',
          model: 'local-model',
          status: 'connected',
        },
      })
    );
    render(
      <WelcomeFlow
        initialConfig={{ selfHosted: true, isOwner: true, onboardingResumeKey: 'current-owner' }}
      />
    );
    const save = await screen.findByRole('button', { name: 'Save endpoint' });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);
    await waitFor(() =>
      expect(payload).toMatchObject({
        aiProvider: 'local',
        aiBaseUrl: 'http://localhost:8000/v1',
        aiModel: 'local-model',
      })
    );
    expect(screen.queryByText('Endpoint configured')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Continue/i })).toBeDisabled();
    pending.resolve(Response.json({ success: true }));
    expect(await screen.findByText('Endpoint configured')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Continue/i })).toBeEnabled();
  });

  it('requires fresh consent after editing an unverified key and reports the saved outcome', async () => {
    const user = userEvent.setup();
    const submitted: CredentialSaveRequest[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/v1/settings/ai-keys' && init?.method === 'POST') {
        const command = credentialSaveRequestSchema.parse(JSON.parse(String(init.body)));
        submitted.push(command);
        if (!command.allowUnverified)
          return Response.json({
            status: 'needs_confirmation',
            operationId: command.operationId,
            context: command.context,
            validation: {
              status: 'inconclusive',
              readiness: { code: 'unreachable', checkedAt: 1 },
            },
          });
      }
      const response = credentialBoundary.handle(input, init);
      if (response && !init?.method) {
        const snapshot = credentialSettingsSnapshotSchema.parse(await response.json());
        snapshot.keys = snapshot.keys.map((key) => ({
          ...key,
          verification: {
            lastAttempt: { status: 'inconclusive', checkedAt: 1 },
            lastConfirmed: null,
          },
        }));
        return Response.json(snapshot);
      }
      return (
        response ??
        Response.json({ selfHosted: true, isOwner: false, onboardingResumeKey: 'current-owner' })
      );
    });
    window.localStorage.setItem(
      'sotto.onboarding.v1',
      JSON.stringify({
        onboardingResumeKey: 'current-owner',
        step: 4,
        language: 'de',
        agent: { provider: 'claude', method: 'key', model: 'claude-sonnet-5' },
      })
    );
    render(
      <WelcomeFlow
        initialConfig={{ selfHosted: true, isOwner: false, onboardingResumeKey: 'current-owner' }}
      />
    );
    const input = await screen.findByLabelText(/Claude API key/i);
    await waitFor(() => expect(input).toBeEnabled());
    await user.type(input, 'first-key');
    await user.click(screen.getByRole('button', { name: /^Save key$/i }));
    expect(
      await screen.findByRole('button', { name: 'Save without verification' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Continue/i })).toBeDisabled();
    await user.clear(input);
    await user.type(input, 'changed-key');
    expect(
      screen.queryByRole('button', { name: 'Save without verification' })
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Save key$/i }));
    await user.click(await screen.findByRole('button', { name: 'Save without verification' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Continue/i })).toBeEnabled());
    expect(screen.getByText(/key saved without verification/i)).toBeInTheDocument();
    expect(submitted).toHaveLength(3);
    expect(submitted[0]!.operationId).not.toBe(submitted[1]!.operationId);
    expect(submitted[2]).toMatchObject({
      operationId: submitted[1]!.operationId,
      allowUnverified: true,
    });
    expect(credentialBoundary.saved.get('ai-keys:anthropic')).toEqual({ apiKey: 'changed-key' });
  });

  it('resumes a saved personal AI key without exposing it or posting it again', async () => {
    const user = userEvent.setup();
    const posts: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') posts.push(String(input));
      return (
        credentialBoundary.handle(input, init) ??
        Response.json({ selfHosted: true, isOwner: false, onboardingResumeKey: 'current-owner' })
      );
    });
    await credentialBoundary.saveCredentials([
      { endpoint: 'ai-keys', provider: 'anthropic', apiKey: 'saved-secret' },
    ]);
    posts.length = 0;
    window.localStorage.setItem(
      'sotto.onboarding.v1',
      JSON.stringify({
        onboardingResumeKey: 'current-owner',
        step: 4,
        language: 'de',
        agent: {
          provider: 'claude',
          method: 'key',
          value: 'old-browser-secret',
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
    expect(await screen.findByText('Saved for your profile')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('saved-secret')).not.toBeInTheDocument();
    const next = screen.getByRole('button', { name: /^Continue/i });
    await waitFor(() => expect(next).toBeEnabled());
    await user.click(next);
    expect(
      await screen.findByRole('heading', { name: /Choose the tools that practice with you/i })
    ).toBeInTheDocument();
    expect(posts).toEqual([]);
    const saved = JSON.parse(window.localStorage.getItem('sotto.onboarding.v1') ?? '{}') as {
      agent?: { value?: string; liveTranslationKey?: string };
      voice?: { keys?: Record<string, string> };
      storage?: { accessKeyId?: string; secretAccessKey?: string };
    };
    expect(saved.agent?.value).toBe('');
    expect(saved.agent?.liveTranslationKey).toBe('');
    expect(saved.voice?.keys).toEqual({});
    expect(saved.storage?.accessKeyId).toBe('');
    expect(saved.storage?.secretAccessKey).toBe('');
  });

  it('locks final setup navigation and aborts the request when welcome unmounts', async () => {
    const user = userEvent.setup();
    let signal: AbortSignal | undefined;
    const pending = Promise.withResolvers<Response>();
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/v1/onboarding/save') {
        signal = init?.signal ?? undefined;
        return pending.promise;
      }
      return (
        credentialBoundary.handle(input, init) ??
        Response.json({ selfHosted: true, isOwner: false, onboardingResumeKey: 'current-owner' })
      );
    });
    window.localStorage.setItem(
      'sotto.onboarding.v1',
      JSON.stringify({
        onboardingResumeKey: 'current-owner',
        step: 11,
        language: 'de',
        agent: { provider: 'claude', method: 'key', model: 'claude-sonnet-5' },
        voice: { tts: 'local', stt: 'whisper', visualCueProvider: 'off' },
      })
    );
    const view = render(
      <WelcomeFlow
        initialConfig={{ selfHosted: true, isOwner: false, onboardingResumeKey: 'current-owner' }}
      />
    );
    const finish = await screen.findByRole('button', { name: /Open today's session/i });
    await waitFor(() => expect(finish).toBeEnabled());
    await user.click(finish);
    await waitFor(() => expect(signal).toBeDefined());
    await user.keyboard('{Escape}');
    expect(finish).toBeDisabled();
    view.unmount();
    expect(signal?.aborted).toBe(true);
    pending.resolve(Response.json({ courseId: 'course' }));
    await pending.promise;
    expect(mockPush).not.toHaveBeenCalled();
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
    vi.stubGlobal('fetch', withWelcomeCredentialBoundary(credentialBoundary, fetchMock));
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

    const input = await screen.findByLabelText(/Claude API key/i);
    expect(input).toHaveValue('');
    await user.type(input, 'sk-ant-test');
    await user.click(screen.getByRole('button', { name: /^Save key$/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Continue/i })).toBeEnabled(), {
      timeout: 2500,
    });
    await user.click(screen.getByRole('button', { name: /^Continue/i }));

    await waitFor(() => {
      expect(credentialBoundary.saved.get('ai-keys:anthropic')).toEqual({ apiKey: 'sk-ant-test' });
    });
    // A learner without owner rights never touches server infra.
    expect(fetchMock).not.toHaveBeenCalledWith('/api/v1/admin/site-config', expect.anything());
  });
});
