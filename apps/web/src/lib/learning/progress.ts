import { z } from 'zod';
import { prismaUnfiltered as prisma } from '../prisma';
import type { PracticeMcItem } from '../practice/types';
import { currentClassSections } from './classes/progress/current-sections';
import { learningProgressRequestSchema } from '@sotto/shared';
import { assertVocabularyStudyOwner, vocabularyStudyStateSchema } from '../vocabulary/study-state';
import { sottoTransaction } from '../sidedoor/access/state/transaction';
import { classProgressRevision } from './classes/progress/progress-revision';
import type { SottoProviderExecution } from '../sidedoor/credentials/runtime/provider-execution';

export const learningProgressSchema = learningProgressRequestSchema;

export class LearningProgressConflict extends Error {}

export async function saveLearningProgress(
  kind: 'CLASS' | 'PRACTICE',
  id: string,
  userId: string,
  progress: z.infer<typeof learningProgressSchema>,
  execution: SottoProviderExecution
): Promise<number | false> {
  return sottoTransaction(
    prisma,
    async (tx) => {
      execution.signal?.throwIfAborted();
      const actor = await execution.authorize(tx);
      if (actor.userId !== userId || execution.userId !== userId) return false;
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
      const classRevision = kind === 'CLASS' ? await classProgressRevision(tx, id, userId) : null;
      if (classRevision?.access === 'BLOCKED')
        throw new LearningProgressConflict(
          'Review the prerequisite teaching before saving this work.'
        );
      if (kind === 'CLASS' && progress.expectedAttempt === undefined)
        throw new LearningProgressConflict(
          'This class needs a current material revision. Keep your edits and reopen the class.'
        );
      if (progress.expectedAttempt !== undefined) {
        if (
          kind !== 'CLASS' ||
          !('attempt' in parent) ||
          parent.attempt !== progress.expectedAttempt
        )
          throw new LearningProgressConflict(
            'This class attempt changed. Keep your edits and reopen the class.'
          );
        if (classRevision?.revision !== progress.taskMaterialRevision)
          throw new LearningProgressConflict(
            'This class material changed. Keep your edits and reopen the class.'
          );
      }
      if (parent.progressRevision !== progress.expectedRevision)
        throw new LearningProgressConflict(
          'Your learning progress changed in another tab. Reload before saving more work.'
        );
      if (!['ACTIVE', 'AVAILABLE', 'IN_PROGRESS'].includes(parent.status))
        throw new LearningProgressConflict('This session no longer accepts edits.');
      if ('vocabularyStudy' in parent && parent.vocabularyStudy) {
        const state = vocabularyStudyStateSchema.parse(parent.vocabularyStudy);
        assertVocabularyStudyOwner(state, parent, userId);
        if (
          Object.keys(progress.answers ?? {}).length ||
          Object.entries(progress.writingDrafts ?? {}).some(
            ([id, text]) =>
              text.length > 1000 ||
              state.mode === 'FLASHCARDS' ||
              !state.cards.some((card) => card.id === id && !card.response)
          )
        )
          throw new LearningProgressConflict('A saved answer belongs to different study material.');
        const drafts = z.record(z.string(), z.string()).safeParse(parent.writingDrafts);
        await tx.practiceSession.update({
          where: { id },
          data: {
            writingDrafts: { ...(drafts.success ? drafts.data : {}), ...progress.writingDrafts },
            progressRevision: { increment: 1 },
          },
        });
        execution.signal?.throwIfAborted();
        return parent.progressRevision + 1;
      }
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
        throw new LearningProgressConflict(
          'A saved answer belongs to different learning material.'
        );
      if (
        progress.writingDrafts &&
        Object.keys(progress.writingDrafts).some(
          (key) => !writingPrompts.some((prompt) => prompt.id === key)
        )
      )
        throw new LearningProgressConflict('A saved draft belongs to different learning material.');
      const answers = z.record(z.string(), z.number()).safeParse(parent.learnerAnswers);
      const drafts = z.record(z.string(), z.string()).safeParse(parent.writingDrafts);
      if (
        kind === 'CLASS' &&
        progress.answers &&
        parent.learnerAnswers !== null &&
        !answers.success
      )
        throw new LearningProgressConflict(
          'Saved answers need recovery before new progress can be saved.'
        );
      if (
        kind === 'CLASS' &&
        progress.writingDrafts &&
        parent.writingDrafts !== null &&
        !drafts.success
      )
        throw new LearningProgressConflict(
          'Saved drafts need recovery before new progress can be saved.'
        );
      const data = {
        progressRevision: { increment: 1 },
        ...(progress.answers
          ? {
              learnerAnswers: {
                ...Object.fromEntries(
                  Object.entries(answers.success ? answers.data : {}).filter(
                    ([id]) => kind === 'CLASS' || questions.some((question) => question.id === id)
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
                  Object.entries(drafts.success ? drafts.data : {}).filter(
                    ([id]) => kind === 'CLASS' || writingPrompts.some((prompt) => prompt.id === id)
                  )
                ),
                ...progress.writingDrafts,
              },
            }
          : {}),
      };
      if (kind === 'CLASS') await tx.courseClass.update({ where: { id }, data });
      else await tx.practiceSession.update({ where: { id }, data });
      execution.signal?.throwIfAborted();
      return parent.progressRevision + 1;
    },
    { signal: execution.signal }
  );
}
