import { z } from 'zod';
import type { SkillRequirements } from '@sotto/shared';
import type { QuizRetryContext } from '../../classes/quiz/retry';
import { PreparationConflictError, quizRetryContextSchema } from '../../classes/preparation-state';
import { currentClassSections } from './current-sections';
import type { RepairClass } from './class-repair';

export interface ClassQuizRetryRequest {
  sectionId: string;
  expectedAttempt: number;
  expectedRevision: number;
}

/** Capture missed concepts from owned, complete work before admitting new material. */
export function captureClassQuizRetry(
  cls: RepairClass,
  requirements: SkillRequirements,
  request: ClassQuizRetryRequest
): {
  skill: 'GRAMMAR' | 'READING' | 'LISTENING';
  context: QuizRetryContext;
} {
  if (
    cls.attempt !== request.expectedAttempt ||
    cls.progressRevision !== request.expectedRevision ||
    !['AVAILABLE', 'IN_PROGRESS'].includes(cls.status)
  )
    throw new PreparationConflictError('The class progress changed. Reload before retrying.');
  const sections = currentClassSections(cls.sections);
  const section = sections.find((item) => item.id === request.sectionId);
  if (
    !section ||
    sections.filter((item) => item.skill === section.skill).length !== 1 ||
    (section.skill !== 'GRAMMAR' && section.skill !== 'READING' && section.skill !== 'LISTENING')
  )
    throw new PreparationConflictError('Choose a current multiple-choice section to retry.');
  const skill = section.skill;
  const requirement = requirements.skills[skill];
  if (
    requirement.state !== 'REQUIRED' ||
    section.status !== 'READY' ||
    section.passed === true ||
    section.questions.length !== requirement.expectedCount ||
    new Set(section.questions.map((question) => question.id)).size !== section.questions.length ||
    !Number.isFinite(section.passThreshold) ||
    section.passThreshold < 0 ||
    section.passThreshold > 1
  )
    throw new PreparationConflictError('This section is not available for a new quiz attempt.');
  const parsed = z.record(z.string(), z.number().int().nonnegative()).safeParse(cls.learnerAnswers);
  const answers = parsed.success ? parsed.data : {};
  const missedQuestions: QuizRetryContext['missedQuestions'] = [];
  let correct = 0;
  for (const question of section.questions) {
    const selected = answers[question.id];
    const options = z.array(z.string().min(1)).min(2).max(4).safeParse(question.options);
    if (
      !options.success ||
      selected === undefined ||
      selected >= options.data.length ||
      question.correctIndex < 0 ||
      question.correctIndex >= options.data.length
    )
      throw new PreparationConflictError('Finish and save every answer before retrying.');
    if (selected === question.correctIndex) correct++;
    else
      missedQuestions.push({
        question: question.question,
        selectedAnswer: options.data[selected],
        explanation: question.explanation,
      });
  }
  if (correct / section.questions.length >= section.passThreshold)
    throw new PreparationConflictError('This section already meets its mastery threshold.');
  const previousQuestions = cls.sections
    .filter((item) => item.skill === skill)
    .flatMap((item) => item.questions)
    .map((question) => ({
      question: question.question,
      options: question.options,
    }));
  const context = quizRetryContextSchema.safeParse({ previousQuestions, missedQuestions });
  if (!context.success)
    throw new PreparationConflictError('The saved quiz history cannot be used for this retry.');
  return { skill, context: context.data };
}
