// Complete, course-scoped deletion: wipes a single course's database rows AND
// its stored files (worksheets, speaking audio, focus media) AND the listening
// Episodes generated for it. A course-scoped sibling of lib/admin/factory-reset.ts
// — same storage discipline: force-delete protected episode/segment audio via the
// sanctioned deleteFile({ force: true }) path, normal-delete the rest, never a
// blind bucket sweep. Used by reset-and-restart and remove-language.
//
// Course children (classes, sections, exams, practice, vocab/grammar graph,
// notes, placement) cascade from Course, so deleting the Course row clears them.
// Episodes are User-owned and only SetNull-linked from sections, so they are not
// cascade-deleted — we collect and delete the ones tied to THIS course explicitly.
import { prismaUnfiltered } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { deleteFile, extractR2Key, listFiles } from '@/lib/r2';

const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

export interface CourseDeletionResult {
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

// Mirror of factory-reset's filter: keep only refs that live in our storage
// bucket (skip avatars, data URIs, and external https links).
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

// Speaking prompts/recordings hang off exactly one parent (class section,
// practice session, or exam section); this filter scopes them to one course.
function speakingUnderCourse(courseId: string) {
  return {
    OR: [
      { section: { class: { courseId } } },
      { practiceSession: { courseId } },
      { examSection: { exam: { courseId } } },
    ],
  };
}

// Listening episodes generated for this course, found via the @unique episodeId
// on its class/exam/practice sections. Generation creates a fresh episode per
// section, so these episodes belong to this course.
async function collectCourseEpisodeIds(courseId: string): Promise<string[]> {
  const [classSections, examSections, practiceSessions] = await Promise.all([
    prismaUnfiltered.classSection.findMany({
      where: { class: { courseId }, episodeId: { not: null } },
      select: { episodeId: true },
    }),
    prismaUnfiltered.examSection.findMany({
      where: { exam: { courseId }, episodeId: { not: null } },
      select: { episodeId: true },
    }),
    prismaUnfiltered.practiceSession.findMany({
      where: { courseId, episodeId: { not: null } },
      select: { episodeId: true },
    }),
  ]);
  return [
    ...new Set([
      ...classSections.map((s) => s.episodeId as string),
      ...examSections.map((s) => s.episodeId as string),
      ...practiceSessions.map((s) => s.episodeId as string),
    ]),
  ];
}

async function collectStorageTargets(courseId: string, episodeIds: string[]) {
  const [episodes, segments, versions, classes, prompts, recordings, focusTargets] =
    await Promise.all([
      episodeIds.length
        ? prismaUnfiltered.episode.findMany({
            where: { id: { in: episodeIds } },
            select: {
              id: true,
              audioUrl: true,
              pdfUrl: true,
              waveformUrl: true,
              spectrogramUrl: true,
            },
          })
        : [],
      episodeIds.length
        ? prismaUnfiltered.segment.findMany({
            where: { episodeId: { in: episodeIds } },
            select: { audioUrl: true },
          })
        : [],
      episodeIds.length
        ? prismaUnfiltered.episodeVersion.findMany({
            where: { episodeId: { in: episodeIds } },
            select: { audioUrl: true },
          })
        : [],
      prismaUnfiltered.courseClass.findMany({
        where: { courseId },
        select: { worksheetPdfUrl: true },
      }),
      prismaUnfiltered.speakingPrompt.findMany({
        where: speakingUnderCourse(courseId),
        select: { referenceTtsUrl: true },
      }),
      prismaUnfiltered.speakingRecording.findMany({
        where: { prompt: speakingUnderCourse(courseId) },
        select: { audioUrl: true },
      }),
      prismaUnfiltered.learnerFocusTarget.findMany({
        where: { courseId },
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
      ...classes.map((cls) => cls.worksheetPdfUrl),
      ...prompts.map((prompt) => prompt.referenceTtsUrl),
      ...recordings.map((recording) => recording.audioUrl),
      ...focusTargets.flatMap((target) => [target.visualCueUrl, target.pronunciationAudioUrl]),
    ]).filter(isAppStorageRef),
  };
}

async function deleteStorageTargets(
  courseId: string,
  episodeIds: string[]
): Promise<Pick<CourseDeletionResult, 'filesAttempted' | 'filesDeleted' | 'filesFailed'>> {
  const { episodePrefixes, episodeRefs, explicitRefs } = await collectStorageTargets(
    courseId,
    episodeIds
  );
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
      logger.warn('Course delete could not list episode storage prefix', {
        prefix,
        error: errorMessage(error),
      });
    }
  }

  // Protected episode/segment audio needs force; collected via episode prefixes/refs.
  for (const key of forcedKeys) {
    filesAttempted += 1;
    try {
      await deleteFile(key, { force: true });
      filesDeleted += 1;
    } catch (error) {
      filesFailed += 1;
      logger.warn('Course delete could not delete episode storage file', {
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
      logger.warn('Course delete could not delete storage file', {
        key,
        error: errorMessage(error),
      });
    }
  }

  return { filesAttempted, filesDeleted, filesFailed };
}

/**
 * Delete a course and everything tied to it: stored files first (best-effort,
 * never failing the deletion), then the course row (cascades its children) and
 * its generated episodes in one transaction. Caller MUST verify ownership first.
 */
export async function deleteCourseCompletely(courseId: string): Promise<CourseDeletionResult> {
  const episodeIds = await collectCourseEpisodeIds(courseId);

  // Storage is best-effort: orphaned files are recoverable cruft, but a half-deleted
  // DB is not — so file failures are logged, never thrown, and the DB delete runs.
  const storage = await deleteStorageTargets(courseId, episodeIds);

  await prismaUnfiltered.$transaction([
    prismaUnfiltered.course.delete({ where: { id: courseId } }),
    ...(episodeIds.length
      ? [prismaUnfiltered.episode.deleteMany({ where: { id: { in: episodeIds } } })]
      : []),
  ]);

  logger.warn('Course deleted completely', {
    courseId,
    episodesDeleted: String(episodeIds.length),
    filesAttempted: String(storage.filesAttempted),
    filesDeleted: String(storage.filesDeleted),
    filesFailed: String(storage.filesFailed),
  });

  return { episodesDeleted: episodeIds.length, ...storage };
}
