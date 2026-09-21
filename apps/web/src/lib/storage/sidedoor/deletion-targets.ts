import type { Prisma } from '@/generated/prisma/client';
import { LOCAL_STORAGE_URL_PREFIX } from '@/lib/r2';

export type StorageDeletionScope =
  | { kind: 'instance' }
  | { kind: 'course'; id: string; episodeIds: readonly string[] }
  | { kind: 'profile'; id: string };

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
  source: 'episode' | 'segment' | 'version' | 'user' | 'class' | 'prompt' | 'recording' | 'focus';
  rows: Array<{ id: string; references: Record<string, string>; episodePrefix?: string }>;
}

/**
 * Persist each page before cascading source rows, using the caller's Serializable transaction.
 * Raw references retain field provenance and unknown historical URLs for explicit classification.
 * This visitor does not establish backend ownership and never performs storage I/O.
 */
export async function visitStorageDeletionReferences(
  database: Prisma.TransactionClient,
  scope: StorageDeletionScope,
  visit: (page: StorageDeletionReferencePage) => Promise<void>
) {
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
            ...(scope.kind === 'profile' ? [{ examSection: { exam: { userId: scope.id } } }] : []),
          ],
        };
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
  if (scope.kind !== 'course') {
    await pages(
      'user',
      (after) =>
        database.user.findMany({
          ...page,
          where: { AND: [scope.kind === 'profile' ? { id: scope.id } : {}, afterId(after)] },
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
        select: { id: true, referenceTtsUrl: true },
      }),
    ({ referenceTtsUrl }) => ({ referenceTtsUrl })
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
        select: { id: true, audioUrl: true },
      }),
    ({ audioUrl }) => ({ audioUrl })
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
}
