import { createAIProvider } from './providers/ai';
import { logUsage } from './usage-logger';
import { logger } from './logger';
import { resolveAutoModel } from './auto-model-config';

const SUPPORTED_CODES = new Set([
  'en', 'es', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh', 'ar',
  'hi', 'ru', 'nl', 'sv', 'pl', 'tr', 'da', 'fi', 'no', 'cs',
  'ro', 'hu', 'el', 'he', 'th', 'vi', 'id', 'ms', 'uk', 'ca',
]);

export async function detectLanguage(text: string): Promise<string | null> {
  if (!text || text.length < 20) return null;

  try {
    const autoConfig = await resolveAutoModel('PLATFORM');
    const sample = text.slice(0, 500);

    const response = await createAIProvider(autoConfig.aiProvider).generateResponse(
      'You are a language classifier. Return ONLY the ISO 639-1 two-letter code (e.g., en, fr, de, es, ja). If uncertain, return "en".',
      [{ role: 'user', content: sample }],
      { maxTokens: 3, model: autoConfig.aiModel, skipModeration: true }
    );

    logUsage({
      service: autoConfig.aiProvider,
      model: response.model,
      category: 'language_detection',
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
    });

    const code = response.content.trim().toLowerCase();
    return SUPPORTED_CODES.has(code) ? code : null;
  } catch (error) {
    logger.warn('Language detection failed, skipping', { error });
    return null;
  }
}
