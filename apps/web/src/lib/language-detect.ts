import { createAIProvider } from './providers/ai';
import type { AiProviderId } from './providers/ai-registry';
import { logUsage } from './usage-logger';
import { logger } from './logger';
import { SOTTO_LANGUAGE_CODES } from './tts-language-support';

export interface LanguageDetectionAiOptions {
  providerType: AiProviderId;
  model: string;
  apiKeyOverride?: string;
}

export async function detectLanguage(
  text: string,
  ai?: LanguageDetectionAiOptions
): Promise<string | null> {
  if (!text || text.length < 20) return null;
  if (!ai?.providerType || !ai.model) {
    throw new Error('AI provider and model are required for language detection.');
  }

  try {
    const sample = text.slice(0, 500);

    const response = await createAIProvider(ai.providerType).generateResponse(
      'You are a language classifier. Return ONLY the ISO 639-1 two-letter code (e.g., en, fr, de, es, ja). If uncertain, return "en".',
      [{ role: 'user', content: sample }],
      {
        maxTokens: 3,
        model: ai.model,
        apiKeyOverride: ai.apiKeyOverride,
        skipModeration: true,
      }
    );

    logUsage({
      service: ai.providerType,
      model: response.model,
      category: 'language_detection',
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
    });

    const code = response.content.trim().toLowerCase();
    return SOTTO_LANGUAGE_CODES.has(code) ? code : null;
  } catch (error) {
    logger.warn('Language detection failed, skipping', { error });
    return null;
  }
}
