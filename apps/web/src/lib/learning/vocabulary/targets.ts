import { prismaUnfiltered as prisma } from '../../prisma';
import type { DueItems } from '../../knowledge-graph';
import { selectVocabularyTargets, type VocabularyTarget } from './selection';
import { introducedVocabularyWhere, unseenVocabularyWhere } from './memory';
import type { LearningDatabase } from '../database';

/** Read active learning and the unseen queue separately so a large import cannot hide reviews. */
export async function getVocabularyTargets(
  courseId: string,
  due: DueItems['vocab'],
  candidates: readonly VocabularyTarget[],
  limit: number,
  database: Pick<LearningDatabase, 'learnerVocab'> = prisma
): Promise<VocabularyTarget[]> {
  const select = {
    lemma: true,
    translation: true,
    partOfSpeech: true,
    mastery: true,
    reps: true,
    lastReviewed: true,
    firstSeenClassId: true,
    introducedAt: true,
    dueAt: true,
  } as const;
  const identities = [...new Set([...due, ...candidates].map((word) => word.lemma))];
  const [active, unseen, ranked] = await Promise.all([
    database.learnerVocab.findMany({
      where: {
        courseId,
        ...introducedVocabularyWhere(),
      },
      select,
      orderBy: [{ mastery: 'asc' }, { dueAt: 'asc' }],
      take: Math.max(64, limit * 4),
    }),
    database.learnerVocab.findMany({
      where: { courseId, ...unseenVocabularyWhere() },
      select,
      orderBy: [{ createdAt: 'asc' }, { lemma: 'asc' }],
      take: limit,
    }),
    identities.length
      ? database.learnerVocab.findMany({
          where: { courseId, lemma: { in: identities } },
          select,
        })
      : Promise.resolve([]),
  ]);
  const memory = new Map([...active, ...unseen, ...ranked].map((word) => [word.lemma, word]));
  return selectVocabularyTargets(candidates, due, [...memory.values()], limit, new Date());
}
