import { beforeEach, describe, expect, it, vi } from 'vitest';
import { convertTurnsForProvider } from '@/lib/tts-tag-converter';

const mockCreateAIProvider = vi.fn();
const mockGenerateResponse = vi.fn();
const mockFetchProviderDocs = vi.fn();
const mockLogUsage = vi.fn();

vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: (provider: string) => mockCreateAIProvider(provider),
}));

vi.mock('@/lib/tts-doc-fetcher', () => ({
  fetchProviderDocs: (...args: unknown[]) => mockFetchProviderDocs(...args),
}));

vi.mock('@/lib/usage-logger', () => ({
  logUsage: (...args: unknown[]) => mockLogUsage(...args),
}));

vi.mock('@/lib/prompt-loader', () => ({
  loadAndRender: vi.fn().mockReturnValue('rendered prompt'),
}));

vi.mock('@/lib/providers/tts-registry', () => ({
  getProviderMeta: vi.fn((id: string) => {
    const metas: Record<string, { displayName: string; docsUrl: string | null }> = {
      elevenlabs: { displayName: 'ElevenLabs', docsUrl: 'https://elevenlabs.io/docs/audio-tags' },
      openai: { displayName: 'OpenAI', docsUrl: null },
      cartesia: { displayName: 'Cartesia', docsUrl: 'https://docs.cartesia.ai/formatting' },
      hume: { displayName: 'Hume AI', docsUrl: 'https://dev.hume.ai/docs/tts-guide' },
    };
    return metas[id] ?? { displayName: id, docsUrl: null };
  }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const sampleTurns = [
  { speaker: 'HOST', text: 'Wait, really? [laughs] That is incredible.' },
  { speaker: 'EXPERT', text: 'Yes! [pause] Let me explain.' },
];

describe('tts-tag-converter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAIProvider.mockReturnValue({ generateResponse: mockGenerateResponse });
    mockLogUsage.mockResolvedValue(undefined);
  });

  it('defaults to disabled conversion without fetching docs or selecting AI', async () => {
    const result = await convertTurnsForProvider(sampleTurns, 'elevenlabs');

    expect(result).toEqual(sampleTurns);
    expect(mockFetchProviderDocs).not.toHaveBeenCalled();
    expect(mockCreateAIProvider).not.toHaveBeenCalled();
  });

  it('also skips conversion when mode is explicitly disabled', async () => {
    const result = await convertTurnsForProvider(sampleTurns, 'elevenlabs', { mode: 'disabled' });

    expect(result).toEqual(sampleTurns);
    expect(mockFetchProviderDocs).not.toHaveBeenCalled();
    expect(mockCreateAIProvider).not.toHaveBeenCalled();
  });

  it('requires an explicit AI provider and model for AI conversion', async () => {
    await expect(
      convertTurnsForProvider(sampleTurns, 'elevenlabs', { mode: 'ai', aiProvider: 'openai' })
    ).rejects.toThrow('AI provider and model are required for TTS tag conversion.');

    expect(mockCreateAIProvider).not.toHaveBeenCalled();
  });

  it('converts turns with the explicit AI runtime', async () => {
    mockFetchProviderDocs.mockResolvedValue('ElevenLabs supports [laughs], [sighs], etc.');
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify([
        { speaker: 'HOST', text: 'Wait, really? <laughs/> That is incredible.' },
        { speaker: 'EXPERT', text: 'Yes! <break time="0.5s" /> Let me explain.' },
      ]),
      inputTokens: 100,
      outputTokens: 50,
      model: 'gpt-5-mini',
    });

    const result = await convertTurnsForProvider(sampleTurns, 'elevenlabs', {
      mode: 'ai',
      aiProvider: 'openai',
      aiModel: 'gpt-5-mini',
      apiKeyOverride: 'openai-key',
      episodeId: 'pod-1',
    });

    expect(mockCreateAIProvider).toHaveBeenCalledWith('openai');
    expect(mockGenerateResponse).toHaveBeenCalledWith(
      'rendered prompt',
      [{ role: 'user', content: 'Convert the turns above.' }],
      {
        model: 'gpt-5-mini',
        maxTokens: 4096,
        skipModeration: true,
        apiKeyOverride: 'openai-key',
      }
    );
    expect(result[0].text).toContain('<laughs/>');
    expect(mockLogUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'openai',
        category: 'tts-tag-conversion',
        model: 'gpt-5-mini',
        episodeId: 'pod-1',
      })
    );
  });

  it('throws in AI mode when provider docs are unavailable', async () => {
    await expect(
      convertTurnsForProvider(sampleTurns, 'openai', {
        mode: 'ai',
        aiProvider: 'openai',
        aiModel: 'gpt-5-mini',
      })
    ).rejects.toThrow('Provider "openai" does not publish TTS formatting docs.');
  });

  it('throws on malformed AI output by default', async () => {
    mockFetchProviderDocs.mockResolvedValue('docs content');
    mockGenerateResponse.mockResolvedValue({
      content: 'not valid json at all',
      inputTokens: 100,
      outputTokens: 50,
      model: 'gpt-5-mini',
    });

    await expect(
      convertTurnsForProvider(sampleTurns, 'elevenlabs', {
        mode: 'ai',
        aiProvider: 'openai',
        aiModel: 'gpt-5-mini',
      })
    ).rejects.toThrow();
  });

  it('preserves turns on conversion failure only when explicitly requested', async () => {
    mockFetchProviderDocs.mockResolvedValue('docs content');
    mockGenerateResponse.mockRejectedValue(new Error('API timeout'));

    const result = await convertTurnsForProvider(sampleTurns, 'elevenlabs', {
      mode: 'ai',
      aiProvider: 'openai',
      aiModel: 'gpt-5-mini',
      onError: 'preserve',
    });

    expect(result).toEqual(sampleTurns);
  });
});
