// Resolves the AI provider + model for language-learning generation (placement,
// classes, listening, speaking, curriculum). Uses the captured Sidedoor
// credential or the saved keyless backend selection.
import {
  getAiProviderMeta,
  getProviderForModel,
  providerRequiresAiKey,
} from './providers/ai-registry';
import { AccessError } from 'thesidedoor-core/access';
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
import { selectLearningAi, type LearningAiRequest } from '@/lib/learning/ai/selection';

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
  allowSharing: boolean,
  localEndpoint?: string
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
  if (provider === 'local') {
    const selected = await resolveLocalLearningAi(
      model,
      localEndpoint ?? credential?.binding.endpoint
    );
    if (credential && selected.endpoint !== credential.binding.endpoint)
      throw new AccessError('conflict', 'The local AI endpoint changed; review the saved key.');
    return {
      ...selected,
      ...(credential ? { apiKey: sottoExecutionCredentialFields(credential).apiKey } : {}),
      execution: { ...execution, userId, credential },
    };
  }
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

export async function capturedLearningAiOptions(
  ai: CapturedLearningAi,
  options: { includeSourceDocuments?: boolean } = {}
) {
  const moderationCredential = await captureLearningModerationCredential(ai.execution);
  const expectedModeration = ai.execution.learningSelection?.moderationCredentialFingerprint;
  if (
    expectedModeration !== undefined &&
    learningCredentialFingerprint(moderationCredential) !== expectedModeration
  )
    throw new Error(
      'The moderation credential changed after preparation was admitted. Start a new task.'
    );
  let moderation: { fetch: typeof fetch } | undefined;
  if (moderationCredential) {
    const execution = { ...ai.execution, credential: moderationCredential };
    const authorization = `Bearer ${sottoExecutionCredentialFields(moderationCredential).apiKey}`;
    const dispatch: typeof fetch = async (input, init) => {
      const inherited = input instanceof Request ? input.headers : undefined;
      const authenticated = new Headers(init?.headers ?? inherited);
      authenticated.set('authorization', authorization);
      const transport = await createSottoProviderTransport(execution, [
        { url: 'https://api.openai.com/v1/moderations', method: 'POST' },
      ]);
      return transport.authenticatedFetch(input, { ...init, headers: authenticated });
    };
    moderation = { fetch: dispatch };
  }
  return {
    model: ai.model,
    ...(options.includeSourceDocuments && ai.execution.sourceDocuments
      ? { sourceDocuments: ai.execution.sourceDocuments }
      : {}),
    apiKeyOverride: ai.apiKey,
    endpoint: ai.endpoint,
    fetch: await capturedLearningAiFetch(ai),
    moderation,
    signal: ai.execution.signal,
    ...(ai.execution.onCleanupError ? { onCleanupError: ai.execution.onCleanupError } : {}),
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
  pendingSelection?: LearningAiRequest
): Promise<CapturedLearningAi> {
  const captured = execution.learningSelection;
  const request = captured
    ? {
        model: captured.model,
        provider: captured.provider,
        endpoint: captured.endpoint,
        isolatedImage: captured.isolatedImage,
      }
    : pendingSelection;
  const unbound = { ...execution, learningSelection: undefined };
  const preferences = await readLearningAiPreference(userId, unbound);
  const chosen = selectLearningAi(request, preferences);
  const resolved = chosen
    ? await captureRequestedLearningAi(userId, unbound, chosen)
    : await captureConfiguredLearningAi(userId, unbound);
  if (!captured) return resolved;

  const identity = {
    model: resolved.model,
    provider: resolved.provider,
    endpoint: resolved.endpoint,
    isolatedImage: resolved.isolatedImage,
    credentialFingerprint: learningCredentialFingerprint(resolved.execution.credential),
  };
  const unchanged =
    identity.model === captured.model &&
    identity.provider === captured.provider &&
    identity.endpoint === captured.endpoint &&
    identity.isolatedImage === captured.isolatedImage &&
    identity.credentialFingerprint === captured.credentialFingerprint;
  if (!unchanged)
    throw new Error('The AI selection changed after preparation was admitted. Start a new task.');
  return { ...resolved, execution: { ...resolved.execution, learningSelection: captured } };
}

async function readLearningAiPreference(
  userId: string,
  execution: Omit<SottoProviderExecution, 'userId' | 'credential'>
) {
  return sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      execution.signal?.throwIfAborted();
      const authorized = await execution.authorize(database);
      if (authorized.userId !== userId) throw new Error('The selected AI user changed');
      const preference = await database.user.findUnique({
        select: { preferredAiModel: true, preferredAiProvider: true },
        where: { id: authorized.userId },
      });
      execution.signal?.throwIfAborted();
      return preference;
    },
    { signal: execution.signal }
  );
}

async function captureRequestedLearningAi(
  userId: string,
  execution: Omit<SottoProviderExecution, 'userId' | 'credential'>,
  chosen: LearningAiRequest & { provider: AiProviderId }
): Promise<CapturedLearningAi> {
  switch (chosen.provider) {
    case 'claude-code':
    case 'codex': {
      if (await isSystemAiProviderDisabled(chosen.provider))
        throw new Error(`${chosen.provider} is disabled in admin provider settings.`);
      const image = chosen.isolatedImage || process.env.SOTTO_ISOLATED_CLAUDE_IMAGE?.trim();
      if (chosen.provider === 'claude-code' && image) {
        const { captureIsolatedLearningAi } =
          await import('./agents/isolated/isolated-learning-ai');
        const isolated = await captureIsolatedLearningAi(
          userId,
          chosen.model,
          execution,
          chosen.isolatedImage
        );
        if (isolated) return isolated;
      }
      return {
        model: chosen.model,
        provider: chosen.provider,
        execution: { ...execution, userId },
      };
    }
    default:
      return resolveCapturedLearningAiForProvider(
        userId,
        chosen.provider,
        chosen.model,
        execution,
        false,
        chosen.endpoint
      );
  }
}

async function captureConfiguredLearningAi(
  userId: string,
  execution: Omit<SottoProviderExecution, 'userId' | 'credential'>
): Promise<CapturedLearningAi> {
  const configured = await getAutoModelConfig();
  const cli = configured.model.aiProvider;
  if (cli === 'claude-code' || cli === 'codex') {
    const defaults = await resolveLearningAiWithKey(null, configured);
    return captureRequestedLearningAi(userId, execution, {
      provider: cli,
      model: defaults.model,
    });
  }
  const credential = await sottoTransaction(
    prismaUnfiltered,
    (database) =>
      capturePreferredSottoExecutionCredential(
        database,
        execution.authorize,
        'ai',
        false,
        'anthropic',
        execution.signal
      ),
    { signal: execution.signal }
  );
  if (credential && credential.recipient.userId !== userId)
    throw new Error('The selected AI credential recipient changed');
  const key = credential && {
    apiKey: sottoExecutionCredentialFields(credential).apiKey,
    provider: credential.provider as AiProviderId,
  };
  const selected = await resolveLearningAiWithKey(key);
  return {
    ...selected,
    ...(credential ? { endpoint: credential.binding.endpoint } : {}),
    execution: { ...execution, userId, credential },
  };
}

/**
 * The owner-configured default model for `provider` (from the onboarding wizard
 * or /admin/providers), or null if none is configured for this provider, the
 * configured model belongs to a different provider, or the config can't be read.
 */
type LearningModelConfiguration = Awaited<ReturnType<typeof getAutoModelConfig>>;

async function configuredModelFor(
  provider: string,
  snapshot?: LearningModelConfiguration
): Promise<string | null> {
  const cfg = snapshot ?? (await getAutoModelConfig());
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
  aiKey: { provider: AiProviderId; apiKey: string } | null,
  snapshot?: LearningModelConfiguration
): Promise<ResolvedLearningAi> {
  if (aiKey) {
    if (aiKey.provider === 'local') {
      const configured = await getServerInfra();
      if (configured.aiProvider?.trim() !== 'local')
        throw new Error('Select a local AI model in Settings before using the saved local key.');
      return {
        ...(await resolveLocalLearningAi(configured.aiModel ?? '', configured.aiBaseUrl ?? '')),
        apiKey: aiKey.apiKey,
      };
    }
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
  const configured = snapshot ?? (await getAutoModelConfig());
  const selectedKeylessProvider =
    configured.model.aiProvider === 'claude-code' || configured.model.aiProvider === 'codex'
      ? configured.model.aiProvider
      : null;
  const selectedProvider = selectedKeylessProvider ?? (infra('aiProvider') ?? '').trim();
  if (selectedProvider === 'claude-code') {
    if (resolveDisabledSystemAiProviders(configured).has('claude-code')) {
      throw new Error('Claude Code is disabled in admin provider settings.');
    }
    // Use the saved model, then the provider default.
    const modelFromConfiguration = await configuredModelFor('claude-code', configured);
    const infraModel = infra('aiModel');
    const model =
      normalizeAgentModelId('claude-code', modelFromConfiguration ?? infraModel) ??
      getAiProviderMeta('claude-code').defaultModel;
    if (!model) throw new Error('No default model configured for claude-code.');
    return { provider: 'claude-code', model };
  }

  if (selectedProvider === 'codex') {
    if (resolveDisabledSystemAiProviders(configured).has('codex')) {
      throw new Error('Codex is disabled in admin provider settings.');
    }
    const modelFromConfiguration = await configuredModelFor('codex', configured);
    const infraModel = infra('aiModel');
    const model = normalizeAgentModelId('codex', modelFromConfiguration ?? infraModel) ?? 'codex';
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
