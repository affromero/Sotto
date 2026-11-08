import type { Prisma } from '@/generated/prisma/client';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { AssessmentFenceConflict } from '../lifecycle/assessment-fence';
import type { AssessmentScope, PrivateAssessmentMaterial } from '../material/assessment-material';
import { captureAssessmentForEvaluation } from '../material/assessment-read';
import { assessmentSpeakingTaskDigest } from './assessment-speaking-identity';
import type { AssessmentAudioSource } from '../material/assessment-snapshot';

/** Select a private speaking task from an already authenticated assessment capture. */
export function selectAssessmentSpeakingTask(
  captured: {
    material: PrivateAssessmentMaterial;
    scope: Pick<
      AssessmentScope,
      | 'id'
      | 'classId'
      | 'courseId'
      | 'userId'
      | 'classAttempt'
      | 'assessmentAttempt'
      | 'reviewedMaterialDigest'
      | 'requirements'
    >;
  },
  promptId: string
) {
  const sections = captured.material.sections.filter((section) => section.skill === 'SPEAKING');
  if (sections.length !== 1 || sections[0]?.skill !== 'SPEAKING')
    throw new AssessmentFenceConflict();
  const section = sections[0];
  const prompts = section.items.filter((item) => item.id === promptId);
  if (prompts.length !== 1) throw new AssessmentFenceConflict();
  return {
    assessmentId: captured.scope.id,
    materialVersion: captured.material.version,
    classId: captured.scope.classId,
    courseId: captured.scope.courseId,
    userId: captured.scope.userId,
    classAttempt: captured.scope.classAttempt,
    assessmentAttempt: captured.scope.assessmentAttempt,
    materialDigest: captured.scope.reviewedMaterialDigest,
    sectionId: section.id,
    prompt: prompts[0]!,
    requirements: captured.scope.requirements,
  };
}

/** Project only the selected task and its verified reference from a private capture. */
export function selectAssessmentSpeakingCapture(
  captured: {
    material: PrivateAssessmentMaterial;
    scope: AssessmentScope;
    audioSources: AssessmentAudioSource[];
  },
  promptId: string
) {
  const task = selectAssessmentSpeakingTask(captured, promptId);
  const sources = captured.audioSources.filter(
    (source) => source.kind === 'SPEAKING' && source.promptId === promptId
  );
  if (sources.length > 1 || Boolean(task.prompt.referenceAudioId) !== (sources.length === 1))
    throw new AssessmentFenceConflict();
  return { task, taskDigest: assessmentSpeakingTaskDigest(task), audioSource: sources[0] ?? null };
}

/** Authenticate and capture private assessment material for server-side speaking work. */
export async function captureAssessmentSpeakingTask(
  database: Prisma.TransactionClient,
  input: {
    classId: string;
    assessmentId: string;
    promptId: string;
    execution: SottoProviderExecution;
  }
) {
  input.execution.signal?.throwIfAborted();
  const captured = await captureAssessmentForEvaluation(database, input);
  const selected = selectAssessmentSpeakingCapture(captured, input.promptId);
  const actor = await input.execution.authorize(database);
  if (actor.userId !== selected.task.userId) throw new AssessmentFenceConflict();
  input.execution.signal?.throwIfAborted();
  return {
    ...selected,
    ...(captured.speakingPolicy ? { speakingPolicy: captured.speakingPolicy } : {}),
  };
}
