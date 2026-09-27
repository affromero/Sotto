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
import { learningCredentialFingerprint } from '@/lib/classes/preparation-selection';

interface ResolvedLearningAi {
  provider: string;
  model: string;
  endpoint?: string;
  isolatedImage?: string;
  /** Undefined for keyless backends (claude-code, local) — they authenticate themselves. */
  apiKey?: string;
}

async function resolveLocalLearningAi(
  model?: string,
  endpoint?: string
): Promise<ResolvedLearningAi> {
  const configured = model && endpoint ? null : await getServerInfra();
  const localModel = (model ?? configured?.aiModel ?? '')
    .trim()
    .replace(/^local:/, '')
    .trim();
  if (!localModel) throw new Error('The local AI provider requires a configured local model.');
  const localEndpoint = (endpoint ?? configured?.aiBaseUrl ?? '').trim();
  if (!localEndpoint)
    throw new Error('The local AI provider requires a configured local AI endpoint.');
  return { provider: 'local', model: `local:${localModel}`, endpoint: localEndpoint };
}

/** Capture the exact provider chosen by durable episode policy. */
export async function resolveCapturedLearningAiForProvider(
  userId: string,
  provider: AiProviderId,
  model: string,
  execution: Omit<SottoProviderExecution, 'userId' | 'credential'>,
  allowSharing: boolean
): Promise<CapturedLearningAi> {
  if (provider === 'claude-code' && process.env.SOTTO_ISOLATED_CLAUDE_IMAGE?.trim()) {
    const { captureIsolatedLearningAi } = await import('./agents/isolated/isolated-learning-ai');
    const isolated = await captureIsolatedLearningAi(userId, model, execution);
    if (isolated) return isolated;
  }
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
  if (!credential && provider === 'local')
    return {
      ...(await resolveLocalLearningAi(model)),
      execution: { ...execution, userId, credential },
    };
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
async function capturedLearningAiFetch(ai: CapturedLearningAi): Promise<typeof fetch | undefined> {
  const rules = aiProviderRules(ai.provider, ai.endpoint);
  if (!rules.length) return undefined;
  return (await createSottoProviderTransport(ai.execution, rules)).authenticatedFetch;
}

export function captureLearningModerationCredential(execution: SottoProviderExecution) {
  return sottoTransaction(prismaUnfiltered, (database) =>
    captureSottoExecutionCredential(
      database,
      execution.authorize,
      'ai',
      'openai',
      true,
      execution.signal
    )
  );
}

export async function capturedLearningAiOptions(ai: CapturedLearningAi) {
  const moderationCredential = await captureLearningModerationCredential(ai.execution);
  const expectedModeration = ai.execution.learningSelection?.moderationCredentialFingerprint;
  if (
    expectedModeration !== undefined &&
    learningCredentialFingerprint(moderationCredential) !== expectedModeration
  )
    throw new Error(
      'The moderation credential changed after preparation was admitted. Start a new task.'
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
    ...(ai.isolatedImage
      ? {
          isolated: await (
            await import('./agents/isolated/isolated-learning-ai')
          ).createCapturedIsolatedClaude(ai),
        }
      : {}),
  };
}

/** Bind a saved AI key and its authority revision to the provider transport that will use it. */
export async function resolveCapturedLearningAi(
  userId: string,
  execution: Omit<SottoProviderExecution, 'userId' | 'credential'>,
  pendingSelection?: { provider: string; model: string; endpoint?: string; isolatedImage?: string }
): Promise<CapturedLearningAi> {
  if (execution.learningSelection) {
    const selected = execution.learningSelection;
    const resolved = await resolveCapturedLearningAi(
      userId,
      {
        ...execution,
        learningSelection: undefined,
      },
      {
        provider: selected.provider,
        model: selected.model,
        endpoint: selected.endpoint,
        isolatedImage: selected.isolatedImage,
      }
    );
    if (
      resolved.provider !== selected.provider ||
      resolved.model !== selected.model ||
      resolved.endpoint !== selected.endpoint ||
      resolved.isolatedImage !== selected.isolatedImage ||
      learningCredentialFingerprint(resolved.execution.credential) !==
        selected.credentialFingerprint
    )
      throw new Error('The AI selection changed after preparation was admitted. Start a new task.');
    return { ...resolved, execution: { ...resolved.execution, learningSelection: selected } };
  }
  const learner = await sottoTransaction(prismaUnfiltered, async (database) => {
    const current = await execution.authorize(database);
    if (current.userId !== userId) throw new Error('The selected AI user changed');
    return database.user.findUnique({
      where: { id: userId },
      select: { preferredAiProvider: true, preferredAiModel: true },
    });
  });
  const preferred =
    pendingSelection ??
    (learner?.preferredAiProvider && learner.preferredAiModel
      ? { provider: learner.preferredAiProvider, model: learner.preferredAiModel }
      : null);
  if (preferred?.provider === 'local' && preferred.model.startsWith('local:')) {
    return {
      ...(await resolveLocalLearningAi(preferred.model, preferred.endpoint)),
      execution: { ...execution, userId },
    };
  }
  if (preferred && getProviderForModel(preferred.model) === preferred.provider) {
    if (preferred.provider === 'codex' || preferred.provider === 'claude-code') {
      if (await isSystemAiProviderDisabled(preferred.provider))
        throw new Error(`${preferred.provider} is disabled in admin provider settings.`);
      if (
        preferred.provider === 'claude-code' &&
        (process.env.SOTTO_ISOLATED_CLAUDE_IMAGE?.trim() || pendingSelection?.isolatedImage)
      ) {
        const { captureIsolatedLearningAi } =
          await import('./agents/isolated/isolated-learning-ai');
        const isolated = await captureIsolatedLearningAi(
          userId,
          preferred.model,
          execution,
          pendingSelection?.isolatedImage
        );
        if (isolated) return isolated;
      }
      return {
        provider: preferred.provider,
        model: preferred.model,
        execution: { ...execution, userId },
      };
    }
    return resolveCapturedLearningAiForProvider(
      userId,
      preferred.provider as AiProviderId,
      preferred.model,
      execution,
      false
    );
  }
  if (pendingSelection) {
    throw new Error('The selected AI model does not belong to the selected provider.');
  }
  const configured = await getAutoModelConfig();
  if (configured.model.aiProvider === 'codex' || configured.model.aiProvider === 'claude-code') {
    const selected = await resolveLearningAiWithKey(null);
    if (selected.provider === 'claude-code' && process.env.SOTTO_ISOLATED_CLAUDE_IMAGE?.trim()) {
      const { captureIsolatedLearningAi } = await import('./agents/isolated/isolated-learning-ai');
      const isolated = await captureIsolatedLearningAi(userId, selected.model, execution);
      if (isolated) return isolated;
    }
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
    return resolveLocalLearningAi();
  }

  throw new Error(
    'No AI provider is configured. Select a local CLI or model server, or add an API key in Settings.'
  );
}
