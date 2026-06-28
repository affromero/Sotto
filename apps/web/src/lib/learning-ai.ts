// Resolves the AI provider + model for language-learning generation (placement,
// classes, listening, speaking, curriculum). Prefers the learner's BYOK key;
// otherwise falls back to a server-configured keyless backend — either the local
// agent (AI_PROVIDER=claude-code) or a local OpenAI-compatible inference server
// (AI_PROVIDER=local: Ollama / vLLM / LM Studio). Both are the "no cloud key"
// path and return no apiKey (the CLI / local server authenticates itself).
import { getAiKey } from './byok';
import { getAiProviderMeta, getProviderForModel } from './providers/ai-registry';
import { getAutoModelConfig, resolveDisabledSystemAiProviders } from './auto-model-config';
import { getServerInfra, infra } from './server-config';
import { logger } from './logger';

export interface ResolvedLearningAi {
  provider: string;
  model: string;
  /** Undefined for keyless backends (claude-code, local) — they authenticate themselves. */
  apiKey?: string;
}

/**
 * The owner-configured default model for `provider` (from the onboarding wizard
 * or /admin/providers), or null if none is configured for this provider, the
 * configured model belongs to a different provider, or the config can't be read.
 */
async function configuredModelFor(provider: string): Promise<string | null> {
  try {
    const cfg = await getAutoModelConfig();
    if (cfg.model.aiProvider === provider && getProviderForModel(cfg.model.aiModel) === provider) {
      return cfg.model.aiModel;
    }
    return null;
  } catch (error) {
    logger.warn('Could not read configured AI model; using provider default', {
      provider,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function isSystemAiProviderDisabled(provider: 'claude-code' | 'codex'): Promise<boolean> {
  try {
    const cfg = await getAutoModelConfig();
    return resolveDisabledSystemAiProviders(cfg).has(provider);
  } catch (error) {
    logger.warn('Could not read system AI provider state; treating provider as enabled', {
      provider,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function resolveLearningAi(userId: string): Promise<ResolvedLearningAi> {
  const aiKey = await getAiKey(userId);
  if (aiKey) {
    // Prefer the owner-configured model for this provider (set via the onboarding
    // wizard or /admin/providers) so a chosen model actually drives generation.
    // If the config can't be read (e.g. DB unavailable), fall back to the
    // provider's registry default — a same-provider model fallback, never a
    // silent provider switch.
    const configured = await configuredModelFor(aiKey.provider);
    const model = configured ?? getAiProviderMeta(aiKey.provider).defaultModel;
    if (!model) throw new Error(`No default AI model configured for provider "${aiKey.provider}".`);
    return { provider: aiKey.provider, model, apiKey: aiKey.apiKey };
  }

  // No BYOK key — fall back to a server-configured keyless backend. The owner's
  // DB infra config wins over env (read-through warms the sync snapshot first);
  // both are explicit selections, never an availability-based fallback.
  await getServerInfra();
  const envProvider = (infra('aiProvider', 'AI_PROVIDER') ?? '').trim();
  if (envProvider === 'claude-code') {
    if (await isSystemAiProviderDisabled('claude-code')) {
      throw new Error('Claude Code is disabled in admin provider settings.');
    }
    // Honor the owner-configured claude-code model (wizard CLI picker / admin),
    // falling back to the registry default (opus).
    const configured = await configuredModelFor('claude-code');
    const model = configured ?? getAiProviderMeta('claude-code').defaultModel;
    if (!model) throw new Error('No default model configured for claude-code.');
    return { provider: 'claude-code', model };
  }

  // Codex CLI — keyless; uses the model configured in the user's Codex setup
  // (the bare "codex" routing sentinel; an explicit model can be set via CODEX_MODEL).
  if (envProvider === 'codex') {
    if (await isSystemAiProviderDisabled('codex')) {
      throw new Error('Codex is disabled in admin provider settings.');
    }
    return { provider: 'codex', model: 'codex' };
  }

  // Totally-local inference: an OpenAI-compatible server (Ollama / vLLM / LM Studio).
  // The model is host-defined (AI_MODEL) and routed by the "local:" prefix so the
  // llm.ts guardrail does not require it to be a registered model id.
  if (envProvider === 'local') {
    const model = (infra('aiModel', 'AI_MODEL') ?? '').trim();
    if (!model) {
      throw new Error(
        'AI_PROVIDER=local requires AI_MODEL (the model your local server serves, e.g. "qwen3", "gemma3", "llama3.3").'
      );
    }
    if (!(infra('aiBaseUrl', 'AI_BASE_URL') ?? '').trim()) {
      throw new Error(
        'AI_PROVIDER=local requires AI_BASE_URL (e.g. http://localhost:11434/v1 for Ollama, http://localhost:8000/v1 for vLLM).'
      );
    }
    return { provider: 'local', model: `local:${model}` };
  }

  throw new Error(
    'No AI provider available. Set AI_PROVIDER=claude-code for your local Claude/Codex, AI_PROVIDER=local for a local model server (Ollama/vLLM), or add an API key in Settings.'
  );
}
