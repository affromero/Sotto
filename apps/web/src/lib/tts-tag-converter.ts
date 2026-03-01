/**
 * LLM-based TTS tag converter — converts script inline markup to
 * provider-native format at approve time using the cheapest available model.
 *
 * Provider-specific formatting docs are fetched and cached (see tts-doc-fetcher.ts).
 * On any failure, returns original turns unchanged — the audio worker's
 * cleanTextForTts() strips remaining tags as a safety net.
 */
import { createAIProvider } from './providers/ai';
import { loadAndRender } from './prompt-loader';
import { resolveAutoModel } from './auto-model-config';
import { getProviderMeta, type TtsProviderId } from './providers/tts-registry';
import { fetchProviderDocs } from './tts-doc-fetcher';
import { logUsage } from './usage-logger';
import { logger } from './logger';

interface ScriptTurn {
  speaker: string;
  text: string;
  direction?: string;
}

export async function convertTurnsForProvider(
  turns: ScriptTurn[],
  providerId: TtsProviderId,
  podcastId?: string
): Promise<ScriptTurn[]> {
  const meta = getProviderMeta(providerId);

  // Skip LLM call for providers with no text markup docs — return as-is
  // (audio worker's cleanTextForTts will strip tags)
  if (!meta.docsUrl) return turns;

  const docs = await fetchProviderDocs(providerId, meta.docsUrl);
  if (!docs) {
    logger.warn('No provider docs available, skipping LLM conversion', { providerId });
    return turns;
  }

  const turnsJson = JSON.stringify(turns.map((t) => ({ speaker: t.speaker, text: t.text })));
  const systemPrompt = loadAndRender('audio/tts-tag-converter.md', {
    PROVIDER_NAME: meta.displayName,
    PROVIDER_DOCS: docs,
    TURNS_JSON: turnsJson,
  });

  const autoConfig = await resolveAutoModel('PLATFORM');

  try {
    const response = await createAIProvider(autoConfig.aiProvider).generateResponse(
      systemPrompt,
      [{ role: 'user', content: 'Convert the turns above.' }],
      { model: autoConfig.aiModel, maxTokens: 4096, skipModeration: true }
    );

    if (podcastId) {
      logUsage({
        service: autoConfig.aiProvider,
        model: response.model,
        category: 'tts-tag-conversion',
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        podcastId,
      }).catch(() => {}); // fire-and-forget
    }

    const parsed = JSON.parse(response.content);
    if (!Array.isArray(parsed) || parsed.length !== turns.length) {
      throw new Error(`Expected ${turns.length} turns, got ${Array.isArray(parsed) ? parsed.length : 'non-array'}`);
    }

    return turns.map((original, i) => ({
      ...original,
      text: typeof parsed[i].text === 'string' ? parsed[i].text : original.text,
    }));
  } catch (err) {
    logger.error('LLM tag conversion failed, using original text', {
      providerId,
      error: err instanceof Error ? err.message : String(err),
    });
    return turns; // Graceful fallback — audio worker's cleaner strips tags
  }
}
