// Derives the generation spec for a mock exam from the curriculum at the exam's
// level. Unlike a class (one lesson) or practice (due/weak items), an exam tests
// the whole level, so we aggregate every lesson at that level into one
// representative objective + grammar + vocab set the section generators draw on.
import { prisma } from './prisma';
import type { CefrLevel } from '@sotto/shared';

export interface ExamSpec {
  objective: string;
  grammarPoints: string[];
  targetVocab: Array<{ lemma: string; gloss: string }>;
}

export async function resolveExamSpec(curriculumId: string, level: CefrLevel): Promise<ExamSpec> {
  const lessons = await prisma.lesson.findMany({
    where: { curriculumId, level },
    orderBy: { order: 'asc' },
    select: { objective: true, grammarPoints: true, targetVocab: true, canDoSummary: true },
  });

  const grammar = new Set<string>();
  const vocab: Array<{ lemma: string; gloss: string }> = [];
  const seen = new Set<string>();
  for (const lesson of lessons) {
    for (const g of (Array.isArray(lesson.grammarPoints) ? lesson.grammarPoints : []) as string[]) {
      if (g) grammar.add(g);
    }
    for (const v of (Array.isArray(lesson.targetVocab) ? lesson.targetVocab : []) as Array<{
      lemma: string;
      gloss: string;
    }>) {
      if (v?.lemma && !seen.has(v.lemma)) {
        seen.add(v.lemma);
        vocab.push({ lemma: v.lemma, gloss: v.gloss ?? '' });
      }
    }
  }

  const canDos = lessons
    .map((l) => l.canDoSummary ?? l.objective)
    .filter((s): s is string => Boolean(s))
    .slice(0, 5);
  const objective =
    canDos.length > 0
      ? `Demonstrate ${level} proficiency across: ${canDos.join('; ')}`
      : `Demonstrate ${level} proficiency in everyday and study contexts.`;

  return { objective, grammarPoints: [...grammar], targetVocab: vocab };
}
