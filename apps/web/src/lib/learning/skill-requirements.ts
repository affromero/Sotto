import {
  createSkillRequirements,
  skillRequirementsSchema,
  type SkillRequirements,
} from '@sotto/shared';
import { prismaUnfiltered } from '../prisma';
import { getSiteConfig } from '../site-config';
import { isValidProviderId } from '../providers/tts-registry';
import { isValidSttProviderId } from '../providers/stt-registry';
import { resolveSottoProfileCredential } from '../sidedoor/credentials/runtime/provider-credentials';
import type { SottoProviderExecution } from '../sidedoor/credentials/runtime/provider-execution';
import { sottoTransaction } from '../sidedoor/access/state/transaction';
import type { Prisma } from '@/generated/prisma/client';

export class LearningConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LearningConfigurationError';
  }
}

/** Inspect exact selected access without dispatching provider requests or recording use. */
export async function resolveSkillRequirements(
  execution: SottoProviderExecution,
  context: Pick<SkillRequirements, 'scope' | 'nativeLang' | 'targetLang' | 'level'>
): Promise<SkillRequirements> {
  return sottoTransaction(
    prismaUnfiltered,
    (database) => resolveSkillRequirementsInTransaction(database, execution, context),
    { signal: execution.signal }
  );
}

export async function resolveSkillRequirementsInTransaction(
  database: Prisma.TransactionClient,
  execution: SottoProviderExecution,
  context: Pick<SkillRequirements, 'scope' | 'nativeLang' | 'targetLang' | 'level'>
): Promise<SkillRequirements> {
  const recipient = await execution.authorize(database);
  if (recipient.userId !== execution.userId)
    throw new LearningConfigurationError('Learning recipient changed.');
  const configuration = await getSiteConfig({ database });
  const user = await database.user.findUnique({
    where: { id: recipient.userId },
    select: { preferredTtsProvider: true },
  });
  if (!user) throw new LearningConfigurationError('Learner no longer exists.');
  const wantsTts = ['CLASS', 'FULL', 'LISTENING', 'SPEAKING'].includes(context.scope);
  const wantsStt = ['CLASS', 'FULL', 'SPEAKING'].includes(context.scope);
  const selectedTts = wantsTts
    ? user.preferredTtsProvider?.trim() || configuration.ttsProvider?.trim() || null
    : null;
  const selectedStt = wantsStt ? configuration.sttProvider?.trim() || null : null;
  if (selectedTts && !isValidProviderId(selectedTts))
    throw new LearningConfigurationError(
      'The saved TTS provider is invalid. Review provider settings.'
    );
  if (selectedStt && !isValidSttProviderId(selectedStt))
    throw new LearningConfigurationError(
      'The saved STT provider is invalid. Review provider settings.'
    );

  const available = async (
    scope: 'tts' | 'stt',
    provider: string | null
  ): Promise<string | null> => {
    if (!provider) return null;
    if (provider === 'local' || (scope === 'tts' && provider === 'kokoro')) {
      const endpoint = scope === 'tts' ? configuration.ttsBaseUrl : configuration.sttBaseUrl;
      if (!endpoint?.trim())
        throw new LearningConfigurationError(
          `The selected local ${scope.toUpperCase()} provider needs a saved endpoint.`
        );
      let url: URL;
      try {
        url = new URL(endpoint);
      } catch {
        throw new LearningConfigurationError(
          `The selected local ${scope.toUpperCase()} endpoint is invalid.`
        );
      }
      if (!['http:', 'https:'].includes(url.protocol))
        throw new LearningConfigurationError(
          `The selected local ${scope.toUpperCase()} endpoint must use HTTP or HTTPS.`
        );
      return provider;
    }
    const credential = await resolveSottoProfileCredential(
      database,
      recipient.userId,
      scope,
      provider,
      true
    );
    return credential ? provider : null;
  };
  const ttsProvider = await available('tts', selectedTts);
  const sttProvider = await available('stt', selectedStt);
  execution.signal?.throwIfAborted();
  return createSkillRequirements({ ...context, ttsProvider, sttProvider });
}

/** Invalid persisted metadata must never silently become an exempt legacy session. */
export function readSkillRequirements(value: unknown): SkillRequirements | null {
  if (value === null || value === undefined) return null;
  return skillRequirementsSchema.parse(value);
}
