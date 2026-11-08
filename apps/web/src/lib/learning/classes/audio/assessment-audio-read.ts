import type { Prisma } from '@/generated/prisma/client';
import { resolveStorageInput } from '@/lib/sidedoor/storage/core/storage-inputs';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { AssessmentFenceConflict } from '../lifecycle/assessment-fence';
import { captureAssessmentForEvaluation } from '../material/assessment-read';
import { readAssessmentStatus } from '../lifecycle/assessment-status';
import { captureAssessmentSpeakingTask } from '../speaking/assessment-speaking-task';

export type AudioSelection =
  { kind: 'LISTENING'; sectionId: string } | { kind: 'SPEAKING'; promptId: string };

/** Capture the exact verified current locator for one owned, reviewed audio asset. */
export async function captureAssessmentAudio(
  database: Prisma.TransactionClient,
  input: {
    classId: string;
    assessmentId: string;
    selection: AudioSelection;
    execution: SottoProviderExecution;
  }
) {
  const status = await readAssessmentStatus(database, input.classId, input.execution);
  if (status.status !== 'READY' || status.assessmentId !== input.assessmentId)
    throw new AssessmentFenceConflict();
  let classAttempt: number;
  let assessmentAttempt: number;
  let reviewedMaterialDigest: string;
  let source;
  if (input.selection.kind === 'SPEAKING') {
    const speaking = await captureAssessmentSpeakingTask(database, {
      ...input,
      promptId: input.selection.promptId,
    });
    if (!speaking.audioSource) throw new AssessmentFenceConflict();
    classAttempt = speaking.task.classAttempt;
    assessmentAttempt = speaking.task.assessmentAttempt;
    reviewedMaterialDigest = speaking.task.materialDigest;
    source = speaking.audioSource;
  } else {
    const captured = await captureAssessmentForEvaluation(database, input);
    const sectionId = input.selection.sectionId;
    const matches = captured.audioSources.filter(
      (candidate) => candidate.kind === 'LISTENING' && candidate.sectionId === sectionId
    );
    if (matches.length !== 1) throw new AssessmentFenceConflict();
    classAttempt = captured.material.classAttempt;
    assessmentAttempt = captured.material.assessmentAttempt;
    reviewedMaterialDigest = captured.scope.reviewedMaterialDigest;
    source = matches[0]!;
  }
  const storage = await resolveStorageInput(database, {
    consumer: source.original.consumer,
    reference: source.currentReference,
  });
  return {
    assessmentId: input.assessmentId,
    classAttempt,
    assessmentAttempt,
    reviewedMaterialDigest,
    source,
    storage,
  };
}
