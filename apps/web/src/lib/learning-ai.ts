// Resolves the AI provider + model for language-learning generation (placement,
// classes, listening, speaking, curriculum). Prefers the learner's BYOK key;
// otherwise falls back to a server-configured keyless backend — either the local
// agent (AI_PROVIDER=claude-code) or a local OpenAI-compatible inference server
// (AI_PROVIDER=local: Ollama / vLLM / LM Studio). Both are the "no cloud key"
// path and return no apiKey (the CLI / local server authenticates itself).
import { getAiKey } from './byok';
import { getAiProviderMeta } from './providers/ai-registry';

export interface ResolvedLearningAi {
  provider: string;
  model: string;
  /** Undefined for keyless backends (claude-code, local) — they authenticate themselves. */
  apiKey?: string;
}

export async function resolveLearningAi(userId: string): Promise<ResolvedLearningAi> {
  const aiKey = await getAiKey(userId);
  if (aiKey) {
    const model = getAiProviderMeta(aiKey.provider).defaultModel;
    if (!model) throw new Error(`No default AI model configured for provider "${aiKey.provider}".`);
    return { provider: aiKey.provider, model, apiKey: aiKey.apiKey };
  }

  // No BYOK key — fall back to a server-configured keyless backend.
  const envProvider = (process.env.AI_PROVIDER ?? '').trim();
  if (envProvider === 'claude-code') {
    const model = getAiProviderMeta('claude-code').defaultModel;
    if (!model) throw new Error('No default model configured for claude-code.');
    return { provider: 'claude-code', model };
  }

  // Totally-local inference: an OpenAI-compatible server (Ollama / vLLM / LM Studio).
  // The model is host-defined (AI_MODEL) and routed by the "local:" prefix so the
  // llm.ts guardrail does not require it to be a registered model id.
  if (envProvider === 'local') {
    const model = (process.env.AI_MODEL ?? '').trim();
    if (!model) {
      throw new Error(
        'AI_PROVIDER=local requires AI_MODEL (the model your local server serves, e.g. "qwen3", "gemma3", "llama3.3").',
      );
    }
    if (!(process.env.AI_BASE_URL ?? '').trim()) {
      throw new Error(
        'AI_PROVIDER=local requires AI_BASE_URL (e.g. http://localhost:11434/v1 for Ollama, http://localhost:8000/v1 for vLLM).',
      );
    }
    return { provider: 'local', model: `local:${model}` };
  }

  throw new Error(
    'No AI provider available. Set AI_PROVIDER=claude-code for your local Claude/Codex, AI_PROVIDER=local for a local model server (Ollama/vLLM), or add an API key in Settings.',
  );
}
