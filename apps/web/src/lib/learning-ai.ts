// Resolves the AI provider + model for language-learning generation (placement,
// classes, listening, speaking, curriculum). Uses the captured Sidedoor
// credential or the saved keyless backend selection.
import {
  getAiProviderMeta,
  getProviderForModel,
  providerRequiresAiKey,
} from './providers/ai-registry';
import type { AiProviderId } from './providers/ai-registry';
import { getAutoModelConfig, resolveDisabledSystemAiProviders } from './auto-model-config';
import { getServerInfra, infra } from './server-config';
import { normalizeAgentModelId } from './agent-models/id';
import { prismaUnfiltered } from './prisma';
import {
  capturePreferredSottoExecutionCredential,
  captureSottoExecutionCredential,
  sottoExecutionCredentialFields,
} from '@/lib/sidedoor/credentials/runtime/credential-execution';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { aiProviderRules } from './providers/ai';
import { createSottoProviderTransport } from '@/lib/sidedoor/credentials/runtime/provider-execution';

export interface ResolvedLearningAi {
  provider: string;
  model: string;
  endpoint?: string;
  /** Undefined for keyless backends (claude-code, local) — they authenticate themselves. */
  apiKey?: string;
}

/** Capture the exact provider chosen by durable episode policy. */
export async function resolveCapturedLearningAiForProvider(
  userId: string,
  provider: AiProviderId,
  model: string,
  execution: Omit<SottoProviderExecution, 'userId' | 'credential'>,
  allowSharing: boolean
): Promise<CapturedLearningAi> {
  const credential = await sottoTransaction(prismaUnfiltered, (database) =>
    captureSottoExecutionCredential(
      database,
      execution.authorize,
      'ai',
      provider,
      allowSharing,
      execution.signal
    )
  );
  if (credential?.recipient.userId !== undefined && credential.recipient.userId !== userId)
    throw new Error('The selected AI credential recipient changed');
  if (!credential && providerRequiresAiKey(provider))
    throw new Error(`AI credential for provider "${provider}" is required.`);
  return {
    provider,
    model,
    ...(credential ? { endpoint: credential.binding.endpoint } : {}),
    ...(credential ? { apiKey: sottoExecutionCredentialFields(credential).apiKey } : {}),
    execution: { ...execution, userId, credential },
  };
}

export interface CapturedLearningAi extends ResolvedLearningAi {
  execution: SottoProviderExecution;
}

/** Resolve the exact model and credential admitted for a durable episode operation. */
export async function resolveCapturedEpisodeAi(options: {
  userId: string;
  aiModel: string | null;
  aiProvider: string | null;
  allowSharing: boolean;
  execution: Omit<SottoProviderExecution, 'userId' | 'credential'>;
}): Promise<CapturedLearningAi> {
  if (!options.aiModel) return resolveCapturedLearningAi(options.userId, options.execution);
  const provider = getProviderForModel(options.aiModel) ?? options.aiProvider;
  if (!provider) throw new Error(`Cannot resolve the AI provider for model "${options.aiModel}".`);
  return resolveCapturedLearningAiForProvider(
    options.userId,
    provider as AiProviderId,
    options.aiModel,
    options.execution,
    options.allowSharing
  );
}

/** The only HTTP boundary for a captured learning-model selection. */
export async function capturedLearningAiFetch(
  ai: CapturedLearningAi
): Promise<typeof fetch | undefined> {
  const rules = aiProviderRules(ai.provider, ai.endpoint);
  if (!rules.length) return undefined;
  return (await createSottoProviderTransport(ai.execution, rules)).authenticatedFetch;
}

export async function capturedLearningAiOptions(ai: CapturedLearningAi) {
  const moderationCredential = await sottoTransaction(prismaUnfiltered, (database) =>
    captureSottoExecutionCredential(
      database,
      ai.execution.authorize,
      'ai',
      'openai',
      true,
      ai.execution.signal
    )
  );
  const moderation = moderationCredential
    ? {
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          const headers = new Headers(init?.headers);
          headers.set(
            'Authorization',
            `Bearer ${sottoExecutionCredentialFields(moderationCredential).apiKey}`
          );
          return (
            await createSottoProviderTransport(
              { ...ai.execution, credential: moderationCredential },
              [{ method: 'POST', url: 'https://api.openai.com/v1/moderations' }]
            )
          ).authenticatedFetch(input, { ...init, headers });
        }) as typeof fetch,
      }
    : undefined;
  return {
    model: ai.model,
    apiKeyOverride: ai.apiKey,
    endpoint: ai.endpoint,
    fetch: await capturedLearningAiFetch(ai),
    moderation,
    signal: ai.execution.signal,
  };
}

/** Bind a saved AI key and its authority revision to the provider transport that will use it. */
export async function resolveCapturedLearningAi(
  userId: string,
  execution: Omit<SottoProviderExecution, 'userId' | 'credential'>
): Promise<CapturedLearningAi> {
  const learner = await sottoTransaction(prismaUnfiltered, async (database) => {
    const current = await execution.authorize(database);
    if (current.userId !== userId) throw new Error('The selected AI user changed');
    return database.user.findUnique({
      where: { id: userId },
      select: { preferredAiProvider: true, preferredAiModel: true },
    });
  });
  if (
    (learner?.preferredAiProvider === 'codex' ||
      learner?.preferredAiProvider === 'claude-code') &&
    learner.preferredAiModel &&
    getProviderForModel(learner.preferredAiModel) === learner.preferredAiProvider
  ) {
    if (await isSystemAiProviderDisabled(learner.preferredAiProvider))
      throw new Error(`${learner.preferredAiProvider} is disabled in admin provider settings.`);
    return {
      provider: learner.preferredAiProvider,
      model: learner.preferredAiModel,
      execution: { ...execution, userId },
    };
  }
  const configured = await getAutoModelConfig();
  if (configured.model.aiProvider === 'codex' || configured.model.aiProvider === 'claude-code') {
    const selected = await resolveLearningAiWithKey(null);
    return { ...selected, execution: { ...execution, userId } };
  }
  const credential = await sottoTransaction(prismaUnfiltered, (database) =>
    capturePreferredSottoExecutionCredential(
      database,
      execution.authorize,
      'ai',
      false,
      'anthropic',
      execution.signal
    )
  );
  const selected = credential
    ? await resolveLearningAiWithKey({
        provider: credential.provider as AiProviderId,
        apiKey: sottoExecutionCredentialFields(credential).apiKey,
      })
    : await resolveLearningAiWithKey(null);
  if (!credential) return { ...selected, execution: { ...execution, userId } };
  if (credential.recipient.userId !== userId)
    throw new Error('The selected AI credential recipient changed');
  return {
    provider: selected.provider,
    model: selected.model,
    endpoint: credential.binding.endpoint,
    apiKey: sottoExecutionCredentialFields(credential).apiKey,
    execution: { ...execution, userId, credential },
  };
}

/**
 * The owner-configured default model for `provider` (from the onboarding wizard
 * or /admin/providers), or null if none is configured for this provider, the
 * configured model belongs to a different provider, or the config can't be read.
 */
async function configuredModelFor(provider: string): Promise<string | null> {
  const cfg = await getAutoModelConfig();
  if (cfg.model.aiProvider === provider && getProviderForModel(cfg.model.aiModel) === provider) {
    return cfg.model.aiModel;
  }
  return null;
}

async function isSystemAiProviderDisabled(provider: 'claude-code' | 'codex'): Promise<boolean> {
  const cfg = await getAutoModelConfig();
  return resolveDisabledSystemAiProviders(cfg).has(provider);
}

async function resolveLearningAiWithKey(
  aiKey: { provider: AiProviderId; apiKey: string } | null
): Promise<ResolvedLearningAi> {
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

  // A keyless backend must be explicitly selected in the saved configuration.
  await getServerInfra();
  const configured = await getAutoModelConfig();
  const selectedKeylessProvider =
    configured.model.aiProvider === 'claude-code' || configured.model.aiProvider === 'codex'
      ? configured.model.aiProvider
      : null;
  const selectedProvider = selectedKeylessProvider ?? (infra('aiProvider') ?? '').trim();
  if (selectedProvider === 'claude-code') {
    if (await isSystemAiProviderDisabled('claude-code')) {
      throw new Error('Claude Code is disabled in admin provider settings.');
    }
    // Use the saved model, then the provider default.
    const configured = await configuredModelFor('claude-code');
    const infraModel = infra('aiModel');
    const model =
      normalizeAgentModelId('claude-code', configured ?? infraModel) ??
      getAiProviderMeta('claude-code').defaultModel;
    if (!model) throw new Error('No default model configured for claude-code.');
    return { provider: 'claude-code', model };
  }

  if (selectedProvider === 'codex') {
    if (await isSystemAiProviderDisabled('codex')) {
      throw new Error('Codex is disabled in admin provider settings.');
    }
    const configured = await configuredModelFor('codex');
    const infraModel = infra('aiModel');
    const model = normalizeAgentModelId('codex', configured ?? infraModel) ?? 'codex';
    return { provider: 'codex', model };
  }

  // Totally-local inference: an OpenAI-compatible server (Ollama / vLLM / LM Studio).
  // The model is selected in shared configuration and routed by the "local:" prefix so the
  // llm.ts guardrail does not require it to be a registered model id.
  if (selectedProvider === 'local') {
    const model = (infra('aiModel') ?? '').trim();
    if (!model) {
      throw new Error(
        'The local AI provider requires a configured local model (for example "qwen3", "gemma3", or "llama3.3").'
      );
    }
    if (!(infra('aiBaseUrl') ?? '').trim()) {
      throw new Error(
        'The local AI provider requires a configured local AI endpoint (for example http://localhost:11434/v1 for Ollama).'
      );
    }
    return { provider: 'local', model: `local:${model}` };
  }

  throw new Error(
    'No AI provider is configured. Select a local CLI or model server, or add an API key in Settings.'
  );
}
