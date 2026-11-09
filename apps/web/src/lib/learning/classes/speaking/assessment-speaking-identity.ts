import { createHash } from 'node:crypto';
import { z } from 'zod';
import { objectiveEvidenceHash } from '@/lib/learning-map/evidence/protocol';
import { sttSelectionSchema } from '@/lib/learning/speech-selection';
import { preparationSchema } from '@/lib/classes/preparation-state';
import { assessmentSpeakingCriteriaSchema } from '../material/assessment-material';
import type { selectAssessmentSpeakingTask } from './assessment-speaking-task';
import {
  READ_ALOUD_ASSESSMENT_POLICY,
  requireReadAloudAssessmentDraft,
} from './assessment-speaking-policy';

type SpeakingTask = ReturnType<typeof selectAssessmentSpeakingTask>;

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const gradingSelectionSchema = preparationSchema.shape.selection.extend({
  moderationCredentialFingerprint: digest.nullable(),
});

/** Identify the reviewed task without placing its rubric in the operation payload. */
export function assessmentSpeakingTaskDigest(task: SpeakingTask) {
  return objectiveEvidenceHash({ version: 1, task });
}

export const assessmentSpeakingInputSchema = z
  .object({
    version: z.literal(1),
    operationId: z.uuid(),
    recordingId: z.uuid(),
    assessmentId: z.string().min(1),
    classId: z.string().min(1),
    courseId: z.string().min(1),
    userId: z.string().min(1),
    classAttempt: z.number().int().positive(),
    assessmentAttempt: z.number().int().positive(),
    sectionId: z.string().min(1),
    promptId: z.string().min(1),
    materialDigest: digest,
    taskDigest: digest,
    speakingPolicy: z.literal(READ_ALOUD_ASSESSMENT_POLICY).optional(),
    audio: z
      .object({
        sha256: digest,
        bytes: z.number().int().positive().safe(),
        contentType: z.string().min(1).max(255),
      })
      .strict(),
    selection: sttSelectionSchema,
    gradingSelection: gradingSelectionSchema,
  })
  .strict();

/**
 * Capture the recording input identity. Admission must still bind owned storage
 * and grading requests, and the worker must verify downloaded bytes before use.
 */
export function assessmentSpeakingInput(input: {
  task: SpeakingTask;
  operationId: string;
  recordingId: string;
  audio: Uint8Array;
  contentType: string;
  selection: z.input<typeof sttSelectionSchema>;
  gradingSelection: z.input<typeof gradingSelectionSchema>;
  speakingPolicy?: typeof READ_ALOUD_ASSESSMENT_POLICY;
}) {
  const { task } = input;
  if (task.materialVersion === 1 && input.speakingPolicy === READ_ALOUD_ASSESSMENT_POLICY) {
    if (
      task.prompt.privateIpa !== null ||
      task.prompt.privateLearningObjectives !== null ||
      task.prompt.privateCriteria !== undefined
    )
      throw new Error('Speaking assessment has unsupported read-aloud criteria.');
    requireReadAloudAssessmentDraft({
      skill: 'SPEAKING',
      items: [
        {
          task: task.prompt.task,
          mode: task.prompt.mode,
          translation: task.prompt.privateTranslation,
          rubric: task.prompt.privateRubric,
          guidance: task.prompt.privateGuidance,
        },
      ],
    });
  } else {
    if (input.speakingPolicy || task.materialVersion !== 2 || !task.prompt.privateCriteria)
      throw new Error('Speaking assessment criteria are unavailable for this material version.');
    assessmentSpeakingCriteriaSchema.parse(task.prompt.privateCriteria);
  }
  return assessmentSpeakingInputSchema.parse({
    version: 1,
    operationId: input.operationId,
    recordingId: input.recordingId,
    assessmentId: task.assessmentId,
    classId: task.classId,
    courseId: task.courseId,
    userId: task.userId,
    classAttempt: task.classAttempt,
    assessmentAttempt: task.assessmentAttempt,
    sectionId: task.sectionId,
    promptId: task.prompt.id,
    materialDigest: task.materialDigest,
    taskDigest: assessmentSpeakingTaskDigest(task),
    ...(input.speakingPolicy ? { speakingPolicy: input.speakingPolicy } : {}),
    audio: {
      sha256: createHash('sha256').update(input.audio).digest('hex'),
      bytes: input.audio.byteLength,
      contentType: input.contentType,
    },
    selection: input.selection,
    gradingSelection: input.gradingSelection,
  });
}

export function assessmentSpeakingInputDigest(
  input: z.input<typeof assessmentSpeakingInputSchema>
) {
  return objectiveEvidenceHash(assessmentSpeakingInputSchema.parse(input));
}
