// Shared course-placement primitive: create the course for a language pair at a
// given CEFR level, or raise an existing course's currentLevel to it (never
// lowering, keeping the original startLevel). Used by both the MC placement
// route and notes-based placement so the safe-level semantics live in one place.
import { prisma } from '@/lib/prisma';
import { getOrCreateCurriculum } from '@/lib/curriculum-generator';
import { higherLevel } from '@/lib/cefr-levels';
import type { CefrLevel } from '@sotto/shared';
import type { PlacementSource } from '@/generated/prisma/client';

/**
 * Create the (native, target) course at `level`, or raise an existing course's
 * currentLevel to it (only upward). startLevel is set on first creation and
 * never rewritten. `source` records how the level was set; it is stamped on
 * creation and, on an existing course, only when the level actually raises — a
 * retake or manual pick that does not move the level leaves provenance intact.
 * Returns the upserted course row.
 */
export async function createOrRaiseCourse(
  userId: string,
  native: string,
  target: string,
  level: CefrLevel,
  source?: PlacementSource,
) {
  const curriculum = await getOrCreateCurriculum(userId, native, target);

  const existing = await prisma.course.findUnique({
    where: { userId_nativeLang_targetLang: { userId, nativeLang: native, targetLang: target } },
    select: { currentLevel: true },
  });
  const nextCurrentLevel = existing ? higherLevel(existing.currentLevel, level) : level;
  const raised = Boolean(existing) && nextCurrentLevel !== existing!.currentLevel;

  return prisma.course.upsert({
    where: { userId_nativeLang_targetLang: { userId, nativeLang: native, targetLang: target } },
    create: {
      userId,
      nativeLang: native,
      targetLang: target,
      curriculumId: curriculum.id,
      currentLevel: level,
      startLevel: level,
      ...(source ? { placementSource: source } : {}),
    },
    // startLevel intentionally not updated — it is the immutable first placement.
    // placementSource is updated only on a real raise (see doc comment).
    update: {
      currentLevel: nextCurrentLevel,
      ...(source && raised ? { placementSource: source } : {}),
    },
  });
}
