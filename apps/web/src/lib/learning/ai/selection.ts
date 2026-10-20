import { getProviderForModel, type AiProviderId } from '@/lib/providers/ai-registry';

export interface LearningAiRequest {
  provider: string;
  model: string;
  endpoint?: string;
  isolatedImage?: string;
}

/** A pending choice must be valid. An obsolete saved preference uses the existing default policy. */
export function selectLearningAi(
  pending: LearningAiRequest | undefined,
  saved: { preferredAiProvider: string | null; preferredAiModel: string | null } | null
): (Omit<LearningAiRequest, 'provider'> & { provider: AiProviderId }) | null {
  const request =
    pending ??
    (saved?.preferredAiProvider && saved.preferredAiModel
      ? { provider: saved.preferredAiProvider, model: saved.preferredAiModel }
      : null);
  if (!request) return null;
  const provider =
    request.provider === 'local' && request.model.startsWith('local:')
      ? 'local'
      : getProviderForModel(request.model);
  if (provider && provider === request.provider) return { ...request, provider };
  if (pending) throw new Error('The selected AI model does not belong to the selected provider.');
  return null;
}
