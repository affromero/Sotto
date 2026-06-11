/**
 * prepareClassSource: turn a real link into a CEFR-leveled passage for a sourced
 * class. Reuses the content extractor + the learner's resolved AI. Fails closed
 * (ClassSourceError) on unreadable/thin sources rather than fabricating content.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExtractContent = vi.fn();
vi.mock('@/lib/extractors', () => ({
  extractContent: (...a: unknown[]) => mockExtractContent(...a),
}));

const mockResolveLearningAi = vi.fn();
vi.mock('@/lib/learning-ai', () => ({
  resolveLearningAi: (...a: unknown[]) => mockResolveLearningAi(...a),
}));

const mockGenerateResponse = vi.fn();
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({ generateResponse: (...a: unknown[]) => mockGenerateResponse(...a) }),
}));

vi.mock('@/lib/prompt-loader', () => ({
  loadAndRender: (_path: string, vars: Record<string, string>) => `PROMPT ${JSON.stringify(vars)}`,
}));

vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));

import { prepareClassSource, ClassSourceError } from '@/lib/class-source';

const LONG_TEXT = 'Authentic article text. '.repeat(40); // > 280 chars

function extracted(over: Record<string, unknown> = {}) {
  return {
    text: LONG_TEXT,
    markdown: LONG_TEXT,
    title: 'A Real Article',
    description: null,
    siteName: 'Example News',
    author: 'Jane Doe',
    publishedDate: '2026-06-01',
    wordCount: 200,
    sourceType: 'html',
    extractionMethod: 'readability',
    ...over,
  };
}

describe('prepareClassSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveLearningAi.mockResolvedValue({ provider: 'local', model: 'local:qwen3', apiKey: undefined });
    mockGenerateResponse.mockResolvedValue({
      content: 'Ein angepasster Text auf Niveau B1. '.repeat(6),
      model: 'qwen3',
      inputTokens: 100,
      outputTokens: 80,
    });
  });

  it('extracts, levels, and returns the passage + metadata (no url in metadata)', async () => {
    mockExtractContent.mockResolvedValue(extracted());

    const result = await prepareClassSource({
      url: 'https://example.com/article',
      level: 'B1',
      targetLang: 'de',
      nativeLang: 'en',
      userId: 'u1',
    });

    expect(result.leveledContent).toContain('Niveau B1');
    expect(result.title).toBe('A Real Article');
    expect(result.sourceUrl).toBe('https://example.com/article');
    expect(result.sourceMetadata).toEqual({
      title: 'A Real Article',
      author: 'Jane Doe',
      publishedDate: '2026-06-01',
      siteName: 'Example News',
    });
    // url is carried on sourceUrl, NOT in sourceMetadata (SourceMetadata has no url field)
    expect('url' in result.sourceMetadata).toBe(false);
    // the learner's level + target were passed to the leveling prompt
    const promptVars = JSON.parse((mockGenerateResponse.mock.calls[0][0] as string).replace('PROMPT ', ''));
    expect(promptVars).toMatchObject({ LEVEL: 'B1', TARGET: 'de', NATIVE: 'en', TITLE: 'A Real Article' });
  });

  it('throws ClassSourceError when extraction fails (never fabricates a source)', async () => {
    mockExtractContent.mockRejectedValue(new Error('403 paywall'));
    await expect(
      prepareClassSource({ url: 'https://paywalled.com/x', level: 'A2', targetLang: 'de', nativeLang: 'en', userId: 'u1' }),
    ).rejects.toBeInstanceOf(ClassSourceError);
    expect(mockGenerateResponse).not.toHaveBeenCalled();
  });

  it('throws ClassSourceError when the source has too little readable text', async () => {
    mockExtractContent.mockResolvedValue(extracted({ text: 'too short' }));
    await expect(
      prepareClassSource({ url: 'https://thin.com/x', level: 'B1', targetLang: 'de', nativeLang: 'en', userId: 'u1' }),
    ).rejects.toBeInstanceOf(ClassSourceError);
    expect(mockGenerateResponse).not.toHaveBeenCalled();
  });

  it('throws ClassSourceError when the model returns an empty passage', async () => {
    mockExtractContent.mockResolvedValue(extracted());
    mockGenerateResponse.mockResolvedValue({ content: '  ', model: 'qwen3', inputTokens: 1, outputTokens: 0 });
    await expect(
      prepareClassSource({ url: 'https://example.com/x', level: 'B1', targetLang: 'de', nativeLang: 'en', userId: 'u1' }),
    ).rejects.toBeInstanceOf(ClassSourceError);
  });
});
