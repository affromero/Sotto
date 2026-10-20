import type { CefrLevel, LearningSelectionSnapshot, SkillRequirements } from '@sotto/shared';
import { skillRequirementsSchema } from '@sotto/shared';
import { prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { captureObjectiveAssessmentScope } from './scope';
import { reviewObjectiveTasks } from './review';
import type { ObjectiveAssessmentScope } from './protocol';
import { learningScriptHash, learningScriptTranscript } from '@/lib/learning/script-hash';

export interface AssessmentProducerContext {
  courseId: string;
  userId: string;
  execution: SottoProviderExecution;
  requirements: SkillRequirements;
  learningSelection?: LearningSelectionSnapshot | null;
  grammarKeys?: readonly string[];
}
export async function capturePracticeAssessmentScope(input: AssessmentProducerContext) {
  return sottoTransaction(
    prismaUnfiltered,
    (database) =>
      captureObjectiveAssessmentScope(database, {
        ...input,
        selection: input.learningSelection,
        level: input.requirements.level,
      }),
    { signal: input.execution.signal }
  );
}
export async function captureClassAssessmentScope(input: {
  classId: string;
  userId: string;
  execution: SottoProviderExecution;
}) {
  return sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      const cls = await database.courseClass.findFirst({
        where: { id: input.classId, course: { userId: input.userId } },
        include: { lesson: { include: { learningObjectives: true } } },
      });
      if (!cls) throw new Error('Class assessment requires its owned session.');
      if (!cls.skillRequirements) return null;
      const requirements = skillRequirementsSchema.parse(cls.skillRequirements);
      return captureObjectiveAssessmentScope(database, {
        ...input,
        courseId: cls.courseId,
        requirements,
        level: requirements.level as CefrLevel,
        selection: cls.learningSelection as LearningSelectionSnapshot | null,
        objectiveIds: cls.lesson.learningObjectives.map((link) => link.objectiveId),
      });
    },
    { signal: input.execution.signal }
  );
}
interface McQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  passageText?: string;
}
export async function reviewMultipleChoiceAssessments<T extends McQuestion>(input: {
  userId: string;
  execution: SottoProviderExecution;
  scope: ObjectiveAssessmentScope | null;
  skill: 'GRAMMAR' | 'READING' | 'LISTENING';
  questions: readonly T[];
  audio?: { scriptSha256: string; contentSha256: string };
  transcript?: string;
  pendingListeningScriptSha256?: string;
}) {
  const assessments = await reviewObjectiveTasks({
    ...input,
    tasks: input.questions.map((question) => ({
      kind: 'KEYED_MULTIPLE_CHOICE',
      question: question.question,
      options: question.options,
      correctIndex: question.correctIndex,
      passageText:
        input.skill === 'LISTENING' ? (input.transcript ?? null) : (question.passageText ?? null),
      audio: input.audio ?? null,
    })),
  });
  return input.questions.map((question, index) => ({
    ...question,
    learningAssessment: assessments[index] ?? null,
  }));
}
export async function reviewPracticeMultipleChoice<T extends McQuestion>(
  input: AssessmentProducerContext & {
    skill: 'GRAMMAR' | 'READING';
    questions: readonly T[];
  }
) {
  const scope = await capturePracticeAssessmentScope(input);
  return reviewMultipleChoiceAssessments({ ...input, scope });
}
export async function reviewPracticeListeningQuestions<T extends McQuestion>(
  input: AssessmentProducerContext & { questions: readonly T[]; turns: unknown }
) {
  const scope = await capturePracticeAssessmentScope(input);
  return reviewMultipleChoiceAssessments({
    ...input,
    scope,
    skill: 'LISTENING',
    pendingListeningScriptSha256: learningScriptHash(input.turns),
    transcript: learningScriptTranscript(input.turns),
  });
}
interface WritingTask {
  task: string;
  guidance: string | null;
  ideas: string[];
}
export async function reviewWritingAssessments<T extends WritingTask>(input: {
  userId: string;
  execution: SottoProviderExecution;
  scope: ObjectiveAssessmentScope | null;
  prompts: readonly T[];
}) {
  const assessments = await reviewObjectiveTasks({
    ...input,
    skill: 'WRITING',
    tasks: input.prompts.map((prompt) => ({
      kind: 'ORIGINAL_WRITING',
      task: prompt.task,
      guidance: prompt.guidance,
      suppliedSupport: prompt.ideas,
    })),
  });
  return input.prompts.map((prompt, index) => ({
    ...prompt,
    learningObjectives: assessments[index] ?? null,
  }));
}
export async function reviewPracticeWritingPrompts<T extends WritingTask>(
  input: AssessmentProducerContext & { prompts: readonly T[] }
) {
  const scope = await capturePracticeAssessmentScope(input);
  return reviewWritingAssessments({ ...input, scope });
}
