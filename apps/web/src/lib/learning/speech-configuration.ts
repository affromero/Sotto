import { createHash } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import type { SkillRequirements } from '@sotto/shared';
import { resolveSkillRequirementsInTransaction } from './skill-requirements';
import { getSiteConfig } from '../site-config';
import {
  captureSottoExecutionCredential,
  type CredentialExecutionAuthority,
} from '../sidedoor/credentials/runtime/credential-execution';
import { learningCredentialFingerprint } from '../classes/preparation-selection';
import { isSpeechDisabled } from '../providers/tts';

/** Hash selected speech configuration and immutable credential metadata without secrets. */
export async function learningSpeechFingerprint(
  database: Prisma.TransactionClient,
  authorize: CredentialExecutionAuthority,
  requirements: SkillRequirements,
  signal?: AbortSignal
): Promise<string> {
  const actor = await authorize(database);
  const user = await database.user.findUniqueOrThrow({
    where: { id: actor.userId },
    select: { preferredTtsModel: true, preferredSttModel: true, preferredTtsProvider: true },
  });
  const configuration = await getSiteConfig({ database });
  const selected = await resolveSkillRequirementsInTransaction(
    database,
    { userId: actor.userId, authorize, signal },
    requirements
  );
  if (
    selected.ttsProvider !== requirements.ttsProvider ||
    selected.sttProvider !== requirements.sttProvider
  )
    throw new Error('The selected speech provider changed or its required access is unavailable.');
  const fingerprints: Record<string, unknown> = {};
  if (isSpeechDisabled(user)) fingerprints.audioDisabled = true;
  for (const [scope, provider] of [
    ['tts', requirements.ttsProvider],
    ['stt', requirements.sttProvider],
  ] as const) {
    if (!provider) continue;
    const credential = await captureSottoExecutionCredential(
      database,
      authorize,
      scope,
      provider,
      true,
      signal
    );
    if (!credential && provider !== 'local' && !(scope === 'tts' && provider === 'kokoro'))
      throw new Error(`The required ${scope.toUpperCase()} credential is unavailable.`);
    fingerprints[scope] = {
      provider,
      credential: learningCredentialFingerprint(credential),
      model:
        scope === 'tts'
          ? user.preferredTtsModel
          : (user.preferredSttModel ?? configuration.sttModel),
      endpoint:
        provider === 'local' || provider === 'kokoro'
          ? scope === 'tts'
            ? configuration.ttsBaseUrl
            : configuration.sttBaseUrl
          : null,
      voices: scope === 'tts' ? configuration.ttsVoices : null,
    };
  }
  return createHash('sha256').update(JSON.stringify(fingerprints)).digest('hex');
}
