import type { LearningSelectionSnapshot, SkillRequirements } from '@sotto/shared';
import type { SottoProviderExecution } from '../sidedoor/credentials/runtime/provider-execution';
import { composeSpeakingPrompts, type ComposedSpeakingPrompt } from '../class-speaking-generator';
import { capturePracticeAssessmentScope } from '../learning-map/evidence/producers';
import { composeCommunicativeSpeakingPrompts } from '../learning-map/evidence/communicative-speaking';
import { composePrivateSourceSpeaking } from '../learning-map/evidence/private-speaking/compose';
import type { PrivateSpeakingAssessment } from '../learning-map/evidence/private-speaking/protocol';
import type { ReviewedObjectiveAssessment } from '../learning-map/evidence/protocol';
import type { CourseCtx, PracticeSeed } from './context';

export async function composePracticeSpeaking(input: {
  course: CourseCtx;
  seed: PracticeSeed;
  seedToken: string;
  note: string;
  execution: SottoProviderExecution;
  requirements: SkillRequirements;
  learningSelection: LearningSelectionSnapshot | null;
}): Promise<
  Array<
    ComposedSpeakingPrompt & {
      learningObjectives?: ReviewedObjectiveAssessment | PrivateSpeakingAssessment;
    }
  >
> {
  const { course, seed, requirements, execution, learningSelection } = input;
  if (learningSelection && !learningSelection.objectives.length)
    return composePrivateSourceSpeaking({
      courseId: course.id,
      userId: course.userId,
      execution,
      requirements,
      learningSelection,
      objective: seed.objective,
      context: input.note,
      count: 4,
    });
  const scope = learningSelection
    ? await capturePracticeAssessmentScope({
        courseId: course.id,
        userId: course.userId,
        execution,
        requirements,
        learningSelection,
        grammarKeys: seed.grammarPoints,
      })
    : null;
  if (scope?.criteria.some((criterion) => criterion.skill === 'SPEAKING'))
    return composeCommunicativeSpeakingPrompts({
      userId: course.userId,
      execution,
      scope,
      nativeLang: course.nativeLang,
      count: 4,
      objective: seed.objective,
      context: input.note,
    });
  return composeSpeakingPrompts({
    ttsProvider: requirements.ttsProvider as Parameters<
      typeof composeSpeakingPrompts
    >[0]['ttsProvider'],
    referenceAudioRequired: requirements.referenceAudioRequired,
    execution,
    userId: course.userId,
    level: course.currentLevel,
    nativeLang: course.nativeLang,
    targetLang: course.targetLang,
    objective: seed.objective,
    targetVocab: seed.targetVocab,
    refId: input.seedToken,
    note: input.note,
  });
}
