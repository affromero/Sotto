import { generateResponse, streamResponse } from './llm';
import { createAIProvider } from './providers/ai';
import { CONTENT_SAFETY_INSTRUCTIONS, INPUT_SANITIZATION_INSTRUCTIONS } from './safety-prompts';
import { loadPrompt } from './prompt-loader';
export { detectUrls } from './detect-urls';

/**
 * System prompt for the discovery chat agent
 */
const DISCOVERY_SYSTEM_PROMPT = loadPrompt('discovery/agent.md') + CONTENT_SAFETY_INSTRUCTIONS + INPUT_SANITIZATION_INSTRUCTIONS;

/**
 * Parse chip suggestions from agent message
 */
export function parseChips(message: string): { text: string; chips: string[] } {
  const chipMatch = message.match(/\[chips:\s*(.+?)\]/);
  if (!chipMatch) {
    return { text: message, chips: [] };
  }

  const chips = chipMatch[1].split('·').map((c) => c.trim());
  const text = message.replace(/\[chips:\s*.+?\]/, '').trim();

  return { text, chips };
}

/**
 * Parse metadata from agent's final message
 */
export function parseMetadata(
  message: string
): {
  topic: string;
  depth: string;
  audience_level: string;
  audience: string;
  focus_areas: string[];
  tone: string;
  duration_target: number;
  verification_mode?: string;
  ready: boolean;
} | null {
  const metadataMatch = message.match(/\[METADATA\]\s*([\s\S]*?)\s*\[\/METADATA\]/);
  if (!metadataMatch) return null;

  try {
    return JSON.parse(metadataMatch[1]);
  } catch {
    return null;
  }
}

/**
 * Generate a discovery chat response (non-streaming)
 */
export async function getDiscoveryResponse(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  apiKeyOverride?: string,
  model?: string
): Promise<{ content: string; inputTokens: number; outputTokens: number; model: string }> {
  return generateResponse(DISCOVERY_SYSTEM_PROMPT, messages, {
    maxTokens: 2048,
    apiKeyOverride,
    model,
  });
}

/**
 * Fallback system prompt used when the main discovery agent returns an empty response.
 * Suggests concrete podcast angles based on the user's original message without requiring
 * the full structured conversation format.
 */
const FALLBACK_SYSTEM_PROMPT = loadPrompt('discovery/fallback.md');

/**
 * Stream a fallback response when the main discovery agent returns nothing visible.
 * Takes only the user's latest message (no history) and suggests podcast angles.
 */
export function streamFallbackDiscoveryResponse(
  userMessage: string,
  apiKeyOverride?: string,
  model?: string,
  onComplete?: (usage: { inputTokens: number; outputTokens: number; model: string }) => void,
  providerType?: string
): AsyncGenerator<string> {
  const messages = [{ role: 'user' as const, content: userMessage }];
  if (providerType && providerType !== 'anthropic' && providerType !== 'claude-code') {
    const provider = createAIProvider(providerType);
    async function* gen() {
      yield* provider.streamResponse(FALLBACK_SYSTEM_PROMPT, messages, {
        maxTokens: 512,
        apiKeyOverride,
        model,
      });
      onComplete?.({ inputTokens: 0, outputTokens: 0, model: model ?? providerType ?? 'unknown' });
    }
    return gen();
  }
  return streamResponse(FALLBACK_SYSTEM_PROMPT, messages, {
    maxTokens: 512,
    apiKeyOverride,
    model,
    onComplete,
  });
}

/**
 * Stream a discovery chat response.
 * When providerType is 'anthropic' or unset, uses the optimised claude.ts path (with onComplete).
 * For other providers (openai, groq, etc.) routes via the provider-agnostic AIProvider interface.
 */
export function streamDiscoveryResponse(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  apiKeyOverride?: string,
  model?: string,
  onComplete?: (usage: { inputTokens: number; outputTokens: number; model: string }) => void,
  providerType?: string,
  systemSuffix?: string,
): AsyncGenerator<string> {
  const systemPrompt = systemSuffix
    ? DISCOVERY_SYSTEM_PROMPT + '\n\n' + systemSuffix
    : DISCOVERY_SYSTEM_PROMPT;
  if (providerType && providerType !== 'anthropic' && providerType !== 'claude-code') {
    const provider = createAIProvider(providerType);
    async function* gen() {
      yield* provider.streamResponse(systemPrompt, messages, {
        maxTokens: 2048,
        apiKeyOverride,
        model,
      });
      onComplete?.({ inputTokens: 0, outputTokens: 0, model: model ?? providerType ?? 'unknown' });
    }
    return gen();
  }
  return streamResponse(systemPrompt, messages, {
    maxTokens: 2048,
    apiKeyOverride,
    model,
    onComplete,
  });
}
