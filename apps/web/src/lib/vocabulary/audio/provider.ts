import { createHash } from 'node:crypto';
import { prismaUnfiltered as prisma } from '../../prisma';
import { getAutoModelConfig } from '../../auto-model-config';
import { resolveTtsProvider, ttsCacheIdentity } from '../../providers/tts';
import type { SottoProviderExecution } from '../../sidedoor/credentials/runtime/provider-execution';
import { VocabularyStudyNotFound, VocabularyStudyUnavailable } from '../study-state';

/** Local is an explicit requirement here. No configured cloud provider is substituted. */
export async function resolveVocabularyAudio(
  courseId: string,
  text: string,
  execution: SottoProviderExecution
) {
  const course = await prisma.course.findFirst({
    where: { id: courseId, userId: execution.userId },
    select: {
      targetLang: true,
      user: { select: { preferredTtsProvider: true, preferredTtsModel: true } },
    },
  });
  if (!course) throw new VocabularyStudyNotFound('Course not found.');
  if (course.user.preferredTtsProvider === 'disabled')
    throw new VocabularyStudyUnavailable('Audio is disabled. Enable local speech in Settings.');
  const settings = await getAutoModelConfig();
  const model =
    course.user.preferredTtsProvider === 'local'
      ? course.user.preferredTtsModel
      : settings.model.ttsProvider === 'local'
        ? settings.model.ttsModel
        : null;
  const resolved = await resolveTtsProvider({
    userId: execution.userId,
    execution,
    episodeId: `vocabulary:${courseId}`,
    requestedProvider: 'local',
    requestedModel: model,
    language: course.targetLang,
  }).catch((error: unknown) => {
    throw new VocabularyStudyUnavailable(
      'Local pronunciation is unavailable. Check the local speech endpoint, model, and voices in Settings.',
      { cause: error }
    );
  });
  const { provider } = resolved;
  if (provider.providerId !== 'local')
    throw new VocabularyStudyUnavailable('Local pronunciation is unavailable.');
  const voiceId = provider.getVoiceId(
    'HOST',
    `vocabulary:${courseId}`,
    undefined,
    course.targetLang
  );
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify([
        'vocabulary-audio-v1',
        ttsCacheIdentity(provider),
        provider.getModelId(),
        voiceId,
        course.targetLang,
        text,
      ])
    )
    .digest('hex');
  return { provider, voiceId, fingerprint, language: course.targetLang };
}
