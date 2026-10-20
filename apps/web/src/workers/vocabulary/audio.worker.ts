import type { Job } from 'bullmq';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { durableJobProviderExecution } from '@/lib/sidedoor/jobs/core/durable-queue';
import { captureCourseStorage } from '@/lib/sidedoor/storage/core/course-storage';
import { writeStorageReference } from '@/lib/sidedoor/storage/core/storage-write';
import { vocabularyAudioPayloadSchema } from '@/lib/vocabulary/audio/state';
import { resolveVocabularyAudio } from '@/lib/vocabulary/audio/provider';
import { detectAudioFormat, isRecognizedAudio } from '@/lib/audio-format';

export async function processVocabularyAudio(job: Job<unknown>, workerSignal?: AbortSignal) {
  const controller = new AbortController();
  const signal = workerSignal
    ? AbortSignal.any([workerSignal, controller.signal])
    : controller.signal;
  const payload = vocabularyAudioPayloadSchema.parse(job.data);
  const base = durableJobProviderExecution(job, payload.userId, signal);
  let cleanupUnknown = false;
  let dispatched = false;
  let settled = false;
  let publishing = false;
  const execution = {
    ...base,
    authorize: async (database: Parameters<typeof base.authorize>[0]) => {
      const actor = await base.authorize(database);
      const asset = await database.vocabularyPronunciation.findUniqueOrThrow({
        where: { id: payload.assetId },
      });
      const owner = await captureCourseStorage(database, asset.courseId);
      if (
        owner.userId !== actor.userId ||
        asset.generation !== payload.generation ||
        !['QUEUED', 'RUNNING', 'READY'].includes(asset.status)
      )
        throw new Error('Pronunciation ownership or generation changed.');
      return actor;
    },
    onCleanupError: (error: unknown) => {
      cleanupUnknown = true;
      base.onCleanupError?.(error);
    },
  };
  const asset = await sottoTransaction(prisma, async (database) => {
    await execution.authorize(database);
    await database.$queryRaw`SELECT id FROM "VocabularyPronunciation" WHERE id = ${payload.assetId} FOR UPDATE`;
    const current = await database.vocabularyPronunciation.findUniqueOrThrow({
      where: { id: payload.assetId },
    });
    if (current.status === 'READY') return null;
    if (current.status !== 'QUEUED')
      throw new Error('Interrupted pronunciation needs explicit reconciliation.');
    return database.vocabularyPronunciation.update({
      where: { id: current.id },
      data: { status: 'RUNNING' },
    });
  });
  if (!asset) return;
  let checking = false;
  const heartbeat = setInterval(() => {
    if (checking || signal.aborted) return;
    checking = true;
    void sottoTransaction(prisma, async (database) => {
      await execution.authorize(database);
      await database.vocabularyPronunciation.updateMany({
        where: { id: asset.id, generation: payload.generation, status: 'RUNNING' },
        data: { updatedAt: new Date() },
      });
    })
      .catch((error: unknown) => controller.abort(error))
      .finally(() => {
        checking = false;
      });
  }, 5000);
  try {
    const selected = await resolveVocabularyAudio(asset.courseId, asset.text, execution);
    if (selected.fingerprint !== asset.fingerprint)
      throw new Error('Local voice configuration changed. Request pronunciation again.');
    const audio = await selected.provider.generateSpeech({
      text: asset.text,
      language: asset.language,
      voiceId: selected.voiceId,
      modelId: selected.provider.getModelId(),
      signal,
      onDispatch: () => {
        dispatched = true;
      },
      onSettled: () => {
        settled = true;
      },
    });
    if (!isRecognizedAudio(audio)) throw new Error('Local speech returned invalid audio.');
    const format = detectAudioFormat(audio);
    publishing = true;
    await writeStorageReference({
      database: prisma,
      signal: signal ?? new AbortController().signal,
      prefix: `vocabulary/${asset.id}`,
      extension: format.ext,
      body: audio,
      contentType: format.mime,
      captureAdmission: async (database) => {
        await execution.authorize(database);
        const snapshot = await captureCourseStorage(database, asset.courseId);
        return { ...snapshot, consumer: `vocabulary-audio:${asset.id}:audio`, snapshot };
      },
      validateAdmission: async (database, captured, reference) => {
        await execution.authorize(database);
        const current = await database.vocabularyPronunciation.findUniqueOrThrow({
          where: { id: asset.id },
        });
        if (
          current.fingerprint !== asset.fingerprint ||
          (reference && current.audioUrl !== reference)
        )
          throw new Error('Pronunciation publication changed.');
        if (
          JSON.stringify(await captureCourseStorage(database, asset.courseId)) !==
          JSON.stringify(captured.snapshot)
        )
          throw new Error('Pronunciation ownership changed.');
      },
      previousReference: () => null,
      commit: async (database, reference) => {
        await database.vocabularyPronunciation.update({
          where: { id: asset.id },
          data: { audioUrl: reference, status: 'READY', error: null },
        });
      },
    });
    await job.updateProgress(100);
  } catch (error) {
    const uncertain = cleanupUnknown || signal.aborted || (dispatched && !settled) || publishing;
    if (uncertain) base.onCleanupError?.(error);
    await prisma.vocabularyPronunciation.updateMany({
      where: { id: asset.id, generation: payload.generation, status: 'RUNNING' },
      data: {
        status: uncertain ? 'UNRESOLVED' : 'FAILED',
        error: uncertain
          ? 'Local pronunciation was interrupted. Confirm worker execution cleanup before retrying.'
          : 'Local pronunciation failed. Check the local speech service and retry.',
      },
    });
    throw error;
  } finally {
    clearInterval(heartbeat);
    controller.abort();
  }
}
