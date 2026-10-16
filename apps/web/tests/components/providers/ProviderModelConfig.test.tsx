import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProvidersTabs } from '@/app/(admin)/admin/providers/ProvidersTabs';

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const posted: Array<{ url: string; body: Record<string, unknown> }> = [];
const props = {
  autoModels: {
    initialConfig: {
      model: {
        aiProvider: 'openai',
        aiModel: 'gpt-5',
        ttsProvider: 'fish',
        ttsModel: 's2.1-pro-free',
        sttProvider: 'openai',
        sttModel: 'whisper-1',
      },
      platform: { aiProvider: 'openai', aiModel: 'gpt-5' },
      includedModels: null,
      includedTtsModels: null,
      includedSttModels: null,
    },
    aiProviders: [
      {
        id: 'openai',
        displayName: 'OpenAI',
        models: [{ id: 'gpt-5', displayName: 'GPT-5', tier: 'balanced' }],
      },
    ],
    ttsProviders: [
      {
        id: 'fish',
        displayName: 'Fish Audio',
        models: [
          { id: 's2.1-pro-free', displayName: 'S2.1 Pro Free', tier: 'standard' },
          { id: 'drama-3', displayName: 'Drama 3 (paid)', tier: 'ultra' },
        ],
      },
    ],
    sttProviders: [
      {
        id: 'openai',
        displayName: 'OpenAI',
        models: [{ id: 'whisper-1', displayName: 'Whisper', tier: 'fast' }],
      },
    ],
  },
  keys: {
    configuredAiProviders: [],
    configuredTtsProviders: [],
    aiProviderMeta: [],
    ttsProviderMeta: [],
    aiSystemProviders: [],
  },
  testable: { aiProviders: [], ttsProviders: [], sttProviders: [] },
  speech: {
    initialEndpoint: 'http://local-tts:8000',
    initialModel: 'local',
    initialVoices: ['de-thorsten-medium', 'de-kerstin-low'],
    initialMode: 'configured' as const,
    configuredProviderLabel: 'Fish Audio',
    configuredModelLabel: 'S2.1 Pro Free',
    selectedProviderLabel: 'Fish Audio',
    initialUsesConfiguredProvider: true,
    canManageSharedSpeech: true,
  },
};

beforeEach(() => {
  posted.length = 0;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (!init?.body)
      return Response.json({
        provider: 'fish',
        providerLabel: 'Fish Audio',
        creditsBlocked: false,
        canCheckCredits: true,
      });
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    posted.push({ url, body });
    if (url === '/api/v1/admin/test-model')
      return Response.json({
        success: false,
        code: 'PROVIDER_CREDITS_EXHAUSTED',
        error: 'Fish Audio API credits are exhausted.',
      });
    return Response.json(body);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('admin speech configuration', () => {
  it('exposes local speech selection and saves an explicit profile opt-in', async () => {
    render(<ProvidersTabs {...props} />);
    expect(
      screen.getByRole('link', { name: /select local speech or disable audio below/i })
    ).toHaveAttribute('href', '#local-speech-title');
    await screen.findByRole('button', { name: 'Check Fish Audio credits' });
    await userEvent.click(screen.getByRole('button', { name: 'Use local speech' }));
    await screen.findByText('Local speech is selected.');
    expect(posted).toContainEqual({
      url: '/api/v1/settings/local-speech',
      body: {
        mode: 'local',
        endpoint: 'http://local-tts:8000',
        model: 'local',
        voices: ['de-thorsten-medium', 'de-kerstin-low'],
      },
    });
  });

  it('saves the chosen admin model and offers local speech after its credit test fails', async () => {
    render(<ProvidersTabs {...props} />);
    await screen.findByRole('button', { name: 'Check Fish Audio credits' });
    const tts = within(screen.getByRole('region', { name: 'Text-to-speech' }));
    await userEvent.click(tts.getByRole('radio', { name: /Drama 3/ }));
    await screen.findByText('Changes saved');
    await userEvent.click(tts.getByRole('button', { name: 'Test this model' }));
    await tts.findByText('Fish Audio API credits are exhausted.');
    expect(tts.getByRole('link', { name: 'Select local speech or disable audio' })).toHaveAttribute(
      'href',
      '#local-speech-title'
    );
    expect(posted).toContainEqual({
      url: '/api/v1/admin/test-model',
      body: { type: 'tts', provider: 'fish', model: 'drama-3' },
    });
    expect(
      posted.find((entry) => entry.url === '/api/v1/admin/auto-models')?.body.model
    ).toMatchObject({ ttsProvider: 'fish', ttsModel: 'drama-3' });
  });
});
