import { StorageWriteJournal } from 'thesidedoor-core/storage';
import type { Prisma } from '@/generated/prisma/client';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import {
  captureCourseStorage,
  CourseStorageChangedError,
} from '@/lib/sidedoor/storage/core/course-storage';

/** Bind prerequisite work to the owned class generation as well as its course. */
export async function capturePrerequisiteOwnership(
  database: Prisma.TransactionClient,
  classId: string,
  courseId: string,
  userId: string
) {
  const cls = await database.courseClass.findFirst({
    where: { id: classId, courseId, course: { userId } },
    select: { createdAt: true },
  });
  if (!cls) throw new CourseStorageChangedError();
  const ownership = await captureCourseStorage(database, courseId);
  if (ownership.userId !== userId) throw new CourseStorageChangedError();
  const subjectId = `class:${classId}`;
  const journal = new StorageWriteJournal(
    { query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
    'postgres',
    SIDEDOOR_STATE_ID
  );
  if (await journal.tombstone(subjectId)) throw new CourseStorageChangedError();
  return {
    ...ownership,
    scopes: [...ownership.scopes, { subjectId, generation: cls.createdAt.getTime() }].sort(
      (left, right) => left.subjectId.localeCompare(right.subjectId)
    ),
  };
}
