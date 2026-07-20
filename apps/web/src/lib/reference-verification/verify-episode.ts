import { prisma } from '@/lib/prisma';
import { resolveLearningAi } from '@/lib/learning-ai';
import { getAiKey } from '@/lib/byok';
import {
  getProviderForModel,
  providerRequiresAiKey,
  type AiProviderId,
} from '@/lib/providers/ai-registry';
import type { ReferenceInput } from '@/lib/reference-validator';
import { runReferenceVerification } from './pipeline';

async function resolveEpisodeVerificationAi(
  episodeId: string,
  userId: string,
  useAdminCredits: boolean
) {
  const episode = await prisma.episode.findUniqueOrThrow({
    where: { id: episodeId },
    select: { aiModel: true, aiProvider: true },
  });

  if (!episode.aiModel) {
    return resolveLearningAi(userId);
  }

  const provider = getProviderForModel(episode.aiModel) ?? episode.aiProvider;
  if (!provider) {
    throw new Error(`Cannot resolve the AI provider for model "${episode.aiModel}".`);
  }

  const key =
    providerRequiresAiKey(provider) && !useAdminCredits
      ? await getAiKey(userId, provider as AiProviderId)
      : null;
  if (providerRequiresAiKey(provider) && !useAdminCredits && !key) {
    throw new Error(`AI key for provider "${provider}" is required for reference verification.`);
  }

  return { provider, model: episode.aiModel, apiKey: key?.apiKey };
}

export async function verifyEpisodeReferences(
  episodeId: string,
  userId: string,
  topic: string,
  turns: Array<{ speaker: string; text: string }>,
  useAdminCredits = false
): Promise<boolean> {
  const references = await prisma.reference.findMany({ where: { episodeId } });
  if (references.length === 0) return false;

  const ai = await resolveEpisodeVerificationAi(episodeId, userId, Boolean(useAdminCredits));
  const inputs: ReferenceInput[] = references.map((reference) => ({
    id: reference.id,
    number: reference.number,
    title: reference.title,
    authors: reference.authors,
    year: reference.year,
    url: reference.url,
    doi: reference.doi,
    type: reference.type,
  }));

  const { results, rejectedRefIds } = await runReferenceVerification(
    inputs,
    turns,
    topic,
    ai.apiKey,
    ai.model,
    ai.provider,
    references.length
  );

  const verifiedAt = new Date().toISOString();
  let allVerified = rejectedRefIds.size === 0;

  await Promise.all(
    references.map(async (reference) => {
      const result = results.get(reference.id);
      const verified = !rejectedRefIds.has(reference.id) && result?.verdict.status === 'VERIFIED';
      if (!verified) allVerified = false;

      await prisma.reference.update({
        where: { id: reference.id },
        data: {
          contentDomain: result?.domain,
          verificationStatus: verified ? 'VERIFIED' : 'FAILED',
          verificationDetails: {
            checks:
              result?.checks.map((check) => ({
                layer: check.layer,
                passed: check.passed,
                confidence: check.confidence,
                detail: check.detail,
              })) ?? [],
            posterior: result?.score ?? 0,
            verifiedAt,
          },
        },
      });
    })
  );

  return allVerified;
}
