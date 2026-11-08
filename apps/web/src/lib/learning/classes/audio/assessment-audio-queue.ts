import { isDeepStrictEqual } from 'node:util';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { getAutoModelConfig } from '@/lib/auto-model-config';
import {
  learningSpeechFingerprint,
  matchesLearningSpeechFingerprint,
} from '@/lib/learning/speech-configuration';
import { resolveTtsProvider, selectedTtsModel } from '@/lib/providers/tts';
import { isValidProviderId } from '@/lib/providers/tts-registry';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { durableQueueOperationId } from '@/lib/sidedoor/jobs/core/durable-queue';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { createSegmentsAndQueueAudio } from '@/lib/segment-creator';
import { authoredSectionSchema } from '../generation/assessment-authoring';
import { AssessmentFenceConflict } from '../lifecycle/assessment-fence';
import { requirePendingAssessmentWork } from '../generation/assessment-work';
import { stageAssessmentSection } from '../generation/assessment-draft';
import { requireAssessmentReviewCapacity } from '../review/assessment-review-capacity';
import {
  registerAssessmentAudioLineage,
  validateAssessmentAudioLineage,
} from './assessment-audio-lineage';

/** Admit the one reserved listening generation and redeliver its original children on retry. */
export async function queueAssessmentAudio(input: {
  identity: { id: string; fingerprint: string };
  execution: SottoProviderExecution;
}) {
  const identity = { ...input.identity };
  const execution = { ...input.execution };
  const captured = await sottoTransaction(
    prisma,
    async (database) => {
      const { current } = await requirePendingAssessmentWork(
        database,
        identity,
        execution,
        'RUNNING'
      );
      const section = await database.classAssessmentSection.findUniqueOrThrow({
        where: { assessmentId_skill: { assessmentId: current.assessmentId, skill: 'LISTENING' } },
        include: { episode: true },
      });
      const draft = authoredSectionSchema.parse(section.authoredDraft);
      if (
        draft.skill !== 'LISTENING' ||
        !section.episodeId ||
        !section.episode ||
        current.requirements.skills.LISTENING.state !== 'REQUIRED' ||
        !current.requirements.ttsProvider ||
        !isValidProviderId(current.requirements.ttsProvider)
      )
        throw new AssessmentFenceConflict();
      await stageAssessmentSection(database, identity, execution, draft);
      await requireAssessmentReviewCapacity(database, identity, execution);
      const user = await database.user.findUniqueOrThrow({
        where: { id: current.userId },
        select: { preferredTtsModel: true, preferredTtsProvider: true },
      });
      const model = selectedTtsModel(
        user,
        current.requirements.ttsProvider,
        (await getAutoModelConfig(database)).model
      );
      const speechFingerprint = await learningSpeechFingerprint(
        database,
        execution.authorize,
        current.requirements,
        execution.signal
      );
      return { current, draft, episodeId: section.episodeId, model, speechFingerprint };
    },
    { signal: execution.signal }
  );
  const providerId = captured.current.requirements.ttsProvider;
  if (!providerId || !isValidProviderId(providerId)) throw new AssessmentFenceConflict();
  const authorize: SottoProviderExecution['authorize'] = async (database) => {
    const { current } = await requirePendingAssessmentWork(
      database,
      identity,
      execution,
      'RUNNING'
    );
    await requireAssessmentReviewCapacity(database, identity, execution);
    return { userId: current.userId };
  };
  const resolved = await resolveTtsProvider({
    userId: captured.current.userId,
    execution: { ...execution, authorize },
    episodeId: captured.episodeId,
    requestedProvider: providerId,
    requestedModel: captured.model,
    language: captured.current.requirements.targetLang,
  });
  if (resolved.providerId !== providerId) throw new AssessmentFenceConflict();
  const voices = [...new Set(captured.draft.turns.map((turn) => turn.speaker))]
    .sort()
    .map((speaker) => ({
      speaker,
      provider: resolved.providerId,
      voiceId: resolved.provider.getVoiceId(
        speaker,
        captured.episodeId,
        undefined,
        captured.current.requirements.targetLang
      ),
    }));
  const model = resolved.provider.getModelId();
  if (!model || voices.some((voice) => !voice.voiceId)) throw new AssessmentFenceConflict();
  const generationKey = durableQueueOperationId(
    'assessment-audio',
    `${identity.id}:${captured.episodeId}`
  );
  await createSegmentsAndQueueAudio(captured.episodeId, captured.draft.turns, {
    authorize,
    reservation: {
      generationKey,
      reconcile: async (database, key) => {
        const { current } = await requirePendingAssessmentWork(
          database,
          identity,
          execution,
          'RUNNING'
        );
        await database.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${current.assessmentId} FOR UPDATE`;
        await database.$queryRaw`SELECT id FROM "Episode" WHERE id = ${captured.episodeId} FOR UPDATE`;
        const episode = await database.episode.findUniqueOrThrow({
          where: { id: captured.episodeId },
          include: { voices: true, segments: true },
        });
        if (
          !(await matchesLearningSpeechFingerprint(
            database,
            execution.authorize,
            current.requirements,
            captured.speechFingerprint,
            execution.signal
          ))
        )
          throw new AssessmentFenceConflict();
        await stageAssessmentSection(database, identity, execution, captured.draft);
        if (episode.audioGenerationKey === key) {
          await validateAssessmentAudioLineage(database, episode.id, key);
          return 'REPLAY';
        }
        if (
          episode.status !== 'SCRIPT_READY' ||
          episode.audioGenerationKey !== null ||
          episode.ttsProvider !== null ||
          episode.ttsModel !== null ||
          episode.voices.length ||
          episode.segments.length ||
          !isDeepStrictEqual(current.requirements, captured.current.requirements)
        )
          throw new AssessmentFenceConflict();
        await database.episode.update({
          where: { id: episode.id },
          data: { ttsProvider: providerId, ttsModel: model },
        });
        await database.episodeVoice.createMany({
          data: voices.map((voice) => ({ episodeId: episode.id, ...voice })),
        });
        return 'CREATE';
      },
    },
    onPrepared: (database, key) =>
      registerAssessmentAudioLineage(database, {
        identity,
        execution,
        episodeId: captured.episodeId,
        generationKey: key,
        speechFingerprint: captured.speechFingerprint,
      }).then(() => undefined),
  });
  return { episodeId: captured.episodeId, generationKey };
}
