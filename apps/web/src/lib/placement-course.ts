// Shared course-placement primitive: create the course for a language pair at a
// given CEFR level, or raise an existing course's currentLevel to it (never
// lowering, keeping the original startLevel). Used by both the MC placement
// route and notes-based placement so the safe-level semantics live in one place.
import { prisma } from '@/lib/prisma';
import { getOrCreateCurriculum } from '@/lib/curriculum-generator';
import { higherLevel } from '@/lib/cefr-levels';
import type { CefrLevel } from '@sotto/shared';

/**
 * Create the (native, target) course at `level`, or raise an existing course's
 * currentLevel to it (only upward). startLevel is set on first creation and
 * never rewritten. Returns the upserted course row.
 */
export async function createOrRaiseCourse(
  userId: string,
  native: string,
  target: string,
  level: CefrLevel,
) {
  const curriculum = await getOrCreateCurriculum(userId, native, target);

  const existing = await prisma.course.findUnique({
    where: { userId_nativeLang_targetLang: { userId, nativeLang: native, targetLang: target } },
    select: { currentLevel: true },
  });
  const nextCurrentLevel = existing ? higherLevel(existing.currentLevel, level) : level;

  return prisma.course.upsert({
    where: { userId_nativeLang_targetLang: { userId, nativeLang: native, targetLang: target } },
    create: {
      userId,
      nativeLang: native,
      targetLang: target,
      curriculumId: curriculum.id,
      currentLevel: level,
      startLevel: level,
    },
    // startLevel intentionally not updated — it is the immutable first placement.
    update: { currentLevel: nextCurrentLevel },
  });
}
