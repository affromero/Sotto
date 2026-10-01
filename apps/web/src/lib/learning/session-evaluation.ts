import { learningSkills, type SkillRequirements, type SkillType } from '@sotto/shared';

export class LearningIncompleteError extends Error {
  constructor(
    message: string,
    readonly skills: readonly SkillType[] = []
  ) {
    super(message);
    this.name = 'LearningIncompleteError';
  }
}

export interface LearningSectionMaterial {
  skill: SkillType;
  itemIds: readonly string[];
  passageText?: string | null;
  audio?: { status: string; audioUrl: string | null } | null;
  referenceAudioUrls?: readonly (string | null)[];
}

export interface LearningSectionWork extends LearningSectionMaterial {
  gradedItemIds: readonly string[];
  score: number | null;
  passThreshold: number;
}

export interface LearningSectionResult {
  skill: SkillType;
  required: boolean;
  expected: number;
  completed: number;
  complete: boolean;
  score: number | null;
  passed: boolean | null;
}

/** Validate actual stored material against the admission contract, never infer exemptions from gaps. */
export function assertLearningMaterial(
  requirements: SkillRequirements,
  sections: readonly LearningSectionMaterial[],
  audioMustBeReady = false
): void {
  const duplicateSkills = sections.filter(
    (section, index) => sections.findIndex((other) => other.skill === section.skill) !== index
  );
  if (duplicateSkills.length)
    throw new LearningIncompleteError(
      'Learning material contains conflicting section attempts.',
      duplicateSkills.map((section) => section.skill)
    );
  for (const skill of learningSkills) {
    const requirement = requirements.skills[skill];
    if (requirement.state !== 'REQUIRED') continue;
    const section = sections.find((candidate) => candidate.skill === skill);
    if (
      !section ||
      section.itemIds.length !== requirement.expectedCount ||
      new Set(section.itemIds).size !== section.itemIds.length
    )
      throw new LearningIncompleteError(
        `${skill.toLowerCase()} exercises are incomplete. Repair the missing material.`,
        [skill]
      );
    if (skill === 'READING' && !section.passageText?.trim())
      throw new LearningIncompleteError('Reading needs its full source passage.', [skill]);
    if (skill === 'LISTENING') {
      if (
        !section.audio ||
        section.audio.status === 'FAILED' ||
        (section.audio.status === 'READY' && !section.audio.audioUrl)
      )
        throw new LearningIncompleteError(
          'Listening audio is unavailable. Repair the audio before finishing.',
          [skill]
        );
      if (audioMustBeReady && (section.audio.status !== 'READY' || !section.audio.audioUrl))
        throw new LearningIncompleteError(
          'Listening audio is still preparing. Wait before finishing.',
          [skill]
        );
    }
    if (
      skill === 'SPEAKING' &&
      requirements.referenceAudioRequired &&
      (section.referenceAudioUrls?.length !== requirement.expectedCount ||
        section.referenceAudioUrls.some((url) => !url?.trim()))
    )
      throw new LearningIncompleteError(
        'Speaking reference audio is incomplete. Repair the audio before finishing.',
        [skill]
      );
  }
}

/** Practice completion does not imply mastery; classes require every required skill to pass. */
export function evaluateLearningWork(
  requirements: SkillRequirements,
  sections: readonly LearningSectionWork[]
): { complete: boolean; mastered: boolean; sections: LearningSectionResult[] } {
  assertLearningMaterial(requirements, sections, true);
  const results = learningSkills.map((skill): LearningSectionResult => {
    const requirement = requirements.skills[skill];
    if (requirement.state !== 'REQUIRED')
      return {
        skill,
        required: false,
        expected: 0,
        completed: 0,
        complete: true,
        score: null,
        passed: null,
      };
    const section = sections.find((candidate) => candidate.skill === skill)!;
    const graded = new Set(section.gradedItemIds);
    const completed = section.itemIds.filter((id) => graded.has(id)).length;
    const complete = completed === requirement.expectedCount;
    const score = section.score;
    const validScore = score !== null && Number.isFinite(score) && score >= 0 && score <= 1;
    return {
      skill,
      required: true,
      expected: requirement.expectedCount,
      completed,
      complete: complete && validScore,
      score: validScore ? score : null,
      passed: complete && validScore && score >= section.passThreshold,
    };
  });
  const required = results.filter((section) => section.required);
  return {
    complete: required.length > 0 && required.every((section) => section.complete),
    mastered: required.length > 0 && required.every((section) => section.passed),
    sections: results,
  };
}
