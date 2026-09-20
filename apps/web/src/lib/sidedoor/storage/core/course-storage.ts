import { StorageWriteJournal } from 'thesidedoor-core/storage';
import type { Prisma } from '@/generated/prisma/client';
import { SIDEDOOR_STATE_ID, sottoStorageInstance } from '@/lib/sidedoor/access/state/store';

export class CourseStorageChangedError extends Error {
  constructor() {
    super('Course storage ownership changed');
    this.name = 'CourseStorageChangedError';
  }
}

/** Read course ownership in the caller's Serializable snapshot. */
export async function captureCourseStorage(database: Prisma.TransactionClient, courseId: string) {
  const instance = await sottoStorageInstance(database).read();
  const course = await database.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      createdAt: true,
      user: { select: { id: true, createdAt: true } },
    },
  });
  if (!course) throw new CourseStorageChangedError();
  const scopes = [
    { subjectId: instance.subjectId, generation: instance.generation },
    { subjectId: `course:${course.id}`, generation: course.createdAt.getTime() },
    { subjectId: `profile:${course.user.id}`, generation: course.user.createdAt.getTime() },
  ].sort((left, right) => left.subjectId.localeCompare(right.subjectId));
  const writes = new StorageWriteJournal(
    {
      query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
    },
    'postgres',
    SIDEDOOR_STATE_ID
  );
  for (const scope of scopes)
    if (await writes.tombstone(scope.subjectId)) throw new CourseStorageChangedError();
  return { instanceId: instance.instanceId, userId: course.user.id, scopes };
}
