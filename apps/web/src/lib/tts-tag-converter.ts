/**
 * Explicit TTS tag converter — converts script inline markup to provider-native
 * format only when the caller supplies an AI runtime.
 *
 * Provider-specific formatting docs are fetched and cached (see tts-doc-fetcher.ts).
 */
import { createAIProvider } from './providers/ai';
import { loadAndRender } from './prompt-loader';
import { getProviderMeta, type TtsProviderId } from './providers/tts-registry';
import type { AiProviderId } from './providers/ai-registry';
import { fetchProviderDocs } from './tts-doc-fetcher';
import { logUsage } from './usage-logger';
import { logger } from './logger';

interface ScriptTurn {
  speaker: string;
  text: string;
  direction?: string;
}

export interface TtsTagConversionOptions {
  mode?: 'disabled' | 'ai';
  podcastId?: string;
  aiProvider?: AiProviderId;
  aiModel?: string;
  apiKeyOverride?: string;
  onError?: 'throw' | 'preserve';
}

export async function convertTurnsForProvider(
  turns: ScriptTurn[],
  providerId: TtsProviderId,
  options: TtsTagConversionOptions = {}
): Promise<ScriptTurn[]> {
  if (options.mode !== 'ai') {
    return turns;
  }
  if (!options.aiProvider || !options.aiModel) {
    throw new Error('AI provider and model are required for TTS tag conversion.');
  }

  const meta = getProviderMeta(providerId);

  try {
    if (!meta.docsUrl) {
      throw new Error(`Provider "${providerId}" does not publish TTS formatting docs.`);
    }

    const docs = await fetchProviderDocs(providerId, meta.docsUrl);
    if (!docs) {
      throw new Error(`No TTS formatting docs available for provider "${providerId}".`);
    }

    const turnsJson = JSON.stringify(turns.map((t) => ({ speaker: t.speaker, text: t.text })));
    const systemPrompt = loadAndRender('audio/tts-tag-converter.md', {
      PROVIDER_NAME: meta.displayName,
      PROVIDER_DOCS: docs,
      TURNS_JSON: turnsJson,
    });

    const response = await createAIProvider(options.aiProvider).generateResponse(
      systemPrompt,
      [{ role: 'user', content: 'Convert the turns above.' }],
      {
        model: options.aiModel,
        maxTokens: 4096,
        skipModeration: true,
        apiKeyOverride: options.apiKeyOverride,
      }
    );

    if (options.podcastId) {
      await logUsage({
        service: options.aiProvider,
        model: response.model,
        category: 'tts-tag-conversion',
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        podcastId: options.podcastId,
      });
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
    logger.error('TTS tag conversion failed', {
      providerId,
      error: err instanceof Error ? err.message : String(err),
    });
    if (options.onError === 'preserve') {
      return turns;
    }
    throw err;
  }
}
