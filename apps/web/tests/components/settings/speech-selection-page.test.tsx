import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const state = vi.hoisted(() => ({
  provider: 'local' as string | null,
  model: 'piper' as string | null,
  owner: true,
  configured: 'cartesia' as 'cartesia' | 'openai' | null,
  preferredLanguage: 'de',
  courseLanguage: 'de',
}));
vi.mock('@/lib/auth', () => ({
  auth: async () => ({ user: { id: 'alice' }, isOwner: state.owner }),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: async () => ({
        name: 'Alice',
        role: 'USER',
        preferredLanguage: state.preferredLanguage,
        preferredTtsProvider: state.provider,
        preferredTtsModel: state.model,
      }),
    },
    userInterest: { findMany: async () => [] },
    tag: { findMany: async () => [] },
    course: {
      findFirst: async () => ({ targetLang: state.courseLanguage }),
      findMany: async () => [],
    },
  },
}));
vi.mock('@/lib/byok', () => ({
  listByokProviders: async () => [{ provider: 'cartesia', isValid: true }],
  listAiProviders: async () => [],
}));
vi.mock('@/lib/auto-model-config', () => ({
  getAutoModelConfig: async () => ({
    model: { ttsProvider: 'cartesia', ttsModel: 'stale-model', sttProvider: 'cartesia' },
  }),
}));
vi.mock('@/lib/server-config', () => ({
  getServerInfra: async () => ({
    ttsProvider: state.configured,
    ttsBaseUrl: 'http://local-tts:8090',
    ttsVoices: 'voice-a,voice-b',
  }),
  infra: (key: string) => (key === 'ttsProvider' ? (state.configured ?? undefined) : undefined),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
import SettingsPage from '@/app/(dashboard)/settings/page';

beforeEach(() => {
  state.provider = 'local';
  state.model = 'piper';
  state.owner = true;
  state.configured = 'cartesia';
  state.preferredLanguage = 'de';
  state.courseLanguage = 'de';
  vi.stubGlobal('fetch', async (url: string) => {
    if (url === '/api/v1/ai-models') return Response.json({ models: [] });
    if (url === '/api/v1/settings/local-speech')
      return Response.json({
        provider: state.provider === 'disabled' ? null : (state.provider ?? state.configured),
        providerLabel: null,
        creditsBlocked: null,
        canCheckCredits: false,
      });
    throw new Error(`Unexpected HTTP request: ${url}`);
  });
});
afterEach(() => vi.unstubAllGlobals());
describe('settings speech selection', () => {
  it('shows the explicitly selected local provider and custom model while retaining the real cloud default', async () => {
    render(await SettingsPage());
    expect(screen.getByText('Local speech is selected.')).toBeVisible();
    expect(screen.getByLabelText('Preferred text-to-speech model')).toBeEnabled();
    expect(screen.getByLabelText('Preferred text-to-speech model')).toHaveValue('piper');
    expect(screen.getByRole('button', { name: 'Use Cartesia default (Sonic 3.5)' })).toBeEnabled();
  });
  it('returns to configured cloud selection after profile preferences are cleared', async () => {
    state.provider = null;
    state.model = null;
    render(await SettingsPage());
    expect(screen.getByText('Configured speech: Cartesia.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Use Cartesia default (Sonic 3.5)' })).toBeDisabled();
  });
  it('offers profile speech selection without shared configuration for an authenticated non-owner', async () => {
    state.owner = false;
    render(await SettingsPage());
    expect(screen.getByRole('button', { name: 'Use Cartesia default (Sonic 3.5)' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Disable audio' })).toBeEnabled();
    expect(screen.queryByLabelText('Speech endpoint URL')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use local speech' })).not.toBeInTheDocument();
  });
  it('keeps disabled audio outside the provider model registry', async () => {
    state.provider = 'disabled';
    state.model = null;
    render(await SettingsPage());
    expect(screen.getByLabelText('Preferred text-to-speech model')).toBeDisabled();
    expect(screen.getByLabelText('Preferred text-to-speech model')).toHaveValue('');
    expect(
      screen.getByRole('button', { name: 'Turn on Cartesia default (Sonic 3.5)' })
    ).toBeEnabled();
  });
  it('keeps a personal cloud provider separate from the actual configured server default', async () => {
    state.provider = 'openai';
    state.model = 'tts-1-hd';
    render(await SettingsPage());
    expect(screen.getByText('Selected speech: OpenAI.')).toBeVisible();
    expect(screen.getByLabelText('Preferred text-to-speech model')).toHaveValue('tts-1-hd');
    expect(screen.getByRole('button', { name: 'Use Cartesia default (Sonic 3.5)' })).toBeEnabled();
  });
  it('leaves absent server configuration unselected despite automatic model defaults', async () => {
    state.provider = null;
    state.model = null;
    state.configured = null;
    render(await SettingsPage());
    expect(screen.getByText('No speech provider selected.')).toBeVisible();
    expect(screen.getByLabelText('Preferred text-to-speech model')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'No configured speech provider' })).toBeDisabled();
  });
  it('uses the current German course language over the English interface preference', async () => {
    state.preferredLanguage = 'en';
    state.courseLanguage = 'de';
    render(await SettingsPage());
    expect(
      screen.getByText('Choose speech models compatible with German for your selected provider.')
    ).toBeVisible();
    expect(
      within(screen.getByLabelText('Preferred text-to-speech model')).getByRole('option', {
        name: 'piper — standard',
      })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use Cartesia default (Sonic 3.5)' })).toBeEnabled();
  });
});
