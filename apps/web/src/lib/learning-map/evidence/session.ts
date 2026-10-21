import type { Prisma } from '@/generated/prisma/client';
import { reviewedObjectiveAssessmentSchema, type ObjectiveTask } from './protocol';
import { assertSelectedLearningAudio } from './audio';
import { learningScriptTranscript } from '@/lib/learning/script-hash';
import {
  isPrivateSpeakingAssessment,
  privateSpeakingAssessmentSchema,
} from './private-speaking/protocol';
import {
  multipleChoiceObservation,
  productiveObservation,
  publishObjectiveObservations,
} from './submission';
import type { QualifiedObjectiveObservation } from './record';

interface Question {
  id: string;
  question: string;
  options: unknown;
  correctIndex: number;
  passageText: string | null;
  learningAssessment: unknown;
}
interface ProductivePrompt {
  id: string;
  learningObjectives: unknown;
  task?: string;
  guidance?: string | null;
  ideas?: string[];
  targetPhrase?: string;
  translation?: string;
  recordings?: Array<{
    attempt: number;
    status: string;
    transcript: string | null;
    objectiveEvidence: unknown;
  }>;
  responses?: Array<{
    attempt: number;
    text: string;
    overallScore: number | null;
    objectiveEvidence: unknown;
  }>;
}
export interface ClassEvidenceSection {
  id: string;
  skill: string;
  attempt: number;
  episodeId: string | null;
  questions: Question[];
  prompts: ProductivePrompt[];
  writingPrompts: ProductivePrompt[];
}

async function checkedMcTask(
  database: Prisma.TransactionClient,
  question: Omit<Question, 'id'>,
  episodeId: string | null
): Promise<ObjectiveTask> {
  const assessment = reviewedObjectiveAssessmentSchema.parse(question.learningAssessment);
  let source = question.passageText;
  if (assessment.criterion.skill === 'LISTENING') {
    if (!assessment.media || assessment.media.episodeId !== episodeId)
      throw new Error('Listening task changed its selected episode.');
    await assertSelectedLearningAudio(database, assessment.media);
    const episode = await database.episode.findUniqueOrThrow({
      where: { id: assessment.media.episodeId },
      include: { script: true },
    });
    source = learningScriptTranscript(episode.script!.turns);
  }
  if (
    !Array.isArray(question.options) ||
    question.options.some((option) => typeof option !== 'string')
  )
    throw new Error('Assessment choices changed their stored content.');
  return {
    kind: 'KEYED_MULTIPLE_CHOICE',
    question: question.question,
    options: question.options as string[],
    correctIndex: question.correctIndex,
    passageText: source,
    audio:
      assessment.criterion.skill === 'LISTENING' && assessment.media
        ? {
            scriptSha256: assessment.media.scriptSha256,
            contentSha256: assessment.media.contentSha256,
          }
        : null,
  };
}
function addProductive(
  observations: Array<QualifiedObjectiveObservation | null>,
  input: { courseId: string; userId: string; sessionId: string; attempt: number },
  prompt: ProductivePrompt,
  skill: 'WRITING' | 'SPEAKING'
) {
  if (!prompt.learningObjectives) return;
  if (isPrivateSpeakingAssessment(prompt.learningObjectives)) {
    if (skill !== 'SPEAKING') throw new Error('Private speaking feedback cannot assess writing.');
    privateSpeakingAssessmentSchema.parse(prompt.learningObjectives);
    return;
  }
  const assessment = reviewedObjectiveAssessmentSchema.parse(prompt.learningObjectives);
  if (skill === 'WRITING') {
    const response = prompt.responses?.find((row) => row.attempt === input.attempt);
    if (!response || response.overallScore === null) return;
    observations.push(
      productiveObservation({
        ...input,
        sourceType: 'WRITING_CRITERION',
        assessment,
        task: {
          kind: 'ORIGINAL_WRITING',
          task: prompt.task!,
          guidance: prompt.guidance ?? null,
          suppliedSupport: prompt.ideas ?? [],
        },
        text: response.text,
        finding: response.objectiveEvidence,
      })
    );
  } else {
    const recording = prompt.recordings?.find((row) => row.attempt === input.attempt);
    if (!recording || recording.status !== 'SCORED' || recording.transcript === null) return;
    observations.push(
      productiveObservation({
        ...input,
        sourceType: 'SPEAKING_CRITERION',
        assessment,
        task: {
          kind: 'COMMUNICATIVE_SPEAKING',
          task: prompt.targetPhrase!,
          guidance: prompt.translation ?? null,
          suppliedSupport: [],
        },
        text: recording.transcript,
        finding: recording.objectiveEvidence,
      })
    );
  }
}

export async function recordClassAssessmentObservations(
  database: Prisma.TransactionClient,
  input: {
    courseId: string;
    userId: string;
    classId: string;
    sections: readonly ClassEvidenceSection[];
    answers: readonly { questionId: string; selectedIndex: number }[];
  }
) {
  const observations: Array<QualifiedObjectiveObservation | null> = [];
  const answers = new Map(input.answers.map((answer) => [answer.questionId, answer.selectedIndex]));
  for (const section of input.sections) {
    const work = {
      courseId: input.courseId,
      userId: input.userId,
      sessionId: `class:${input.classId}:${section.skill}:${section.attempt}`,
      attempt: section.attempt,
    };
    for (const question of section.questions) {
      if (!question.learningAssessment) continue;
      if (!['GRAMMAR', 'READING', 'LISTENING'].includes(section.skill))
        throw new Error('A productive section cannot publish keyed evidence.');
      const selectedIndex = answers.get(question.id);
      if (selectedIndex === undefined)
        throw new Error('Reviewed question has no committed learner response.');
      observations.push(
        multipleChoiceObservation({
          ...work,
          sourceType: 'CLASS_QUESTION',
          skill: section.skill as 'GRAMMAR' | 'READING' | 'LISTENING',
          assessment: question.learningAssessment,
          task: await checkedMcTask(database, question, section.episodeId),
          selectedIndex,
        })
      );
    }
    for (const prompt of section.writingPrompts)
      addProductive(observations, work, prompt, 'WRITING');
    for (const prompt of section.prompts) addProductive(observations, work, prompt, 'SPEAKING');
  }
  return publishObjectiveObservations(database, observations);
}

export async function recordPracticeAssessmentObservations(
  database: Prisma.TransactionClient,
  input: {
    courseId: string;
    userId: string;
    sessionId: string;
    episodeId: string | null;
    items: readonly {
      id: string;
      prompt: string;
      options: string[];
      correctIndex: number;
      passageText?: string;
      learningAssessment?: unknown;
    }[];
    answers: readonly { itemId: string; selectedIndex: number }[];
    prompts: ProductivePrompt[];
    writingPrompts: ProductivePrompt[];
  }
) {
  const observations: Array<QualifiedObjectiveObservation | null> = [];
  const answers = new Map(input.answers.map((answer) => [answer.itemId, answer.selectedIndex]));
  const work = {
    courseId: input.courseId,
    userId: input.userId,
    sessionId: `practice:${input.sessionId}`,
    attempt: 1,
  };
  for (const item of input.items) {
    if (!item.learningAssessment) continue;
    const assessment = reviewedObjectiveAssessmentSchema.parse(item.learningAssessment);
    const skill = assessment.criterion.skill;
    if (!['GRAMMAR', 'READING', 'LISTENING'].includes(skill))
      throw new Error('Practice question cannot assess a productive skill.');
    const selectedIndex = answers.get(item.id);
    if (selectedIndex === undefined)
      throw new Error('Reviewed practice question has no committed response.');
    observations.push(
      multipleChoiceObservation({
        ...work,
        sourceType: 'PRACTICE_QUESTION',
        skill: skill as 'GRAMMAR' | 'READING' | 'LISTENING',
        assessment,
        task: await checkedMcTask(
          database,
          {
            question: item.prompt,
            options: item.options,
            correctIndex: item.correctIndex,
            passageText: item.passageText ?? null,
            learningAssessment: assessment,
          },
          input.episodeId
        ),
        selectedIndex,
      })
    );
  }
  for (const prompt of input.writingPrompts) addProductive(observations, work, prompt, 'WRITING');
  for (const prompt of input.prompts) addProductive(observations, work, prompt, 'SPEAKING');
  return publishObjectiveObservations(database, observations);
}
