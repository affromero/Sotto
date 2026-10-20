import { vocabularySupportGuidance } from '@sotto/shared';
import { prisma } from '../../prisma';

/** Capture support in generation notes; later setting changes affect subsequent requests. */
export async function getVocabularySupportContext(
  courseId: string,
  userId: string
): Promise<string> {
  const course = await prisma.course.findFirst({
    where: { id: courseId, userId },
    select: { vocabularySupport: true },
  });
  if (!course) throw new Error('Vocabulary support requires an owned course.');
  return vocabularySupportGuidance(course.vocabularySupport);
}
