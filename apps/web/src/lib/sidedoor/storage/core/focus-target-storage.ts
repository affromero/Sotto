import type { Prisma } from '@/generated/prisma/client';
import {
  captureCourseStorage,
  CourseStorageChangedError,
} from '@/lib/sidedoor/storage/core/course-storage';

export class FocusTargetStorageChangedError extends Error {
  constructor() {
    super('Learning target storage ownership changed');
    this.name = 'FocusTargetStorageChangedError';
  }
}

export async function captureFocusTargetStorage(database: Prisma.TransactionClient, id: string) {
  const target = await database.learnerFocusTarget.findUnique({
    where: { id },
    select: {
      id: true,
      courseId: true,
      createdAt: true,
      pronunciationAudioUrl: true,
      visualCueUrl: true,
    },
  });
  if (!target) throw new FocusTargetStorageChangedError();
  try {
    const course = await captureCourseStorage(database, target.courseId);
    return {
      ...course,
      target: {
        id: target.id,
        courseId: target.courseId,
        createdAt: target.createdAt.getTime(),
        pronunciationAudioUrl: target.pronunciationAudioUrl,
        visualCueUrl: target.visualCueUrl,
      },
    };
  } catch (error) {
    if (error instanceof CourseStorageChangedError) throw new FocusTargetStorageChangedError();
    throw error;
  }
}
