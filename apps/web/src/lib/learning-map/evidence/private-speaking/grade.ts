import type { CapturedLearningAi } from '@/lib/learning-ai';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { gradeProductiveTask } from '../productive';
import { privateSpeakingAssessmentSchema } from './protocol';

/** Feedback stays private. Its finding is never a canonical objective observation. */
export function gradePrivateSourceSpeaking(input: {
  userId: string;
  execution: SottoProviderExecution;
  assessment: unknown;
  text: string;
  ai?: CapturedLearningAi;
  fetch?: typeof fetch;
}) {
  const assessment = privateSpeakingAssessmentSchema.parse(input.assessment);
  if (assessment.scope.userId !== input.userId)
    throw new Error('Private speaking feedback requires the exact learner.');
  return gradeProductiveTask({
    ...input,
    task: assessment.task,
    taskFingerprint: assessment.taskFingerprint,
    rubric: { level: assessment.scope.level, skill: 'SPEAKING', assessment: assessment.rubric },
  });
}
