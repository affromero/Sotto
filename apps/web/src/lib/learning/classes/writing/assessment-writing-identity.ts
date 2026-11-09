import { objectiveEvidenceHash } from '@/lib/learning-map/evidence/protocol';
import { buildProductiveTaskRequest } from '@/lib/learning-map/evidence/productive';
import type { WritingExecution } from '@/lib/learning/writing/writing-execution';
import { buildWritingGradeRequest, validateWritingObjective } from '@/lib/writing-grader';
import { AssessmentFenceConflict } from '../lifecycle/assessment-fence';
import type { captureAssessmentWritingTask } from './assessment-writing-read';

type CapturedWriting = Awaited<ReturnType<typeof captureAssessmentWritingTask>>;

/** Bind the exact application-level provider messages and deterministic options. */
export function assessmentWritingRequestDigest(captured: CapturedWriting, text: string) {
  const objective = validateWritingObjective({
    userId: captured.userId,
    targetLang: captured.requirements.targetLang,
    level: captured.requirements.level,
    task: captured.prompt.task,
    guidance: captured.prompt.privateGuidance,
    ideas: captured.prompt.privateIdeas,
    learningObjectives: captured.prompt.privateLearningObjectives,
  });
  if (objective && objective.scope.courseId !== captured.courseId)
    throw new AssessmentFenceConflict();
  return objectiveEvidenceHash({
    version: 1,
    gradingRequest: buildWritingGradeRequest({
      level: captured.requirements.level,
      nativeLang: captured.requirements.nativeLang,
      targetLang: captured.requirements.targetLang,
      task: captured.prompt.task,
      text,
      assessment: { kind: 'HELD_OUT', rubric: captured.prompt.privateRubric },
    }),
    objectiveRequest:
      objective === null
        ? null
        : buildProductiveTaskRequest({
            task: objective.task,
            rubric: objective.criterion,
            taskFingerprint: objective.taskFingerprint,
            text,
          }),
  });
}

/** Reconstruct an admitted input identity using the saved historical request digest. */
export function assessmentWritingInputDigest(
  captured: CapturedWriting,
  text: string,
  selection: WritingExecution['selection'],
  requestDigest: string
) {
  return objectiveEvidenceHash({ version: 1, task: captured, text, selection, requestDigest });
}
