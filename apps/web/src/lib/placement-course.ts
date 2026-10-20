import type { CefrLevel, PlacementSource } from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered } from '@/lib/prisma';
import { getOrCreateCurriculum } from '@/lib/curriculum-generator';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { resolveSkillRequirementsInTransaction } from '@/lib/learning/skill-requirements';
import { ensureLearningLevelBinding } from '@/lib/learning-map/binding';
import { languageCatalogAvailability } from '@/lib/learning-map/catalogs';

export interface InitialCoursePlacement {
  userId: string;
  native: string;
  target: string;
  curriculumId: string;
  level: CefrLevel;
  source?: PlacementSource;
}

/** Caller owns the transaction, including source attachment and confirmation receipts. */
export async function createInitialCourse(
  database: Prisma.TransactionClient,
  input: InitialCoursePlacement,
  execution: SottoProviderExecution
) {
  const actor = await execution.authorize(database);
  if (actor.userId !== input.userId || execution.userId !== actor.userId)
    throw new Error('The initial placement recipient changed.');
  await database.$queryRaw`SELECT id FROM "User" WHERE id = ${input.userId} FOR UPDATE`;
  const existing = await database.course.findUnique({
    where: {
      userId_nativeLang_targetLang: {
        userId: input.userId,
        nativeLang: input.native,
        targetLang: input.target,
      },
    },
  });
  if (existing) return existing;
  const curriculum = await database.curriculum.findFirst({
    where: {
      id: input.curriculumId,
      nativeLang: input.native,
      targetLang: input.target,
    },
    select: { id: true },
  });
  if (!curriculum)
    throw new Error('Initial placement curriculum does not match its language pair.');
  const course = await database.course.create({
    data: {
      userId: input.userId,
      nativeLang: input.native,
      targetLang: input.target,
      curriculumId: curriculum.id,
      currentLevel: input.level,
      startLevel: input.level,
      ...(input.source ? { placementSource: input.source } : {}),
    },
  });
  if (languageCatalogAvailability(input.target).status === 'PUBLISHED') {
    const coverage = await resolveSkillRequirementsInTransaction(database, execution, {
      scope: 'CLASS',
      nativeLang: input.native,
      targetLang: input.target,
      level: input.level,
    });
    await ensureLearningLevelBinding(database, course, input.level, coverage);
  }
  return course;
}

/** Placement can choose an initial band. Existing courses advance through the mastery gate. */
export async function createOrRaiseCourse(
  userId: string,
  execution: SottoProviderExecution,
  native: string,
  target: string,
  level: CefrLevel,
  source?: PlacementSource
) {
  const curriculum = await getOrCreateCurriculum(userId, execution, native, target);
  return sottoTransaction(
    prismaUnfiltered,
    (database) =>
      createInitialCourse(
        database,
        {
          userId,
          native,
          target,
          curriculumId: curriculum.id,
          level,
          ...(source ? { source } : {}),
        },
        execution
      ),
    { signal: execution.signal }
  );
}
