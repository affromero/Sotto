import type { Prisma } from '@/generated/prisma/client';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { AssessmentFenceConflict } from '../lifecycle/assessment-fence';
import { captureAssessmentForEvaluation } from '../material/assessment-read';

/** Capture private grading inputs only from the current reviewed assessment. */
export async function captureAssessmentWritingTask(
  database: Prisma.TransactionClient,
  input: {
    classId: string;
    assessmentId: string;
    promptId: string;
    execution: SottoProviderExecution;
  }
) {
  const captured = await captureAssessmentForEvaluation(database, input);
  const section = captured.material.sections.find((entry) => entry.skill === 'WRITING');
  if (!section || section.skill !== 'WRITING') throw new AssessmentFenceConflict();
  const prompts = section.items.filter((item) => item.id === input.promptId);
  if (prompts.length !== 1) throw new AssessmentFenceConflict();
  return {
    assessmentId: captured.scope.id,
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
