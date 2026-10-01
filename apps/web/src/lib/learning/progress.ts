import { z } from 'zod';
import { prisma } from '../prisma';
import type { PracticeMcItem } from '../practice/types';
import { currentClassSections } from './classes/current-sections';
import { learningProgressRequestSchema } from '@sotto/shared';

export const learningProgressSchema = learningProgressRequestSchema;

export class LearningProgressConflict extends Error {}

export async function saveLearningProgress(
  kind: 'CLASS' | 'PRACTICE',
  id: string,
  userId: string,
  progress: z.infer<typeof learningProgressSchema>
): Promise<number | false> {
  return prisma.$transaction(async (tx) => {
    if (kind === 'CLASS')
      await tx.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${id} FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM "PracticeSession" WHERE id = ${id} FOR UPDATE`;
    const parent =
      kind === 'CLASS'
        ? await tx.courseClass.findFirst({
            where: { id, course: { userId } },
            include: { sections: { include: { questions: true, writingPrompts: true } } },
          })
        : await tx.practiceSession.findFirst({
            where: { id, course: { userId } },
            include: { writingPrompts: true },
          });
    if (!parent) return false;
    if (parent.progressRevision !== progress.expectedRevision)
      throw new LearningProgressConflict(
        'Your learning progress changed in another tab. Reload before saving more work.'
      );
    if (!['ACTIVE', 'AVAILABLE', 'IN_PROGRESS'].includes(parent.status))
      throw new LearningProgressConflict('This session no longer accepts edits.');
    const questions =
      'sections' in parent
        ? currentClassSections(parent.sections).flatMap((section) =>
            section.questions.map((question) => ({ id: question.id, options: question.options }))
          )
        : (parent.items as unknown as PracticeMcItem[]);
    const writingPrompts =
      'sections' in parent
        ? currentClassSections(parent.sections).flatMap((section) => section.writingPrompts)
        : parent.writingPrompts;
    if (
      progress.answers &&
      Object.entries(progress.answers).some(
        ([key, value]) =>
          !questions.some(
            (question) =>
              question.id === key &&
              Array.isArray(question.options) &&
              value < question.options.length
          )
      )
    )
      throw new LearningProgressConflict('A saved answer belongs to different learning material.');
    if (
      progress.writingDrafts &&
      Object.keys(progress.writingDrafts).some(
        (key) => !writingPrompts.some((prompt) => prompt.id === key)
      )
    )
      throw new LearningProgressConflict('A saved draft belongs to different learning material.');
    const answers = z.record(z.string(), z.number()).safeParse(parent.learnerAnswers);
    const drafts = z.record(z.string(), z.string()).safeParse(parent.writingDrafts);
    const data = {
      progressRevision: { increment: 1 },
      ...(progress.answers
        ? {
            learnerAnswers: {
              ...Object.fromEntries(
                Object.entries(answers.success ? answers.data : {}).filter(([id]) =>
                  questions.some((question) => question.id === id)
                )
              ),
              ...progress.answers,
            },
          }
        : {}),
      ...(progress.writingDrafts
        ? {
            writingDrafts: {
              ...Object.fromEntries(
                Object.entries(drafts.success ? drafts.data : {}).filter(([id]) =>
                  writingPrompts.some((prompt) => prompt.id === id)
                )
              ),
              ...progress.writingDrafts,
            },
          }
        : {}),
    };
    if (kind === 'CLASS') await tx.courseClass.update({ where: { id }, data });
    else await tx.practiceSession.update({ where: { id }, data });
    return parent.progressRevision + 1;
  });
}
