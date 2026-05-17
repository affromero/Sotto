import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGenerateResponse = vi.fn();
const mockCreateAIProvider = vi.fn((_type?: string) => ({
  generateResponse: mockGenerateResponse,
}));
const mockLogUsage = vi.fn();
const mockLoggerWarn = vi.fn();

vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: (type?: string) => mockCreateAIProvider(type),
}));

vi.mock('@/lib/usage-logger', () => ({
  logUsage: (entry: unknown) => mockLogUsage(entry),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: (message: string, data?: unknown) => mockLoggerWarn(message, data),
  },
}));

import { detectLanguage } from '@/lib/language-detect';

describe('detectLanguage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAIProvider.mockReturnValue({ generateResponse: mockGenerateResponse });
    mockGenerateResponse.mockResolvedValue({
      content: 'ES',
      model: 'gpt-5-nano',
      inputTokens: 12,
      outputTokens: 1,
    });
  });

  it('skips short text without selecting a provider', async () => {
    await expect(detectLanguage('too short', {
      providerType: 'openai',
      model: 'gpt-5-nano',
      apiKeyOverride: 'sk-test',
    })).resolves.toBeNull();

    expect(mockCreateAIProvider).not.toHaveBeenCalled();
  });

  it('throws when no explicit AI runtime is provided', async () => {
    await expect(detectLanguage('Esta es una oracion suficientemente larga para detectar idioma.')).rejects.toThrow(
      'AI provider and model are required for language detection.'
    );

    expect(mockCreateAIProvider).not.toHaveBeenCalled();
  });

  it('uses the provided provider, model, and key for classification', async () => {
    await expect(detectLanguage(
      'Esta es una oracion suficientemente larga para detectar idioma.',
      {
        providerType: 'openai',
        model: 'gpt-5-nano',
        apiKeyOverride: 'sk-test',
      }
    )).resolves.toBe('es');

    expect(mockCreateAIProvider).toHaveBeenCalledWith('openai');
    expect(mockGenerateResponse).toHaveBeenCalledWith(
      expect.stringContaining('Return ONLY the ISO 639-1'),
      [{ role: 'user', content: 'Esta es una oracion suficientemente larga para detectar idioma.' }],
      {
        maxTokens: 3,
        model: 'gpt-5-nano',
        apiKeyOverride: 'sk-test',
        skipModeration: true,
      }
    );
    expect(mockLogUsage).toHaveBeenCalledWith({
      service: 'openai',
      model: 'gpt-5-nano',
      category: 'language_detection',
      inputTokens: 12,
      outputTokens: 1,
    });
  });

  it('returns null for unsupported language codes', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: 'zz',
      model: 'gpt-5-nano',
      inputTokens: 12,
      outputTokens: 1,
    });

    await expect(detectLanguage(
      'This is enough text to make a language classification request.',
      { providerType: 'openai', model: 'gpt-5-nano' }
    )).resolves.toBeNull();
  });

  it('logs and skips when the provider fails', async () => {
    const error = new Error('provider down');
    mockGenerateResponse.mockRejectedValue(error);

    await expect(detectLanguage(
      'This is enough text to make a language classification request.',
      { providerType: 'openai', model: 'gpt-5-nano' }
    )).resolves.toBeNull();

    expect(mockLoggerWarn).toHaveBeenCalledWith('Language detection failed, skipping', { error });
  });
});
