import { isDeepStrictEqual } from 'node:util';
import { learningSkills } from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import { requirePrerequisiteBaseCandidate } from '@/lib/classes/help/content/prerequisite-json';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { authoredSectionSchema } from './assessment-authoring';
import { reserveAssessmentListeningEpisode } from '../material/assessment-audio-reservation';
import { AssessmentFenceConflict } from '../lifecycle/assessment-fence';
import { requirePendingAssessmentWork } from './assessment-work';
import { requireReadAloudAssessmentDraft } from '../speaking/assessment-speaking-policy';

/** Store one private section atomically. Review and publication remain separate. */
export async function stageAssessmentSection(
  database: Prisma.TransactionClient,
  identity: { id: string; fingerprint: string },
  execution: SottoProviderExecution,
  input: unknown
) {
  const { current } = await requirePendingAssessmentWork(database, identity, execution, 'RUNNING');
  return stageWithCurrent(database, execution, current, input);
}

async function stageWithCurrent(
  database: Prisma.TransactionClient,
  execution: SottoProviderExecution,
  current: Awaited<ReturnType<typeof requirePendingAssessmentWork>>['current'],
  input: unknown
) {
  const draft = authoredSectionSchema.parse(input);
  requirePrerequisiteBaseCandidate(draft);
  if (draft.skill === 'SPEAKING' && current.speakingPolicy) requireReadAloudAssessmentDraft(draft);
  if (
    draft.skill === 'SPEAKING' &&
    draft.items.some((item) => 'criteria' in item !== (current.materialVersion === 2))
  )
    throw new AssessmentFenceConflict();
  const requirement = current.requirements.skills[draft.skill];
  if (requirement.state !== 'REQUIRED' || draft.items.length !== requirement.expectedCount)
    throw new AssessmentFenceConflict();
  const section = await database.classAssessmentSection.findUniqueOrThrow({
    where: { assessmentId_skill: { assessmentId: current.assessmentId, skill: draft.skill } },
    include: {
      questions: { orderBy: { order: 'asc' } },
      speakingPrompts: { orderBy: { order: 'asc' } },
      writingPrompts: { orderBy: { order: 'asc' } },
      episode: { include: { script: true } },
    },
  });
  if (section.authoredDraft !== null) {
    if (!isDeepStrictEqual(section.authoredDraft, draft)) throw new AssessmentFenceConflict();
    const questions = section.questions.map((item) => ({
      question: item.question,
      options: item.options,
      correctIndex: item.correctIndex,
      explanation: item.explanation,
    }));
    const speaking = section.speakingPrompts.map((item) => ({
      task: item.targetPhrase,
      mode: item.assessmentTaskMode,
      translation: item.translation,
      rubric: item.assessmentRubric,
      ...(item.assessmentCriteria !== null ? { criteria: item.assessmentCriteria } : {}),
      guidance: item.assessmentGuidance,
    }));
    const writing = section.writingPrompts.map((item) => ({
      task: item.task,
      rubric: item.assessmentRubric,
      guidance: item.guidance,
    }));
    if (draft.skill === 'SPEAKING') {
      if (
        questions.length ||
        writing.length ||
        !isDeepStrictEqual(speaking, draft.items) ||
        section.speakingPrompts.some(
          (prompt) => prompt.ipa !== null || prompt.learningObjectives !== null
        )
      )
        throw new AssessmentFenceConflict();
    } else if (draft.skill === 'WRITING') {
      if (
        questions.length ||
        speaking.length ||
        !isDeepStrictEqual(writing, draft.items) ||
        section.writingPrompts.some(
          (prompt) => prompt.ideas.length !== 0 || prompt.learningObjectives !== null
        )
      )
        throw new AssessmentFenceConflict();
    } else if (
      speaking.length ||
      writing.length ||
      !isDeepStrictEqual(questions, draft.items) ||
      section.passageText !== (draft.skill === 'READING' ? draft.passage : null) ||
      (draft.skill === 'LISTENING' &&
        !isDeepStrictEqual(section.episode?.script?.turns, draft.turns))
    )
      throw new AssessmentFenceConflict();
    return { sectionId: section.id };
  }
  if (
    section.questions.length ||
    section.speakingPrompts.length ||
    section.writingPrompts.length ||
    section.passageText ||
    section.episode?.script
  )
    throw new AssessmentFenceConflict();
  if (draft.skill === 'SPEAKING') {
    await database.speakingPrompt.createMany({
      data: draft.items.map((item, order) => ({
        assessmentSectionId: section.id,
        order,
        targetPhrase: item.task,
        translation: item.translation,
        assessmentTaskMode: item.mode,
        assessmentRubric: item.rubric,
        ...('criteria' in item
          ? { assessmentCriteria: item.criteria as Prisma.InputJsonValue }
          : {}),
        assessmentGuidance: item.guidance,
      })),
    });
  } else if (draft.skill === 'WRITING') {
    await database.writingPrompt.createMany({
      data: draft.items.map((item, order) => ({
        assessmentSectionId: section.id,
        order,
        task: item.task,
        assessmentRubric: item.rubric,
        guidance: item.guidance,
      })),
    });
  } else {
    if (draft.skill === 'LISTENING') {
      const { episodeId } = await reserveAssessmentListeningEpisode(database, execution, {
        classId: current.classId,
        assessmentId: current.assessmentId,
        classAttempt: current.classAttempt,
        assessmentAttempt: current.assessmentAttempt,
        generationOperationId: current.id,
        ownership: current.ownership,
      });
      await database.script.create({
        data: {
          episodeId,
          turns: draft.turns,
          markdown: draft.turns.map((turn) => `${turn.speaker}: ${turn.text}`).join('\n\n'),
        },
      });
      await database.episode.update({ where: { id: episodeId }, data: { status: 'SCRIPT_READY' } });
    }
    await database.classAssessmentQuestion.createMany({
      data: draft.items.map((item, order) => ({
        assessmentId: current.assessmentId,
        sectionId: section.id,
        order,
        ...item,
      })),
    });
  }
  await database.classAssessmentSection.update({
    where: { id: section.id },
    data: {
      authoredDraft: draft,
      ...(draft.skill === 'READING' ? { passageText: draft.passage } : {}),
    },
  });
  execution.signal?.throwIfAborted();
  return { sectionId: section.id };
}

/** Validate all saved drafts under one verified assessment transaction. */
export async function readVerifiedAssessmentDrafts(
  database: Prisma.TransactionClient,
  identity: { id: string; fingerprint: string },
  execution: SottoProviderExecution
) {
  const { current, source } = await requirePendingAssessmentWork(
    database,
    identity,
    execution,
    'RUNNING'
  );
  const sections = await database.classAssessmentSection.findMany({
    where: { assessmentId: current.assessmentId },
    select: { skill: true, authoredDraft: true },
  });
  const required = learningSkills.filter(
    (skill) => current.requirements.skills[skill].state === 'REQUIRED'
  );
  if (sections.length !== required.length) throw new AssessmentFenceConflict();
  const drafts = [];
  for (const section of sections) {
    const draft = authoredSectionSchema.parse(section.authoredDraft);
    if (draft.skill !== section.skill || !required.includes(draft.skill))
      throw new AssessmentFenceConflict();
    await stageWithCurrent(database, execution, current, draft);
    drafts.push(draft);
  }
  return { current, source, drafts };
}
