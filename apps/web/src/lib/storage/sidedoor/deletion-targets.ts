import type { Prisma } from '@/generated/prisma/client';
import { LOCAL_STORAGE_URL_PREFIX } from '@/lib/r2';

export type StorageDeletionScope =
  | { kind: 'instance' }
  | { kind: 'course'; id: string; episodeIds: readonly string[] }
  | { kind: 'profile'; id: string }
  | { kind: 'material'; id: string }
  | { kind: 'material-upload'; id: string };

/** Class inventory is read-only. Callers must prove episode ownership, recording cascade and cleanup attribution. */
export type StorageDeletionInventoryScope =
  StorageDeletionScope | { kind: 'class'; id: string; episodeIds: readonly string[] };

export function ownedStorageReferences(
  values: Array<string | null | undefined>,
  publicUrl?: string
): string[] {
  return [
    ...new Set(
      values.filter((value): value is string => {
        if (!value?.trim() || value.startsWith('/avatars/') || value.startsWith('data:'))
          return false;
        if (value.startsWith(`${LOCAL_STORAGE_URL_PREFIX}/`)) return true;
        if (publicUrl && value.startsWith(`${publicUrl}/`)) return true;
        if (/^https?:\/\//i.test(value)) return false;
        return !value.startsWith('/');
      })
    ),
  ];
}

export interface StorageDeletionReferencePage {
  source:
    | 'episode'
    | 'segment'
    | 'version'
    | 'user'
    | 'class'
    | 'prompt'
    | 'recording'
    | 'focus'
    | 'material'
    | 'vocabulary-audio'
    | 'upload-part';
  rows: Array<{ id: string; references: Record<string, string>; episodePrefix?: string }>;
}

function speakingReference(row: {
  assessmentSectionId: string | null;
  referenceTtsUrl: string | null;
  assessmentReference: { currentUrl: string } | null;
}) {
  if (!row.assessmentSectionId) return row.referenceTtsUrl;
  if (Boolean(row.referenceTtsUrl) !== Boolean(row.assessmentReference))
    throw new Error('Assessment speaking locator is inconsistent');
  return row.assessmentReference?.currentUrl ?? null;
}

function recordingReference(row: {
  assessmentSectionId: string | null;
  assessmentAudioUrl: string | null;
  audioUrl: string;
}) {
  if (!row.assessmentSectionId) return row.audioUrl;
  if (!row.assessmentAudioUrl) throw new Error('Assessment recording locator is missing');
  return row.assessmentAudioUrl;
}

/**
 * Persist each page before cascading source rows, using the caller's Serializable transaction.
 * Raw references retain field provenance and unknown historical URLs for explicit classification.
 * This visitor does not establish backend ownership and never performs storage I/O.
 */
export async function visitStorageDeletionReferences(
  database: Prisma.TransactionClient,
  scope: StorageDeletionInventoryScope,
  visit: (page: StorageDeletionReferencePage) => Promise<void>
) {
  async function pages<Row extends { id: string }>(
    source: StorageDeletionReferencePage['source'],
    fetch: (after: string | null) => Promise<Row[]>,
    references: (row: Row) => Record<string, string | null>
  ) {
    let after: string | null = null;
    while (true) {
      const rows = await fetch(after);
      if (rows.length === 0) return;
      await visit({
        source,
        rows: rows.map((row) => ({
          id: row.id,
          references: Object.fromEntries(
            Object.entries(references(row)).filter(
              (entry): entry is [string, string] => entry[1] !== null
            )
          ),
          ...(source === 'episode' ? { episodePrefix: `episodes/${row.id}/` } : {}),
        })),
      });
      if (rows.length < 100) return;
      after = rows[rows.length - 1]!.id;
    }
  }
  const page = { orderBy: { id: 'asc' as const }, take: 100 };
  const afterId = (after: string | null) => (after === null ? {} : { id: { gt: after } });
  async function uploadParts(where: Prisma.MaterialUploadPartWhereInput) {
    await pages(
      'upload-part',
      (after) =>
        database.materialUploadPart.findMany({
          ...page,
          where: { AND: [where, afterId(after)] },
          select: { id: true, originalUrl: true },
        }),
      ({ originalUrl }) => ({ originalUrl })
    );
  }
  if (scope.kind === 'class') {
    const episodeWhere: Prisma.EpisodeWhereInput = { id: { in: [...scope.episodeIds] } };
    const classSections = await database.classSection.findMany({
      where: { classId: scope.id },
      select: { id: true },
    });
    const promptWhere: Prisma.SpeakingPromptWhereInput = {
      OR: [
        { section: { classId: scope.id } },
        { assessmentSection: { assessment: { classId: scope.id } } },
      ],
    };
    await pages(
      'episode',
      (after) =>
        database.episode.findMany({
          ...page,
          where: { AND: [episodeWhere, afterId(after)] },
          select: {
            id: true,
            audioUrl: true,
            pdfUrl: true,
            waveformUrl: true,
            spectrogramUrl: true,
          },
        }),
      ({ audioUrl, pdfUrl, waveformUrl, spectrogramUrl }) => ({
        audioUrl,
        pdfUrl,
        waveformUrl,
        spectrogramUrl,
      })
    );
    await pages(
      'segment',
      (after) =>
        database.segment.findMany({
          ...page,
          where: { episode: episodeWhere, ...afterId(after) },
          select: { id: true, audioUrl: true },
        }),
      ({ audioUrl }) => ({ audioUrl })
    );
    await pages(
      'version',
      (after) =>
        database.episodeVersion.findMany({
          ...page,
          where: { episode: episodeWhere, ...afterId(after) },
          select: { id: true, audioUrl: true },
        }),
      ({ audioUrl }) => ({ audioUrl })
    );
    await pages(
      'class',
      (after) =>
        database.courseClass.findMany({
          ...page,
          where: { AND: [{ id: scope.id }, afterId(after)] },
          select: { id: true, worksheetPdfUrl: true },
        }),
      ({ worksheetPdfUrl }) => ({ worksheetPdfUrl })
    );
    await pages(
      'prompt',
      (after) =>
        database.speakingPrompt.findMany({
          ...page,
          where: { ...promptWhere, ...afterId(after) },
          select: {
            id: true,
            assessmentSectionId: true,
            referenceTtsUrl: true,
            assessmentReference: { select: { currentUrl: true } },
          },
        }),
      (prompt) => ({ referenceTtsUrl: speakingReference(prompt) })
    );
    await pages(
      'recording',
      (after) =>
        database.speakingRecording.findMany({
          ...page,
          where: {
            OR: [
              { prompt: promptWhere },
              { sectionId: { in: classSections.map((section) => section.id) } },
            ],
            ...afterId(after),
          },
          select: { id: true, audioUrl: true, assessmentAudioUrl: true, assessmentSectionId: true },
        }),
      (recording) => ({ audioUrl: recordingReference(recording) })
    );
    return;
  }
  // Completed-upload cleanup fences transfer work without touching the retained document.
  if (scope.kind === 'material-upload') {
    await uploadParts({ uploadId: scope.id });
    return;
  }
  const materialWhere: Prisma.CourseMaterialWhereInput =
    scope.kind === 'instance'
      ? {}
      : scope.kind === 'profile'
        ? { userId: scope.id }
        : scope.kind === 'material'
          ? { id: scope.id }
          : { courseId: scope.id };
  await pages(
    'material',
    (after) =>
      database.courseMaterial.findMany({
        ...page,
        where: {
          ...materialWhere,
          ...afterId(after),
        },
        select: { id: true, originalUrl: true, optimizedUrl: true },
      }),
    ({ originalUrl, optimizedUrl }) => ({ originalUrl, optimizedUrl })
  );
  await uploadParts({ upload: { material: materialWhere } });
  if (scope.kind === 'material') return;
  const episodeWhere: Prisma.EpisodeWhereInput =
    scope.kind === 'instance'
      ? {}
      : scope.kind === 'profile'
        ? { userId: scope.id }
        : { id: { in: [...scope.episodeIds] } };
  const courseWhere =
    scope.kind === 'instance'
      ? {}
      : scope.kind === 'profile'
        ? { course: { userId: scope.id } }
        : { courseId: scope.id };
  const promptWhere: Prisma.SpeakingPromptWhereInput =
    scope.kind === 'instance'
      ? {}
      : {
          OR: [
            { section: { class: courseWhere } },
            { practiceSession: courseWhere },
            { examSection: { exam: courseWhere } },
            { assessmentSection: { assessment: { class: courseWhere } } },
            ...(scope.kind === 'profile' ? [{ examSection: { exam: { userId: scope.id } } }] : []),
          ],
        };
  if (scope.kind !== 'course' || scope.episodeIds.length > 0) {
    await pages(
      'episode',
      (after) =>
        database.episode.findMany({
          ...page,
          where: { AND: [episodeWhere, afterId(after)] },
          select: {
            id: true,
            audioUrl: true,
            pdfUrl: true,
            waveformUrl: true,
            spectrogramUrl: true,
          },
        }),
      ({ audioUrl, pdfUrl, waveformUrl, spectrogramUrl }) => ({
        audioUrl,
        pdfUrl,
        waveformUrl,
        spectrogramUrl,
      })
    );
    await pages(
      'segment',
      (after) =>
        database.segment.findMany({
          ...page,
          where: { episode: episodeWhere, ...afterId(after) },
          select: { id: true, audioUrl: true },
        }),
      ({ audioUrl }) => ({ audioUrl })
    );
    await pages(
      'version',
      (after) =>
        database.episodeVersion.findMany({
          ...page,
          where: { episode: episodeWhere, ...afterId(after) },
          select: { id: true, audioUrl: true },
        }),
      ({ audioUrl }) => ({ audioUrl })
    );
  }
  if (scope.kind === 'profile') {
    await pages(
      'user',
      (after) =>
        database.user.findMany({
          ...page,
          where: { AND: [{ id: scope.id }, afterId(after)] },
          select: { id: true, image: true },
        }),
      ({ image }) => ({ image })
    );
  }
  await pages(
    'class',
    (after) =>
      database.courseClass.findMany({
        ...page,
        where: { ...courseWhere, ...afterId(after) },
        select: { id: true, worksheetPdfUrl: true },
      }),
    ({ worksheetPdfUrl }) => ({ worksheetPdfUrl })
  );
  await pages(
    'prompt',
    (after) =>
      database.speakingPrompt.findMany({
        ...page,
        where: { ...promptWhere, ...afterId(after) },
        select: {
          id: true,
          assessmentSectionId: true,
          referenceTtsUrl: true,
          assessmentReference: { select: { currentUrl: true } },
        },
      }),
    (prompt) => ({ referenceTtsUrl: speakingReference(prompt) })
  );
  const recordingWhere =
    scope.kind === 'instance'
      ? {}
      : scope.kind === 'profile'
        ? { OR: [{ userId: scope.id }, { prompt: promptWhere }, { practiceSession: courseWhere }] }
        : { OR: [{ prompt: promptWhere }, { practiceSession: courseWhere }] };
  await pages(
    'recording',
    (after) =>
      database.speakingRecording.findMany({
        ...page,
        where: { ...recordingWhere, ...afterId(after) },
        select: { id: true, audioUrl: true, assessmentAudioUrl: true, assessmentSectionId: true },
      }),
    (recording) => ({ audioUrl: recordingReference(recording) })
  );
  await pages(
    'focus',
    (after) =>
      database.learnerFocusTarget.findMany({
        ...page,
        where: { ...courseWhere, ...afterId(after) },
        select: { id: true, visualCueUrl: true, pronunciationAudioUrl: true },
      }),
    ({ visualCueUrl, pronunciationAudioUrl }) => ({ visualCueUrl, pronunciationAudioUrl })
  );
  await pages(
    'vocabulary-audio',
    (after) =>
      database.vocabularyPronunciation.findMany({
        ...page,
        where: { ...courseWhere, ...afterId(after) },
        select: { id: true, audioUrl: true },
      }),
    ({ audioUrl }) => ({ audioUrl })
  );
}
