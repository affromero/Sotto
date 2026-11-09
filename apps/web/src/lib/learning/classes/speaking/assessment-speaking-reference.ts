import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { getAutoModelConfig } from '@/lib/auto-model-config';
import { detectAudioFormat, isRecognizedAudio } from '@/lib/audio-format';
import { measureTtsAudio } from '@/lib/audio/tts-media';
import { resolveTtsProvider, selectedTtsModel } from '@/lib/providers/tts';
import { isValidProviderId } from '@/lib/providers/tts-registry';
import { learningSpeechFingerprint } from '@/lib/learning/speech-configuration';
import { learningProviderInputHash } from '@/lib/learning/preparation/identity';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  assertSottoExecutionOperation,
  verifySottoExecutionOperation,
  type SottoJobExecutionOperation,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { captureSpeakingPromptStorage } from '@/lib/sidedoor/storage/core/speaking-storage';
import { resolveStorageInput } from '@/lib/sidedoor/storage/core/storage-inputs';
import { writeStorageReference } from '@/lib/sidedoor/storage/core/storage-write';
import { assessmentSpeakingReferenceSchema } from '../material/assessment-audio';
import { validateAssessmentAudioLineage } from '../audio/assessment-audio-lineage';
import { AssessmentFenceConflict } from '../lifecycle/assessment-fence';
import { requirePendingAssessmentWork } from '../generation/assessment-work';

type Identity = { id: string; fingerprint: string };
type Audio = { episodeId: string; generationKey: string };

/** Produce each required reference once, bound to the staged assessment and its audio freeze. */
export async function ensureAssessmentSpeakingReferences(input: {
  identity: Identity;
  execution: SottoProviderExecution;
  operation: SottoJobExecutionOperation;
  audio: Audio;
  unresolved: () => void;
}) {
  const identity = { ...input.identity };
  const execution = { ...input.execution };
  const audio = { ...input.audio };
  const signal = execution.signal ?? new AbortController().signal;
  const expected = { parentId: identity.id, fingerprint: identity.fingerprint };
  const capture = async (database: Prisma.TransactionClient) => {
    const { current } = await requirePendingAssessmentWork(
      database,
      identity,
      execution,
      'RUNNING'
    );
    await verifySottoExecutionOperation(database, input.operation, expected);
    if (
      !current.requirements.referenceAudioRequired ||
      !current.requirements.ttsProvider ||
      !isValidProviderId(current.requirements.ttsProvider)
    )
      throw new AssessmentFenceConflict();
    const freeze = await database.assessmentAudioSourceFreeze.findUnique({
      where: { assessmentId: current.assessmentId },
    });
    if (!freeze || freeze.classId !== current.classId || freeze.episodeId !== audio.episodeId)
      throw new AssessmentFenceConflict();
    await validateAssessmentAudioLineage(database, audio.episodeId, audio.generationKey);
    const section = await database.classAssessmentSection.findUniqueOrThrow({
      where: { assessmentId_skill: { assessmentId: current.assessmentId, skill: 'SPEAKING' } },
      include: {
        speakingPrompts: { orderBy: { order: 'asc' }, include: { assessmentReference: true } },
      },
    });
    const requirement = current.requirements.skills.SPEAKING;
    if (
      requirement.state !== 'REQUIRED' ||
      section.speakingPrompts.length !== requirement.expectedCount
    )
      throw new AssessmentFenceConflict();
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
      signal
    );
    return { current, section, model, speechFingerprint };
  };
  const initial = await sottoTransaction(prisma, capture, { signal });
  const providerId = initial.current.requirements.ttsProvider;
  if (!providerId || !isValidProviderId(providerId)) throw new AssessmentFenceConflict();
  const authorize: SottoProviderExecution['authorize'] = async (database) => {
    const captured = await capture(database);
    if (captured.speechFingerprint !== initial.speechFingerprint)
      throw new AssessmentFenceConflict();
    return { userId: captured.current.userId };
  };
  const resolved = await resolveTtsProvider({
    userId: initial.current.userId,
    execution: { ...execution, authorize },
    episodeId: audio.episodeId,
    requestedProvider: providerId,
    requestedModel: initial.model,
    language: initial.current.requirements.targetLang,
  });
  if (resolved.providerId !== providerId || !resolved.provider.getModelId())
    throw new AssessmentFenceConflict();

  for (const original of initial.section.speakingPrompts) {
    if (original.assessmentTaskMode === 'COMMUNICATIVE') continue;
    const voiceId = resolved.provider.getVoiceId(
      'HOST',
      audio.episodeId,
      undefined,
      initial.current.requirements.targetLang
    );
    if (!voiceId) throw new AssessmentFenceConflict();
    const marker = {
      kind: 'ASSESSMENT_SPEAKING_TTS_ACTIVE',
      version: 1,
      operationId: identity.id,
      fingerprint: identity.fingerprint,
      assessmentId: initial.current.assessmentId,
      promptId: original.id,
      userId: initial.current.userId,
      provider: providerId,
      model: resolved.provider.getModelId(),
      voiceId,
      speechFingerprint: initial.speechFingerprint,
      inputDigest: learningProviderInputHash({
        task: original.targetPhrase,
        language: initial.current.requirements.targetLang,
      }),
    };
    const check = async (database: Prisma.TransactionClient, active: boolean) => {
      const captured = await capture(database);
      if (
        captured.speechFingerprint !== initial.speechFingerprint ||
        !isDeepStrictEqual(captured.current, initial.current)
      )
        throw new AssessmentFenceConflict();
      const prompt = captured.section.speakingPrompts.find((item) => item.id === original.id);
      if (
        !prompt ||
        prompt.targetPhrase !== original.targetPhrase ||
        prompt.assessmentTaskMode !== original.assessmentTaskMode
      )
        throw new AssessmentFenceConflict();
      if (
        active &&
        (!isDeepStrictEqual(prompt.assessmentReferenceIdentity, marker) ||
          prompt.referenceTtsUrl !== null ||
          prompt.assessmentReference !== null)
      )
        throw new AssessmentFenceConflict();
      return prompt;
    };
    const needsDispatch = await sottoTransaction(
      prisma,
      async (database) => {
        const prompt = await check(database, false);
        if (prompt.assessmentReferenceIdentity !== null) {
          const saved = assessmentSpeakingReferenceSchema.safeParse(
            prompt.assessmentReferenceIdentity
          );
          if (
            !saved.success ||
            saved.data.assessmentId !== marker.assessmentId ||
            saved.data.promptId !== marker.promptId ||
            saved.data.userId !== marker.userId ||
            !prompt.assessmentReference ||
            prompt.referenceTtsUrl !== saved.data.reference.reference ||
            prompt.assessmentReference.currentUrl !== prompt.referenceTtsUrl ||
            !saved.data.provenance ||
            !isDeepStrictEqual(
              { ...saved.data.provenance, dispatches: undefined },
              {
                operationId: marker.operationId,
                fingerprint: marker.fingerprint,
                provider: marker.provider,
                model: marker.model,
                voiceId: marker.voiceId,
                speechFingerprint: marker.speechFingerprint,
                inputDigest: marker.inputDigest,
                dispatches: undefined,
              }
            )
          )
            throw new AssessmentFenceConflict();
          const reference = (
            await resolveStorageInput(database, {
              consumer: `speaking-prompt:${prompt.id}:reference`,
              reference: prompt.referenceTtsUrl,
            })
          ).input;
          if (!isDeepStrictEqual(reference, saved.data.reference))
            throw new AssessmentFenceConflict();
          return false;
        }
        if (prompt.referenceTtsUrl !== null || prompt.assessmentReference !== null)
          throw new AssessmentFenceConflict();
        const admitted = await database.speakingPrompt.updateMany({
          where: {
            id: prompt.id,
            assessmentSectionId: initial.section.id,
            referenceTtsUrl: null,
            assessmentReferenceIdentity: { equals: Prisma.DbNull },
          },
          data: { assessmentReferenceIdentity: marker },
        });
        if (admitted.count !== 1) throw new AssessmentFenceConflict();
        return true;
      },
      { signal }
    );
    if (!needsDispatch) continue;

    let outstanding = false;
    let dispatched = 0;
    let settled = 0;
    let invalid = false;
    let reportedUncertain = false;
    const reportUncertain = () => {
      if (dispatched && !reportedUncertain) {
        reportedUncertain = true;
        input.unresolved();
      }
    };
    signal.addEventListener('abort', reportUncertain, { once: true });
    if (signal.aborted) reportUncertain();
    const onDispatch = () => {
      assertSottoExecutionOperation(input.operation, expected);
      if (invalid || outstanding || dispatched >= 64) {
        invalid = true;
        throw new AssessmentFenceConflict();
      }
      outstanding = true;
      dispatched++;
      if (signal.aborted) reportUncertain();
    };
    const onSettled = () => {
      assertSottoExecutionOperation(input.operation, expected);
      if (invalid || !outstanding) {
        invalid = true;
        throw new AssessmentFenceConflict();
      }
      outstanding = false;
      settled++;
    };
    try {
      const bytes = await resolved.provider.generateSpeech({
        text: original.targetPhrase,
        voiceId,
        language: initial.current.requirements.targetLang,
        signal,
        onDispatch,
        onSettled,
      });
      if (
        !isRecognizedAudio(bytes) ||
        bytes.length > 64 * 1024 * 1024 ||
        invalid ||
        outstanding ||
        !dispatched ||
        dispatched !== settled
      )
        throw new AssessmentFenceConflict();
      if ((await measureTtsAudio(bytes, { signal })) <= 0) throw new AssessmentFenceConflict();
      const format = detectAudioFormat(bytes);
      const contentSha256 = createHash('sha256').update(bytes).digest('hex');
      const provenance = {
        operationId: marker.operationId,
        fingerprint: marker.fingerprint,
        provider: marker.provider,
        model: marker.model,
        voiceId: marker.voiceId,
        speechFingerprint: marker.speechFingerprint,
        inputDigest: marker.inputDigest,
        dispatches: dispatched,
      };
      await writeStorageReference({
        database: prisma,
        signal,
        prefix: `speaking-ref/${original.id}`,
        extension: format.ext,
        body: bytes,
        contentType: format.mime,
        captureAdmission: async (database) => {
          await check(database, true);
          const storage = await captureSpeakingPromptStorage(database, original.id);
          return {
            ...storage,
            consumer: `speaking-prompt:${original.id}:reference`,
            snapshot: storage,
          };
        },
        validateAdmission: async (database, admission, committedReference) => {
          if (!committedReference) {
            await check(database, true);
            if (
              !isDeepStrictEqual(
                await captureSpeakingPromptStorage(database, original.id),
                admission.snapshot
              )
            )
              throw new AssessmentFenceConflict();
            return;
          }
          const prompt = await check(database, false);
          const saved = assessmentSpeakingReferenceSchema.parse(prompt.assessmentReferenceIdentity);
          const currentStorage = await captureSpeakingPromptStorage(database, original.id);
          const stored = (
            await resolveStorageInput(database, {
              consumer: `speaking-prompt:${original.id}:reference`,
              reference: committedReference,
            })
          ).input;
          if (
            prompt.referenceTtsUrl !== committedReference ||
            prompt.assessmentReference?.currentUrl !== committedReference ||
            saved.contentSha256 !== contentSha256 ||
            saved.contentBytes !== bytes.length ||
            saved.reference.reference !== committedReference ||
            !isDeepStrictEqual(saved.provenance, provenance) ||
            !isDeepStrictEqual(saved.reference, stored) ||
            !isDeepStrictEqual(currentStorage, {
              ...admission.snapshot,
              reference: committedReference,
            })
          )
            throw new AssessmentFenceConflict();
        },
        previousReference: () => null,
        commit: async (database, reference) => {
          await check(database, true);
          const storage = (
            await resolveStorageInput(database, {
              consumer: `speaking-prompt:${original.id}:reference`,
              reference,
            })
          ).input;
          const final = assessmentSpeakingReferenceSchema.parse({
            version: 1,
            assessmentId: marker.assessmentId,
            promptId: marker.promptId,
            userId: marker.userId,
            contentSha256,
            contentBytes: bytes.length,
            reference: storage,
            provenance,
          });
          const updated = await database.speakingPrompt.updateMany({
            where: {
              id: original.id,
              assessmentSectionId: initial.section.id,
              referenceTtsUrl: null,
              assessmentReferenceIdentity: { equals: marker },
            },
            data: { referenceTtsUrl: reference, assessmentReferenceIdentity: final },
          });
          if (updated.count !== 1) throw new AssessmentFenceConflict();
        },
      });
    } catch (error) {
      if (!reportedUncertain) input.unresolved();
      throw error;
    } finally {
      signal.removeEventListener('abort', reportUncertain);
    }
  }
}
