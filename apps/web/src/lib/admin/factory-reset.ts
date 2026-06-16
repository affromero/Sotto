import { ensureLocalUser } from '@/lib/local-user';
import { logger } from '@/lib/logger';
import { prismaUnfiltered } from '@/lib/prisma';
import { deleteFile, extractR2Key, listFiles } from '@/lib/r2';

const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

export interface FactoryResetResult {
  usersDeleted: number;
  episodesDeleted: number;
  filesAttempted: number;
  filesDeleted: number;
  filesFailed: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function uniqueDefined(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))];
}

function isAppStorageRef(value: string): boolean {
  if (value.startsWith('/avatars/') || value.startsWith('data:') || value.startsWith('file://')) {
    return false;
  }
  if (R2_PUBLIC_URL && value.startsWith(`${R2_PUBLIC_URL}/`)) {
    return true;
  }
  if (/^https?:\/\//i.test(value)) {
    return false;
  }
  return !value.startsWith('/');
}

async function collectStorageTargets() {
  const [episodes, segments, versions, users, classes, prompts, recordings, focusTargets] =
    await Promise.all([
      prismaUnfiltered.episode.findMany({
        select: {
          id: true,
          audioUrl: true,
          pdfUrl: true,
          waveformUrl: true,
          spectrogramUrl: true,
        },
      }),
      prismaUnfiltered.segment.findMany({ select: { audioUrl: true } }),
      prismaUnfiltered.episodeVersion.findMany({ select: { audioUrl: true } }),
      prismaUnfiltered.user.findMany({ select: { image: true } }),
      prismaUnfiltered.courseClass.findMany({ select: { worksheetPdfUrl: true } }),
      prismaUnfiltered.speakingPrompt.findMany({ select: { referenceTtsUrl: true } }),
      prismaUnfiltered.speakingRecording.findMany({ select: { audioUrl: true } }),
      prismaUnfiltered.learnerFocusTarget.findMany({
        select: { visualCueUrl: true, pronunciationAudioUrl: true },
      }),
    ]);

  return {
    episodePrefixes: episodes.map((episode) => `episodes/${episode.id}/`),
    episodeRefs: uniqueDefined([
      ...episodes.flatMap((episode) => [
        episode.audioUrl,
        episode.pdfUrl,
        episode.waveformUrl,
        episode.spectrogramUrl,
      ]),
      ...segments.map((segment) => segment.audioUrl),
      ...versions.map((version) => version.audioUrl),
    ]).filter(isAppStorageRef),
    explicitRefs: uniqueDefined([
      ...users.map((user) => user.image),
      ...classes.map((cls) => cls.worksheetPdfUrl),
      ...prompts.map((prompt) => prompt.referenceTtsUrl),
      ...recordings.map((recording) => recording.audioUrl),
      ...focusTargets.flatMap((target) => [target.visualCueUrl, target.pronunciationAudioUrl]),
    ]).filter(isAppStorageRef),
  };
}

async function deleteStorageTargets(): Promise<
  Pick<FactoryResetResult, 'filesAttempted' | 'filesDeleted' | 'filesFailed'>
> {
  const { episodePrefixes, episodeRefs, explicitRefs } = await collectStorageTargets();
  const forcedKeys = new Set<string>(episodeRefs.map((ref) => extractR2Key(ref)));
  const normalKeys = new Set<string>(explicitRefs.map((ref) => extractR2Key(ref)));
  let filesAttempted = 0;
  let filesDeleted = 0;
  let filesFailed = 0;

  for (const prefix of episodePrefixes) {
    try {
      const prefixKeys = await listFiles(prefix);
      prefixKeys.forEach((key) => forcedKeys.add(key));
    } catch (error) {
      logger.warn('Factory reset could not list episode storage prefix', {
        prefix,
        error: errorMessage(error),
      });
    }
  }

  for (const key of forcedKeys) {
    filesAttempted += 1;
    try {
      await deleteFile(key, { force: true });
      filesDeleted += 1;
    } catch (error) {
      filesFailed += 1;
      logger.warn('Factory reset could not delete episode storage file', {
        key,
        error: errorMessage(error),
      });
    }
  }

  for (const key of normalKeys) {
    if (forcedKeys.has(key)) continue;
    filesAttempted += 1;
    try {
      await deleteFile(key);
      filesDeleted += 1;
    } catch (error) {
      filesFailed += 1;
      logger.warn('Factory reset could not delete storage file', {
        key,
        error: errorMessage(error),
      });
    }
  }

  return { filesAttempted, filesDeleted, filesFailed };
}

async function deleteDatabaseState(): Promise<
  Pick<FactoryResetResult, 'usersDeleted' | 'episodesDeleted'>
> {
  const [usersDeleted, episodesDeleted] = await Promise.all([
    prismaUnfiltered.user.count(),
    prismaUnfiltered.episode.count(),
  ]);

  await prismaUnfiltered.$transaction([
    prismaUnfiltered.episodeVersionSegment.deleteMany({}),
    prismaUnfiltered.episodeVersion.deleteMany({}),
    prismaUnfiltered.discoveryMessage.deleteMany({}),
    prismaUnfiltered.discovery.deleteMany({}),
    prismaUnfiltered.agentIngestion.deleteMany({}),
    prismaUnfiltered.researchDossier.deleteMany({}),
    prismaUnfiltered.creativeOutline.deleteMany({}),
    prismaUnfiltered.script.deleteMany({}),
    prismaUnfiltered.segment.deleteMany({}),
    prismaUnfiltered.episodeVoice.deleteMany({}),
    prismaUnfiltered.audioFingerprint.deleteMany({}),
    prismaUnfiltered.reference.deleteMany({}),
    prismaUnfiltered.vocabularyEntry.deleteMany({}),
    prismaUnfiltered.episodeTag.deleteMany({}),
    prismaUnfiltered.pipelineEvent.deleteMany({}),
    prismaUnfiltered.job.deleteMany({}),
    prismaUnfiltered.save.deleteMany({}),
    prismaUnfiltered.interaction.deleteMany({}),
    prismaUnfiltered.examSectionResult.deleteMany({}),
    prismaUnfiltered.examSubmission.deleteMany({}),
    prismaUnfiltered.examQuestion.deleteMany({}),
    prismaUnfiltered.sectionAnswer.deleteMany({}),
    prismaUnfiltered.speakingRecording.deleteMany({}),
    prismaUnfiltered.writingResponse.deleteMany({}),
    prismaUnfiltered.speakingPrompt.deleteMany({}),
    prismaUnfiltered.writingPrompt.deleteMany({}),
    prismaUnfiltered.examSection.deleteMany({}),
    prismaUnfiltered.mockExam.deleteMany({}),
    prismaUnfiltered.classSubmission.deleteMany({}),
    prismaUnfiltered.lessonQuestion.deleteMany({}),
    prismaUnfiltered.classSection.deleteMany({}),
    prismaUnfiltered.courseClass.deleteMany({}),
    prismaUnfiltered.vocabEdge.deleteMany({}),
    prismaUnfiltered.learnerFocusTarget.deleteMany({}),
    prismaUnfiltered.practiceSession.deleteMany({}),
    prismaUnfiltered.courseNote.deleteMany({}),
    prismaUnfiltered.placementResult.deleteMany({}),
    prismaUnfiltered.learnerVocab.deleteMany({}),
    prismaUnfiltered.learnerGrammar.deleteMany({}),
    prismaUnfiltered.course.deleteMany({}),
    prismaUnfiltered.userInterest.deleteMany({}),
    prismaUnfiltered.userVoicePreference.deleteMany({}),
    prismaUnfiltered.userTtsKey.deleteMany({}),
    prismaUnfiltered.userAiKey.deleteMany({}),
    prismaUnfiltered.userVisualCueKey.deleteMany({}),
    prismaUnfiltered.apiKey.deleteMany({}),
    prismaUnfiltered.pairingToken.deleteMany({}),
    prismaUnfiltered.notification.deleteMany({}),
    prismaUnfiltered.pushSubscription.deleteMany({}),
    prismaUnfiltered.discoveryChatError.deleteMany({}),
    prismaUnfiltered.apiUsageLog.deleteMany({}),
    prismaUnfiltered.feedback.deleteMany({}),
    prismaUnfiltered.episode.deleteMany({}),
    prismaUnfiltered.user.deleteMany({}),
    prismaUnfiltered.siteConfig.deleteMany({}),
    prismaUnfiltered.autoModelConfig.deleteMany({}),
    prismaUnfiltered.modelPricingSnapshot.deleteMany({}),
    prismaUnfiltered.curriculum.deleteMany({ where: { source: 'generated' } }),
  ]);

  return { usersDeleted, episodesDeleted };
}

export async function factoryReset(): Promise<FactoryResetResult> {
  const storage = await deleteStorageTargets();
  const database = await deleteDatabaseState();

  await ensureLocalUser();

  logger.warn('Factory reset completed', {
    usersDeleted: String(database.usersDeleted),
    episodesDeleted: String(database.episodesDeleted),
    filesAttempted: String(storage.filesAttempted),
    filesDeleted: String(storage.filesDeleted),
    filesFailed: String(storage.filesFailed),
  });

  return { ...database, ...storage };
}
