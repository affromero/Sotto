import { isDeepStrictEqual } from 'node:util';
import {
  classReceiptSchema,
  learningSkills,
  skillRequirementsSchema,
  type SkillType,
} from '@sotto/shared';
import { z } from 'zod';
import { classQuestionMaterialSchema } from '../formative/class-material';
import {
  READ_ALOUD_ASSESSMENT_POLICY,
  requireReadAloudAssessmentMaterial,
} from '../speaking/assessment-speaking-policy';
import { objectiveEvidenceHash } from '../../../learning-map/evidence/protocol';
import {
  assertLearningMaterial,
  evaluateLearningWork,
  scorePreviouslyValidatedLearningWork,
  type LearningSectionWork,
} from '../../session-evaluation';

const id = z.string().trim().min(1).max(256);
const text = z.string().trim().min(1).max(100_000);
const threshold = z.number().finite().min(0).max(1);
const question = classQuestionMaterialSchema
  .extend({ id })
  .strict()
  .refine(
    (item) =>
      item.question.length <= 100_000 &&
      item.explanation.length <= 100_000 &&
      item.options.every((option) => option.length <= 100_000),
    'Assessment question is too large.'
  );
const speaking = z
  .object({
    id,
    task: text,
    mode: z.enum(['READ_ALOUD', 'COMMUNICATIVE']),
    referenceAudioId: id.nullable(),
    privateRubric: text,
    privateGuidance: z.string().max(100_000),
    privateTranslation: z.string().max(100_000),
    privateIpa: z.string().max(100_000).nullable(),
    privateLearningObjectives: z.json().nullable(),
  })
  .strict();
export const assessmentSpeakingCriteriaSchema = z
  .array(
    z
      .object({
        id: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
        description: z.string().trim().min(1).max(4000),
        modality: z.enum(['TRANSCRIPT', 'ACOUSTIC']),
      })
      .strict()
  )
  .min(1)
  .max(20)
  .refine(
    (criteria) => new Set(criteria.map((criterion) => criterion.id)).size === criteria.length
  );
const speakingV2 = speaking.extend({ privateCriteria: assessmentSpeakingCriteriaSchema });
const writing = z
  .object({
    id,
    task: text,
    privateRubric: text,
    privateGuidance: z.string().max(100_000).nullable(),
    privateIdeas: z.array(z.string().max(100_000)).max(32),
    privateLearningObjectives: z.json().nullable(),
  })
  .strict();
const mcSection = z
  .object({
    id,
    skill: z.enum(['GRAMMAR', 'READING', 'LISTENING']),
    passThreshold: threshold,
    items: z.array(question).max(20),
    passageText: z.string().max(100_000).nullable(),
    audio: z
      .object({
        episodeId: id,
        mediaIdentity: id,
        privateTranscript: text,
      })
      .strict()
      .nullable(),
  })
  .strict();
const speakingSection = z
  .object({
    id,
    skill: z.literal('SPEAKING'),
    passThreshold: threshold,
    items: z.array(speaking).max(20),
  })
  .strict();
const speakingSectionV2 = speakingSection.extend({ items: z.array(speakingV2).max(20) });
const writingSection = z
  .object({
    id,
    skill: z.literal('WRITING'),
    passThreshold: threshold,
    items: z.array(writing).max(20),
  })
  .strict();

const privateAssessmentV1Schema = z
  .object({
    version: z.literal(1),
    id,
    classId: id,
    courseId: id,
    userId: id,
    classAttempt: z.number().int().positive(),
    assessmentAttempt: z.number().int().positive(),
    formativeRevision: id,
    requirements: skillRequirementsSchema,
    sections: z.array(z.union([mcSection, speakingSection, writingSection])).max(5),
  })
  .strict();
const privateAssessmentV2Schema = privateAssessmentV1Schema.extend({
  version: z.literal(2),
  sections: z.array(z.union([mcSection, speakingSectionV2, writingSection])).max(5),
});
const privateAssessmentSchema = z.discriminatedUnion('version', [
  privateAssessmentV1Schema,
  privateAssessmentV2Schema,
]);

export type PrivateAssessmentMaterial = Omit<
  z.infer<typeof privateAssessmentV1Schema>,
  'version' | 'sections'
> & {
  version: 1 | 2;
  sections: Array<
    | z.infer<typeof mcSection>
    | (Omit<z.infer<typeof speakingSection>, 'items'> & {
        items: Array<
          z.infer<typeof speaking> & {
            privateCriteria?: z.infer<typeof assessmentSpeakingCriteriaSchema>;
          }
        >;
      })
    | z.infer<typeof writingSection>
  >;
};
export interface AssessmentScope {
  id: string;
  classId: string;
  courseId: string;
  userId: string;
  classAttempt: number;
  assessmentAttempt: number;
  formativeRevision: string;
  requirements: PrivateAssessmentMaterial['requirements'];
  passThresholds: Partial<Record<SkillType, number>>;
  formativeItemIds: readonly string[];
  formativeTasks: readonly AssessmentTask[];
  reviewedMaterialDigest: string;
  review: { decision: 'ACCEPTED'; materialDigest: string; formativeRevision: string };
  ownedListening: {
    episodeId: string;
    mediaIdentity: string;
    status: string;
    audioUrl: string | null;
    privateTranscript: string;
  } | null;
  ownedSpeakingReferences: Readonly<
    Record<string, { id: string; status: string; storageRef: string | null } | null>
  >;
}

export interface AssessmentTask {
  skill: SkillType;
  task: string;
  options?: readonly string[];
  context?: string | null;
  mode?: string;
}

/** Binds bytes to a stored review; a digest alone is not a review or ownership proof. */
export function assessmentMaterialDigest(input: unknown): string {
  const assessment = parseAssessmentMaterial(input);
  return objectiveEvidenceHash(assessment);
}

export function parseAssessmentMaterial(input: unknown): PrivateAssessmentMaterial {
  const encoded = JSON.stringify(input);
  if (!encoded || Buffer.byteLength(encoded, 'utf8') > 1_000_000)
    throw new Error('Assessment material exceeds its size limit.');
  return privateAssessmentSchema.parse(input);
}

const normalizedTask = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('und');
const taskIdentity = (item: AssessmentTask) =>
  JSON.stringify({
    skill: item.skill,
    task: normalizedTask(item.task),
    options: item.options?.map(normalizedTask).sort() ?? [],
    context: item.context ? normalizedTask(item.context) : '',
    mode: item.mode ?? '',
  });

/** Project only task content a learner could encounter during an assessment. */
export function exposedAssessmentTasks(assessment: PrivateAssessmentMaterial) {
  return assessment.sections.flatMap((section) =>
    section.items.map((item) => ({
      id: item.id,
      skill: section.skill,
      task: 'question' in item ? item.question : item.task,
      ...('options' in item ? { options: item.options } : {}),
      ...('passageText' in section
        ? { context: section.passageText ?? section.audio?.privateTranscript ?? null }
        : {}),
      ...('mode' in item ? { mode: item.mode } : {}),
    }))
  );
}

/** Exact duplicate detection supplements independent semantic review. */
export function assertAssessmentTaskIndependence(
  assessment: PrivateAssessmentMaterial,
  formativeItemIds: readonly string[],
  formativeSourceTasks: readonly AssessmentTask[]
) {
  const itemIds = new Set(formativeItemIds);
  const formativeTasks = new Set(formativeSourceTasks.map(taskIdentity));
  const assessmentTasks = new Set<string>();
  for (const item of exposedAssessmentTasks(assessment)) {
    if (itemIds.has(item.id))
      throw new Error('Assessment items must have unique held-out identities.');
    itemIds.add(item.id);
    const normalized = taskIdentity(item);
    if (formativeTasks.has(normalized) || assessmentTasks.has(normalized))
      throw new Error('Assessment tasks must differ from formative tasks.');
    assessmentTasks.add(normalized);
  }
}

/** The scope must be read from the owned, locked class and assessment rows. */
export function validateAssessmentMaterial(
  input: unknown,
  scope: AssessmentScope
): PrivateAssessmentMaterial {
  const assessment = parseAssessmentMaterial(input);
  const digest = assessmentMaterialDigest(assessment);
  if (
    assessment.id !== scope.id ||
    assessment.classId !== scope.classId ||
    assessment.courseId !== scope.courseId ||
    assessment.userId !== scope.userId ||
    assessment.classAttempt !== scope.classAttempt ||
    assessment.assessmentAttempt !== scope.assessmentAttempt ||
    assessment.formativeRevision !== scope.formativeRevision ||
    assessment.requirements.scope !== 'CLASS' ||
    !isDeepStrictEqual(assessment.requirements, scope.requirements) ||
    !/^[a-f0-9]{64}$/.test(scope.reviewedMaterialDigest) ||
    digest !== scope.reviewedMaterialDigest ||
    scope.review.decision !== 'ACCEPTED' ||
    scope.review.materialDigest !== digest ||
    scope.review.formativeRevision !== assessment.formativeRevision
  )
    throw new Error('Assessment does not match the current owned class attempt.');
  const sectionIds = new Set<string>();
  assertAssessmentTaskIndependence(assessment, scope.formativeItemIds, scope.formativeTasks);
  for (const section of assessment.sections) {
    if (
      sectionIds.has(section.id) ||
      assessment.requirements.skills[section.skill].state !== 'REQUIRED' ||
      section.passThreshold !== scope.passThresholds[section.skill]
    )
      throw new Error('Assessment sections or thresholds do not match the class requirements.');
    sectionIds.add(section.id);
    if (
      'passageText' in section &&
      ((section.skill !== 'LISTENING' && section.audio !== null) ||
        (section.skill !== 'READING' && section.passageText !== null))
    )
      throw new Error('Assessment material contains unexpected passage or audio.');
    if (section.skill === 'LISTENING') {
      const owned = scope.ownedListening;
      if (
        !owned ||
        !section.audio ||
        section.audio.episodeId !== owned.episodeId ||
        section.audio.mediaIdentity !== owned.mediaIdentity ||
        section.audio.privateTranscript !== owned.privateTranscript
      )
        throw new Error('Assessment listening audio does not match the owned media.');
    }
    if (
      section.skill === 'SPEAKING' &&
      section.items.some((item) => {
        const reference = scope.ownedSpeakingReferences[item.id];
        return (
          !Object.hasOwn(scope.ownedSpeakingReferences, item.id) ||
          (reference?.id ?? null) !== item.referenceAudioId ||
          (reference !== null && (reference.status !== 'READY' || !reference.storageRef?.trim()))
        );
      })
    )
      throw new Error('Assessment speaking audio does not match the owned media.');
  }
  assertLearningMaterial(
    assessment.requirements,
    assessment.sections.map((section) => ({
      skill: section.skill,
      itemIds: section.items.map((item) => item.id),
      ...('passageText' in section
        ? {
            passageText: section.passageText,
            audio: section.skill === 'LISTENING' ? scope.ownedListening : null,
          }
        : {}),
      ...(section.skill === 'SPEAKING'
        ? {
            referenceAudioUrls: section.items.map(
              (item) => scope.ownedSpeakingReferences[item.id]?.storageRef ?? null
            ),
            speakingTaskModes: section.items.map((item) => item.mode),
          }
        : {}),
    })),
    true
  );
  return assessment;
}

/** Project an allowlist. Separate review must check whether visible content reveals answers. */
export function publicAssessmentMaterial(input: unknown, scope: AssessmentScope) {
  const assessment = validateAssessmentMaterial(input, scope);
  return {
    id: assessment.id,
    classAttempt: assessment.classAttempt,
    assessmentAttempt: assessment.assessmentAttempt,
    sections: assessment.sections.map((section) => {
      if (section.skill === 'SPEAKING')
        return {
          id: section.id,
          skill: section.skill,
          items: section.items.map((item) => ({
            id: item.id,
            task: item.task,
            mode: item.mode,
            referenceAudioAvailable: Boolean(item.referenceAudioId),
          })),
        };
      if (section.skill === 'WRITING')
        return {
          id: section.id,
          skill: section.skill,
          items: section.items.map((item) => ({ id: item.id, task: item.task })),
        };
      return {
        id: section.id,
        skill: section.skill,
        passageText: section.passageText,
        audioAvailable: Boolean(section.audio),
        items: section.items.map((item) => ({
          id: item.id,
          question: item.question,
          options: item.options,
        })),
      };
    }),
  };
}

const answersSchema = z
  .array(z.object({ itemId: id, selectedIndex: z.number().int().min(0).max(3) }).strict())
  .max(100);
const evidenceSchema = z
  .array(
    z
      .object({
        assessmentId: id,
        userId: id,
        classAttempt: z.number().int().positive(),
        assessmentAttempt: z.number().int().positive(),
        itemId: id,
        sectionId: id,
        operationId: id,
        status: z.literal('SCORED'),
        materialDigest: z.string().regex(/^[a-f0-9]{64}$/),
        score: threshold,
      })
      .strict()
  )
  .max(100);

/** Evidence must be loaded from owned completed grading rows, never from an API payload. */
export function evaluateAssessmentMaterial(
  input: unknown,
  scope: AssessmentScope,
  choices: unknown,
  ownedEvidence: unknown
) {
  const assessment = validateAssessmentMaterial(input, scope);
  return scoreAssessmentMaterial(
    assessment,
    scope.reviewedMaterialDigest,
    choices,
    ownedEvidence,
    scope
  );
}

/** Score only an archive-bound snapshot whose original readiness was verified at seal. */
export function evaluateRetainedAssessmentMaterial(
  assessment: PrivateAssessmentMaterial,
  retained: {
    formativeIds: readonly string[];
    formativeTasks: readonly AssessmentTask[];
    passThresholds: Partial<Record<SkillType, number>>;
    speakingPolicy?: typeof READ_ALOUD_ASSESSMENT_POLICY;
  },
  choices: unknown,
  ownedEvidence: unknown
) {
  assertAssessmentTaskIndependence(assessment, retained.formativeIds, retained.formativeTasks);
  const skills = new Set<SkillType>();
  for (const section of assessment.sections) {
    const requirement = assessment.requirements.skills[section.skill];
    if (
      skills.has(section.skill) ||
      requirement.state !== 'REQUIRED' ||
      section.items.length !== requirement.expectedCount ||
      new Set(section.items.map((item) => item.id)).size !== section.items.length ||
      section.passThreshold !== retained.passThresholds[section.skill] ||
      (section.skill === 'READING' && !section.passageText?.trim()) ||
      (section.skill === 'LISTENING' && !section.audio) ||
      (section.skill === 'SPEAKING' && retained.speakingPolicy !== READ_ALOUD_ASSESSMENT_POLICY)
    )
      throw new Error('Retained assessment material is incomplete.');
    skills.add(section.skill);
  }
  if (
    learningSkills.some(
      (skill) => assessment.requirements.skills[skill].state === 'REQUIRED' && !skills.has(skill)
    )
  )
    throw new Error('Retained assessment material is incomplete.');
  if (assessment.sections.some((section) => section.skill === 'SPEAKING'))
    requireReadAloudAssessmentMaterial(assessment);
  return scoreAssessmentMaterial(
    assessment,
    assessmentMaterialDigest(assessment),
    choices,
    ownedEvidence,
    null
  );
}

function scoreAssessmentMaterial(
  assessment: PrivateAssessmentMaterial,
  reviewedDigest: string,
  choices: unknown,
  ownedEvidence: unknown,
  scope: AssessmentScope | null
) {
  if (
    assessment.version === 2 &&
    assessment.sections.some((section) => section.skill === 'SPEAKING')
  )
    throw new Error('Speaking assessment criteria require verified evidence before scoring.');
  const answers = answersSchema.parse(choices);
  const evidence = evidenceSchema.parse(ownedEvidence);
  const mcIds = new Set(
    assessment.sections
      .filter((section) => ['GRAMMAR', 'READING', 'LISTENING'].includes(section.skill))
      .flatMap((section) => section.items.map((item) => item.id))
  );
  const productiveIds = new Set(
    assessment.sections
      .filter((section) => section.skill === 'SPEAKING' || section.skill === 'WRITING')
      .flatMap((section) => section.items.map((item) => item.id))
  );
  const productiveSections = new Map(
    assessment.sections
      .filter((section) => section.skill === 'SPEAKING' || section.skill === 'WRITING')
      .flatMap((section) => section.items.map((item) => [item.id, section.id] as const))
  );
  if (
    new Set(answers.map((answer) => answer.itemId)).size !== answers.length ||
    answers.some((answer) => !mcIds.has(answer.itemId))
  )
    throw new Error('Assessment answers are duplicated or belong to different material.');
  if (
    new Set(evidence.map((entry) => entry.itemId)).size !== evidence.length ||
    new Set(evidence.map((entry) => entry.operationId)).size !== evidence.length ||
    evidence.some(
      (entry) =>
        !productiveIds.has(entry.itemId) ||
        entry.assessmentId !== assessment.id ||
        entry.userId !== assessment.userId ||
        entry.materialDigest !== reviewedDigest ||
        entry.sectionId !== productiveSections.get(entry.itemId) ||
        entry.classAttempt !== assessment.classAttempt ||
        entry.assessmentAttempt !== assessment.assessmentAttempt
    )
  )
    throw new Error('Assessment evidence belongs to different material or learner.');
  const answerMap = new Map(answers.map((answer) => [answer.itemId, answer.selectedIndex]));
  const evidenceMap = new Map(evidence.map((entry) => [entry.itemId, entry.score]));
  const work: LearningSectionWork[] = assessment.sections.map((section) => {
    const grades = section.items.flatMap((item) => {
      if ('correctIndex' in item) {
        const answer = answerMap.get(item.id);
        return answer === undefined
          ? []
          : [{ id: item.id, score: answer === item.correctIndex ? 1 : 0 }];
      }
      const score = evidenceMap.get(item.id);
      return score === undefined ? [] : [{ id: item.id, score }];
    });
    return {
      skill: section.skill,
      itemIds: section.items.map((item) => item.id),
      gradedItemIds: grades.map((grade) => grade.id),
      score: grades.length
        ? grades.reduce((sum, grade) => sum + grade.score, 0) / grades.length
        : null,
      passThreshold: section.passThreshold,
      ...('passageText' in section
        ? {
            passageText: section.passageText,
            audio: section.skill === 'LISTENING' ? (scope?.ownedListening ?? null) : null,
          }
        : {}),
      ...(section.skill === 'SPEAKING'
        ? {
            referenceAudioUrls: section.items.map(
              (item) => scope?.ownedSpeakingReferences[item.id]?.storageRef ?? null
            ),
            speakingTaskModes: section.items.map((item) => item.mode),
          }
        : {}),
    };
  });
  if (learningSkills.every((skill) => assessment.requirements.skills[skill].state !== 'REQUIRED'))
    throw new Error('Assessment has no required skills.');
  return scope
    ? evaluateLearningWork(assessment.requirements, work)
    : scorePreviouslyValidatedLearningWork(assessment.requirements, work);
}

/** Build the saved receipt from a complete canonical assessment evaluation. */
export function assessmentEvaluationReceipt(
  material: PrivateAssessmentMaterial,
  evaluated: ReturnType<typeof evaluateAssessmentMaterial>
) {
  if (!evaluated.complete) throw new Error('Assessment is incomplete.');
  const sections = evaluated.sections
    .filter((section) => section.required)
    .map((section) => {
      const source = material.sections.find((item) => item.skill === section.skill);
      if (!source || section.score === null || section.passed === null)
        throw new Error('Assessment result is incomplete.');
      return { id: source.id, skill: section.skill, score: section.score, passed: section.passed };
    });
  if (!sections.length) throw new Error('Assessment has no required skills.');
  return classReceiptSchema.parse({
    source: 'ASSESSMENT',
    passed: evaluated.mastered,
    overallScore: sections.reduce((total, section) => total + section.score, 0) / sections.length,
    passedSections: sections.filter((section) => section.passed).length,
    totalSections: sections.length,
    sections,
  });
}
