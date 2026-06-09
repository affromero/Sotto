// Resolves the AI provider + model for language-learning generation (placement,
// classes, listening, speaking, curriculum). Prefers the learner's BYOK key;
// otherwise falls back to the server-configured local agent
// (AI_PROVIDER=claude-code), which needs no key — the "bring your own Claude,
// no key" path. The agent path returns no apiKey (the CLI supplies its own auth).
import { getAiKey } from './byok';
import { getAiProviderMeta } from './providers/ai-registry';

export interface ResolvedLearningAi {
  provider: string;
  model: string;
  /** Undefined for the local-agent (claude-code) path — the CLI authenticates itself. */
  apiKey?: string;
}

export async function resolveLearningAi(userId: string): Promise<ResolvedLearningAi> {
  const aiKey = await getAiKey(userId);
  if (aiKey) {
    const model = getAiProviderMeta(aiKey.provider).defaultModel;
    if (!model) throw new Error(`No default AI model configured for provider "${aiKey.provider}".`);
    return { provider: aiKey.provider, model, apiKey: aiKey.apiKey };
  }

  // No BYOK key — fall back to the server-configured local agent.
  const envProvider = (process.env.AI_PROVIDER ?? '').trim();
  if (envProvider === 'claude-code') {
    const model = getAiProviderMeta('claude-code').defaultModel;
    if (!model) throw new Error('No default model configured for claude-code.');
    return { provider: 'claude-code', model };
  }

  throw new Error(
    'No AI provider available. Set AI_PROVIDER=claude-code to use your local Claude/Codex, or add an API key in Settings.',
  );
}
