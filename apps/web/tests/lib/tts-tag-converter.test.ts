import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerateResponse = vi.fn();
const mockFetchProviderDocs = vi.fn();
const mockLogUsage = vi.fn();

vi.mock('@/lib/llm', () => ({
  generateResponse: (...args: unknown[]) => mockGenerateResponse(...args),
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

vi.mock('@/lib/pricing', () => ({
  getCheapestModel: vi.fn().mockReturnValue('gpt-5-mini'),
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

import { convertTurnsForProvider } from '@/lib/tts-tag-converter';

const sampleTurns = [
  { speaker: 'HOST', text: 'Wait, really? [laughs] That is incredible.' },
  { speaker: 'EXPERT', text: 'Yes! [pause] Let me explain.' },
];

describe('tts-tag-converter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('converts turns when provider has docs (elevenlabs)', async () => {
    mockFetchProviderDocs.mockResolvedValue('ElevenLabs supports [laughs], [sighs], etc.');
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify([
        { speaker: 'HOST', text: 'Wait, really? [laughs] That is incredible.' },
        { speaker: 'EXPERT', text: 'Yes! [pause] Let me explain.' },
      ]),
      inputTokens: 100,
      outputTokens: 50,
      model: 'gpt-5-mini',
    });

    const result = await convertTurnsForProvider(sampleTurns, 'elevenlabs', 'pod-1');

    expect(mockGenerateResponse).toHaveBeenCalledOnce();
    expect(result).toHaveLength(2);
    expect(result[0].speaker).toBe('HOST');
  });

  it('skips LLM call when provider has no docsUrl (openai)', async () => {
    const result = await convertTurnsForProvider(sampleTurns, 'openai', 'pod-1');

    expect(mockFetchProviderDocs).not.toHaveBeenCalled();
    expect(mockGenerateResponse).not.toHaveBeenCalled();
    expect(result).toEqual(sampleTurns);
  });

  it('returns original turns when docs fetch fails', async () => {
    mockFetchProviderDocs.mockResolvedValue(null);

    const result = await convertTurnsForProvider(sampleTurns, 'elevenlabs', 'pod-1');

    expect(mockGenerateResponse).not.toHaveBeenCalled();
    expect(result).toEqual(sampleTurns);
  });

  it('returns original turns when LLM call throws', async () => {
    mockFetchProviderDocs.mockResolvedValue('docs content');
    mockGenerateResponse.mockRejectedValue(new Error('API timeout'));

    const result = await convertTurnsForProvider(sampleTurns, 'elevenlabs', 'pod-1');

    expect(result).toEqual(sampleTurns);
  });

  it('returns original turns when LLM returns malformed JSON', async () => {
    mockFetchProviderDocs.mockResolvedValue('docs content');
    mockGenerateResponse.mockResolvedValue({
      content: 'not valid json at all',
      inputTokens: 100,
      outputTokens: 50,
      model: 'gpt-5-mini',
    });

    const result = await convertTurnsForProvider(sampleTurns, 'elevenlabs', 'pod-1');

    expect(result).toEqual(sampleTurns);
  });

  it('returns original turns when LLM returns wrong turn count', async () => {
    mockFetchProviderDocs.mockResolvedValue('docs content');
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify([{ speaker: 'HOST', text: 'Only one turn' }]),
      inputTokens: 100,
      outputTokens: 50,
      model: 'gpt-5-mini',
    });

    const result = await convertTurnsForProvider(sampleTurns, 'elevenlabs', 'pod-1');

    expect(result).toEqual(sampleTurns);
  });

  it('logs usage with tts-tag-conversion category', async () => {
    mockFetchProviderDocs.mockResolvedValue('docs content');
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify(sampleTurns),
      inputTokens: 200,
      outputTokens: 80,
      model: 'gpt-5-mini',
    });

    await convertTurnsForProvider(sampleTurns, 'elevenlabs', 'pod-1');

    expect(mockLogUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'tts-tag-conversion',
        model: 'gpt-5-mini',
        podcastId: 'pod-1',
      })
    );
  });
});
