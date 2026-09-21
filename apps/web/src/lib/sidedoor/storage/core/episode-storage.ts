import { StorageWriteJournal } from 'thesidedoor-core/storage';
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@/generated/prisma/client';
import { SIDEDOOR_STATE_ID, sottoStorageInstance } from '@/lib/sidedoor/access/state/store';

export class EpisodeStorageChangedError extends Error {
  constructor() {
    super('Episode storage ownership or inputs changed');
    this.name = 'EpisodeStorageChangedError';
  }
}

/** Read all current associations in one Serializable snapshot, including cross-profile course owners. */
export async function captureEpisodeStorage(
  database: Prisma.TransactionClient,
  episodeId: string,
  additionalProfileIds: readonly string[] = []
) {
  const instance = await sottoStorageInstance(database).read();
  const courseSelect = {
    id: true,
    createdAt: true,
    user: { select: { id: true, createdAt: true } },
  } as const;
  const episode = await database.episode.findUnique({
    where: { id: episodeId },
    select: {
      id: true,
      createdAt: true,
      deletedAt: true,
      user: { select: { id: true, createdAt: true } },
      classSection: {
        select: {
          id: true,
          classId: true,
          class: { select: { course: { select: courseSelect } } },
        },
      },
      examSection: {
        select: {
          id: true,
          examId: true,
          exam: {
            select: {
              course: { select: courseSelect },
              user: { select: { id: true, createdAt: true } },
            },
          },
        },
      },
      practiceSession: { select: { id: true, course: { select: courseSelect } } },
    },
  });
  if (!episode || episode.deletedAt) throw new EpisodeStorageChangedError();
  const courses = [
    episode.classSection?.class.course,
    episode.examSection?.exam.course,
    episode.practiceSession?.course,
  ].filter((course) => course !== undefined);
  const subjects = new Map<string, number>([
    [instance.subjectId, instance.generation],
    [`episode:${episode.id}`, episode.createdAt.getTime()],
    [`profile:${episode.user.id}`, episode.user.createdAt.getTime()],
  ]);
  for (const course of courses) {
    subjects.set(`course:${course.id}`, course.createdAt.getTime());
    subjects.set(`profile:${course.user.id}`, course.user.createdAt.getTime());
  }
  const examOwner = episode.examSection?.exam.user;
  if (examOwner) subjects.set(`profile:${examOwner.id}`, examOwner.createdAt.getTime());
  for (const id of new Set(additionalProfileIds)) {
    if (subjects.has(`profile:${id}`)) continue;
    const profile = await database.user.findUnique({ where: { id }, select: { createdAt: true } });
    if (!profile) throw new EpisodeStorageChangedError();
    subjects.set(`profile:${id}`, profile.createdAt.getTime());
  }
  const scopes = [...subjects]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([subjectId, generation]) => ({ subjectId, generation }));
  const writes = new StorageWriteJournal(
    {
      query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
    },
    'postgres',
    SIDEDOOR_STATE_ID
  );
  for (const scope of scopes)
    if (await writes.tombstone(scope.subjectId)) throw new EpisodeStorageChangedError();
  return {
    instanceId: instance.instanceId,
    userId: episode.user.id,
    scopes,
    associations: {
      classSection: episode.classSection
        ? { id: episode.classSection.id, classId: episode.classSection.classId }
        : null,
      examSection: episode.examSection
        ? { id: episode.examSection.id, examId: episode.examSection.examId }
        : null,
      practiceSession: episode.practiceSession?.id ?? null,
    },
  };
}

export async function validateEpisodeStorage(
  database: Prisma.TransactionClient,
  episodeId: string,
  expected: Awaited<ReturnType<typeof captureEpisodeStorage>>,
  additionalProfileIds: readonly string[] = []
) {
  const current = await captureEpisodeStorage(database, episodeId, additionalProfileIds);
  if (!isDeepStrictEqual(current, expected)) throw new EpisodeStorageChangedError();
}
