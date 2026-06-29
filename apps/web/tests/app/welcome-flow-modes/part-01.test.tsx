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

  it('offers placement choices inside the welcome flow instead of linking to /learn', async () => {
    const user = userEvent.setup();
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
    expect(
      screen.getByRole('button', { name: /Take the quick placement test/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upload notes or material/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Choose my CEFR level/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Take the quick placement test/i }));

    expect(screen.getByText('Me llamo Luca.')).toBeInTheDocument();
    expect(screen.getByText(/Tap the highest sentence you fully understand/i)).toBeInTheDocument();
  });

  it('lets learners force a CEFR level from the welcome placement step', async () => {
    const user = userEvent.setup();
    const selectPlacementLevel = vi.fn();

    render(
      <StepPlacement
        baseLang="en"
        language="de"
        understood={new Set()}
        toggleUnderstood={vi.fn()}
        selectPlacementLevel={selectPlacementLevel}
        level={null}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /Choose my CEFR level/i }));
    await user.click(screen.getByRole('button', { name: /C1 Advanced/i }));

    expect(selectPlacementLevel).toHaveBeenCalledWith('C1');
  });

  it('can estimate placement from uploaded or pasted material in demo mode', async () => {
    const user = userEvent.setup();
    const selectPlacementLevel = vi.fn();
    const onAddContextItems = vi.fn();

    render(
      <StepPlacement
        baseLang="en"
        language="de"
        understood={new Set()}
        toggleUnderstood={vi.fn()}
        selectPlacementLevel={selectPlacementLevel}
        onAddContextItems={onAddContextItems}
        level={null}
        demoMode
        onNext={vi.fn()}
        onBack={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /Upload notes or material/i }));
    await user.type(
      screen.getByLabelText(/Notes, lesson material, or writing sample/i),
      'I can understand menus and short messages from my German class.'
    );
    await user.click(screen.getByRole('button', { name: /Estimate from material/i }));

    expect(
      await screen.findByText(/Demo estimate based on the amount of material/i)
    ).toBeInTheDocument();
    expect(selectPlacementLevel).toHaveBeenCalledWith('A1');
    expect(onAddContextItems).toHaveBeenCalledWith([
      expect.objectContaining({ kind: 'text', label: 'Placement notes' }),
    ]);
  });

  it('explains the selected placement level so learners can skip the formal test', () => {
    render(
      <StepPlacement
        baseLang="en"
        language="de"
        understood={new Set(['C2'])}
        toggleUnderstood={vi.fn()}
        level="C2"
        onNext={vi.fn()}
        onBack={vi.fn()}
      />
    );

    expect(screen.getByText(/Estimated level/i).textContent).toContain('top rung');
    expect(screen.getByText('Near-native range')).toBeInTheDocument();
    expect(screen.getByText(/idiom and irony/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Compose now; the adaptive test can verify this later/i)
    ).toBeInTheDocument();
  });

  it('localizes placement guidance to the learn-from language', () => {
    render(
      <StepPlacement
        baseLang="es"
        language="de"
        understood={new Set(['B1'])}
        toggleUnderstood={vi.fn()}
        level="B1"
        onNext={vi.fn()}
        onBack={vi.fn()}
      />
    );

    expect(screen.getByText(/Nivel estimado/i).textContent).toContain('B1');
    expect(screen.getByText('Base independiente')).toBeInTheDocument();
    expect(screen.getByText(/ideas principales en habla clara/i)).toBeInTheDocument();
    expect(screen.getByText(/Enfoque del curso/i)).toBeInTheDocument();
    expect(screen.queryByText(/Often comfortable with/i)).not.toBeInTheDocument();
  });

  it('describes A1 as a true beginner path rather than existing comfort', () => {
    render(
      <StepPlacement
        baseLang="en"
        language="de"
        understood={new Set(['A1'])}
        toggleUnderstood={vi.fn()}
        level="A1"
        onNext={vi.fn()}
        onBack={vi.fn()}
      />
    );

    expect(screen.getByText('Brand-new beginner')).toBeInTheDocument();
    expect(screen.getByText(/This usually means/i)).toBeInTheDocument();
    expect(screen.getByText(/first greetings/i)).toBeInTheDocument();
    expect(screen.getByText(/Start from zero with pronunciation/i)).toBeInTheDocument();
    expect(screen.queryByText(/Often comfortable with/i)).not.toBeInTheDocument();
  });

  it('starts reset onboarding with a welcome screen before learner setup', async () => {
    const user = userEvent.setup();
    mockConfigFetch(true);

    render(<WelcomeFlow initialConfig={{ selfHosted: true, isOwner: false }} />);

    expect(await screen.findByText(/First launch/i)).toBeInTheDocument();
    expect(screen.getByText(/Swipe up to begin/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Setup progress/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Learn Italian/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Skip$/i }));
    await user.click(screen.getByRole('button', { name: /^Get started$/i }));

    expect(await screen.findByText(/How Sotto works/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Setup progress/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Back$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Skip animation/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Back/i }));
    expect(await screen.findByText(/First launch/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Skip$/i }));
    await user.click(screen.getByRole('button', { name: /Get started/i }));
    await user.click(screen.getByRole('button', { name: /Skip animation/i }));
    expect(screen.queryByRole('button', { name: /Skip animation/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Get started/i }));

    expect(await screen.findByRole('heading', { name: /Who's learning/i })).toBeInTheDocument();
    expect(screen.getByText(/admin · first learner/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Setup progress/i)).toBeInTheDocument();
  });

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
        demoMode={false}
        setName={vi.fn()}
        setAvatarSlug={vi.fn()}
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
        body: JSON.stringify({ name: 'Andres', avatarSlug: 'capybara' }),
      })
    );
    expect(onNext).toHaveBeenCalled();
  });

  it('keeps the placement ladder to one selected rung', async () => {
    const user = userEvent.setup();
    mockConfigFetch(false);
    window.history.pushState({}, '', '/welcome?step=8&lang=de');

    render(<WelcomeFlow initialConfig={{ selfHosted: false, isOwner: false }} />);

    expect(await screen.findByText(/Where do you/i)).toBeInTheDocument();
    const b1 = screen.getByRole('button', { name: /B1: Wenn ich Zeit hätte/i });
    const b2 = screen.getByRole('button', { name: /B2: Trotz der Verspätung/i });
    const c1 = screen.getByRole('button', { name: /C1: Er hätte uns rechtzeitig/i });

    expect(b1).toHaveAttribute('aria-pressed', 'true');

    await user.click(b2);
    expect(b1).toHaveAttribute('aria-pressed', 'false');
    expect(b2).toHaveAttribute('aria-pressed', 'true');

    await user.click(c1);
    expect(b2).toHaveAttribute('aria-pressed', 'false');
    expect(c1).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Estimated level/i).textContent).toContain('C1');
  });

  it('shows the design agent choices and a separate Google live key prompt', () => {
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
    expect(screen.getByRole('link', { name: /open claude api page/i })).toHaveAttribute(
      'href',
      'https://platform.claude.com/'
    );
    expect(screen.getByRole('link', { name: /open codex api page/i })).toHaveAttribute(
      'href',
      'https://platform.openai.com/api-keys'
    );
    expect(screen.queryByText(/recommended/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Gemini/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Google API key for Live/i)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Google Gemini API key for live conversation/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /open google ai studio api key page/i })
    ).toHaveAttribute('href', 'https://aistudio.google.com/apikey');
  });

  it('keeps welcome course copy away from podcast and video framing', () => {
    const copy = [
      ...COMPOSE_LOG.map((line) => line.text),
      ...MODULES.flatMap((module) => [module.name, module.meta]),
    ].join(' ');

    expect(copy).not.toMatch(/\b(podcast|episode|ep\.|video)\b/i);
    expect(copy).toMatch(/course|lesson/i);
  });

  it('captures the local endpoint URL and the served model name', () => {
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
    // The local server's served model (AI_MODEL) is now captured here too.
    const modelInput = screen.getByLabelText(/local model name/i);
    expect(modelInput).toBeInTheDocument();
    expect(modelInput).toHaveValue('qwen3');
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
        voice={{
          tts: 'elevenlabs',
          stt: 'deepgram',
          visualCueProvider: 'pexels',
          keys: {},
          baseUrls: {},
          ttsModel: {},
          sttModel: {},
        }}
        demoMode
        language="es"
        setVoice={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />
    );

    expect(screen.getAllByText(/no key or local endpoint is requested or saved/i)).toHaveLength(2);
    expect(screen.getAllByText(/^local$/i)).toHaveLength(4);
    expect(
      screen.getByRole('button', { name: /Local sidecar.*any Sotto-compatible TTS server/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Local sidecar.*any Sotto-compatible STT server/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open elevenlabs api page/i })).toHaveAttribute(
      'href',
      'https://elevenlabs.io/app/settings/api-keys'
    );
    expect(screen.getByRole('link', { name: /open deepgram api page/i })).toHaveAttribute(
      'href',
      'https://developers.deepgram.com/docs/create-additional-api-keys'
    );
    expect(screen.queryByText(/^rec$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/ElevenLabs API key/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Deepgram API key/i)).not.toBeInTheDocument();
  });

  it('blocks voice providers that do not support the selected course language', () => {
    render(
      <StepVoice
        voice={{
          tts: 'hume',
          stt: 'openai',
          visualCueProvider: 'pexels',
          keys: {},
          baseUrls: {},
          ttsModel: {},
          sttModel: {},
        }}
        demoMode={false}
        language="uk"
        setVoice={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /Hume/i })).toBeDisabled();
    expect(screen.getByText(/Hume has no speech model for Ukrainian/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Choose voice providers with Ukrainian support before continuing/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue/i })).toBeDisabled();
  });

  it('requires a green local endpoint check before continuing with local speech', async () => {
    const user = userEvent.setup();
    let voice: VoiceState = {
      tts: 'local',
      stt: 'local',
      visualCueProvider: 'pexels',
      keys: {},
      baseUrls: {},
      ttsModel: {},
      sttModel: {},
    };
    const setVoice = vi.fn((updater: (prev: typeof voice) => typeof voice) => {
      voice = updater(voice);
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        checks: [
          {
            id: 'tts',
            label: 'Text to speech',
            url: 'http://localhost:8000',
            ok: true,
            detail: 'Ready: /health, /voices, and /tts passed.',
          },
          {
            id: 'stt',
            label: 'Speech to text',
            url: 'http://localhost:8001/v1',
            ok: true,
            detail: 'Ready: /audio/transcriptions accepted a test WAV.',
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const renderStep = () => (
      <StepVoice
        voice={voice}
        demoMode={false}
        language="es"
        setVoice={setVoice}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />
    );
    const { rerender } = render(renderStep());

    expect(screen.getByRole('button', { name: /Continue/i })).toBeDisabled();
    expect(screen.getByPlaceholderText('http://localhost:8001/v1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Check$/i }));

    expect(await screen.findByText(/Local speech endpoints are ready/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue/i })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/onboarding/check-local-speech',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
      })
    );

    await user.type(screen.getAllByLabelText(/Local sidecar endpoint URL/i)[0], '2');
    rerender(renderStep());

    expect(screen.getByRole('button', { name: /Continue/i })).toBeDisabled();
    expect(screen.getByText(/Endpoint changed/i)).toBeInTheDocument();
  });

  it('adds typed links, books, topics, and uploaded files in the context step', async () => {
    const user = userEvent.setup();
    let contextItems: ContextItem[] = [];
    const setContextItems = (updater: ContextItem[] | ((prev: ContextItem[]) => ContextItem[])) => {
      contextItems = typeof updater === 'function' ? updater(contextItems) : updater;
    };
    const renderStep = () => (
      <StepContext
        contextItems={contextItems}
        setContextItems={setContextItems}
        demoMode={false}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />
    );

    const { rerender } = render(renderStep());

    expect(screen.getByRole('button', { name: /Continue/i })).toBeDisabled();

    expect(screen.getByText(/Course material/i)).toBeInTheDocument();
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.getByText(/Class notes, a syllabus/i)).toBeInTheDocument();
    expect(screen.queryByText('Optional')).not.toBeInTheDocument();
    expect(screen.getByText(/Text files are read locally/i)).toBeInTheDocument();
    expect(screen.queryByText(/Context permissions/i)).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Web links/i })).toHaveAttribute(
      'aria-checked',
      'true'
    );

    await user.type(screen.getByLabelText(/Material details/i), 'example.com/paper');
    await user.click(screen.getByRole('button', { name: /^Add material$/i }));
    rerender(renderStep());

    expect(screen.getByText('example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue/i })).toBeEnabled();

    await user.click(screen.getByRole('radio', { name: /Books/i }));
    await user.type(
      screen.getByLabelText(/Material details/i),
      'Invisible Cities by Italo Calvino'
    );
    await user.click(screen.getByRole('button', { name: /^Add material$/i }));

    await user.click(screen.getByRole('radio', { name: /^Topics/i }));
    await user.type(
      screen.getByLabelText(/Material details/i),
      'cooking, distributed systems, and opera'
    );
    await user.click(screen.getByRole('button', { name: /^Add material$/i }));

    const files = Array.from(
      { length: 7 },
      (_, index) =>
        new File([`Italian notes from design doc ${index + 1}`], `notes-${index + 1}.md`, {
          type: 'text/markdown',
        })
    );
    await user.upload(screen.getByLabelText(/Choose context files/i), files);
    await waitFor(() => {
      expect(contextItems.map((item) => item.kind)).toEqual([
        'link',
        'book',
        'topic',
        'file',
        'file',
        'file',
        'file',
        'file',
        'file',
        'file',
      ]);
    });
    rerender(renderStep());

    expect(screen.getByText('notes-7.md')).toBeInTheDocument();
    expect(screen.queryByText(/Added the first/i)).not.toBeInTheDocument();
  });

  it('adds music as concrete context instead of toggling opaque permissions', async () => {
    const user = userEvent.setup();
    let contextItems: ContextItem[] = [];
    const setContextItems = (updater: ContextItem[] | ((prev: ContextItem[]) => ContextItem[])) => {
      contextItems = typeof updater === 'function' ? updater(contextItems) : updater;
    };

    const renderStep = () => (
      <StepContext
        contextItems={contextItems}
        setContextItems={setContextItems}
        demoMode={false}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />
    );

    const { rerender } = render(renderStep());

    const music = screen.getByRole('radio', { name: /Music & audio/i });
    expect(music).toHaveAttribute('aria-checked', 'false');

    await user.click(music);
    expect(music).toHaveAttribute('aria-checked', 'true');
    await user.type(screen.getByLabelText(/Material details/i), 'Radio Ambulante');
    await user.click(screen.getByRole('button', { name: /^Add material$/i }));
    rerender(renderStep());

    expect(contextItems[0]).toMatchObject({ kind: 'music', label: 'Radio Ambulante' });
    expect(screen.getByText('music/audio')).toBeInTheDocument();
    expect(screen.queryByText('Include')).not.toBeInTheDocument();
  });

  it('shows a practice brief from extracted context before composing', async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    const onBack = vi.fn();

    render(
      <StepContextReview
        baseLang="en"
        language="es"
        level="B1"
        contextItems={[
          {
            id: 'ctx-topic-1',
            kind: 'topic',
            label: 'Distributed systems',
            value: 'distributed systems, incident reviews, and backend architecture',
          },
          {
            id: 'ctx-music-1',
            kind: 'music',
            label: 'Radio Ambulante',
            value: 'Radio Ambulante episodes about travel and work',
          },
        ]}
        onNext={onNext}
        onBack={onBack}
      />
    );

    expect(screen.getByRole('heading', { name: /Review the practice brief/i })).toBeInTheDocument();
    expect(screen.getByText(/Practice read/i)).toBeInTheDocument();
    expect(screen.getAllByText(/CEFR B1/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Distributed systems/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Radio Ambulante/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/independent practice/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/First lesson priorities/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Compose from this brief/i }));
    expect(onNext).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /Back/i }));
    expect(onBack).toHaveBeenCalled();
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
        contextItems={[]}
        agent={{ provider: 'claude', method: 'cli', value: '', model: '', status: 'connected' }}
        voice={{
          tts: 'elevenlabs',
          stt: 'whisper',
          visualCueProvider: 'pexels',
          keys: {},
          baseUrls: {},
          ttsModel: {},
          sttModel: {},
        }}
        config={{ selfHosted: false, isOwner: false }}
        onRestart={vi.fn()}
        onJump={onJump}
      />
    );

    await user.click(screen.getByTitle('Change language'));
    expect(onJump).toHaveBeenCalledWith(3);

    await user.click(screen.getByRole('button', { name: /finish demo/i }));

    expect(
      await screen.findByText(/hosted demo complete.*no profile was created/i)
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();

    const homeButton = screen.getByRole('button', { name: /return home/i });
    expect(homeButton).toBeEnabled();

    await user.click(homeButton);
    expect(mockPush).toHaveBeenCalledWith('/');
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
        sources={new Set()}
        contextItems={[
          {
            id: 'ctx-link-1',
            kind: 'link',
            label: 'example.com',
            value: 'https://example.com/paper',
          },
          {
            id: 'ctx-book-1',
            kind: 'book',
            label: 'Invisible Cities',
            value: 'Invisible Cities by Italo Calvino',
          },
        ]}
        agent={{ provider: 'claude', method: 'cli', value: '', model: '', status: 'connected' }}
        voice={{
          tts: 'elevenlabs',
          stt: 'whisper',
          visualCueProvider: 'pexels',
          keys: {},
          baseUrls: {},
          ttsModel: {},
          sttModel: {},
        }}
        storage={{ provider: 's3', s3Bucket: 'sotto-media', s3Region: 'us-east-1' }}
        config={{ selfHosted: true, isOwner: true }}
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
      infra: { storageProvider: 's3', s3Bucket: 'sotto-media', s3Region: 'us-east-1' },
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).note).toContain('https://example.com/paper');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).note).toContain('[book] Invisible Cities');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).note).not.toContain(
      'Allowed context sources:'
    );
    expect(mockPush).toHaveBeenCalledWith('/learn');
  });
});
