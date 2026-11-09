import { z } from 'zod';
import type { PrivateAssessmentMaterial } from '../material/assessment-material';

/** The deployed read-aloud scorer uses recognized words and optional timing, not phoneme evidence. */
export const READ_ALOUD_ASSESSMENT_POLICY = 'READ_ALOUD_TRANSCRIPT_V1';
export const READ_ALOUD_ASSESSMENT_RUBRIC =
  'Score recognized word accuracy and completeness. Use word timing for fluency only when available.';

/** Preserve the existing speaking task mode rather than replacing communicative practice. */
export function readAloudPolicyForPractice(
  items: readonly { taskMode: 'READ_ALOUD' | 'COMMUNICATIVE' }[]
) {
  return items.length > 0 && items.every((item) => item.taskMode === 'READ_ALOUD')
    ? READ_ALOUD_ASSESSMENT_POLICY
    : undefined;
}

export const readAloudAssessmentDraftSchema = z
  .object({
    skill: z.literal('SPEAKING'),
    items: z
      .array(
        z
          .object({
            task: z.string().trim().min(1).max(4000),
            mode: z.literal('READ_ALOUD'),
            translation: z.string().trim().min(1).max(4000),
            rubric: z.literal(READ_ALOUD_ASSESSMENT_RUBRIC),
            guidance: z.string().trim().min(1).max(4000),
          })
          .strict()
      )
      .max(20),
  })
  .strict();

/** Reject a task whose rubric requires anything the canonical read-aloud scorer cannot establish. */
export function requireReadAloudAssessmentDraft(value: unknown) {
  return readAloudAssessmentDraftSchema.parse(value);
}

/** Recheck the reviewed stored task, including fields that are not in the authoring response. */
export function requireReadAloudAssessmentMaterial(material: PrivateAssessmentMaterial) {
  const sections = material.sections.filter((section) => section.skill === 'SPEAKING');
  if (material.version !== 1 || sections.length !== 1 || sections[0]?.skill !== 'SPEAKING')
    throw new Error('Read-aloud assessment material is unavailable.');
  const section = sections[0];
  if (
    section.items.some(
      (item) =>
        item.privateIpa !== null ||
        item.privateLearningObjectives !== null ||
        item.privateCriteria !== undefined
    )
  )
    throw new Error('Read-aloud assessment material contains unsupported criteria.');
  return requireReadAloudAssessmentDraft({
    skill: 'SPEAKING',
    items: section.items.map((item) => ({
      task: item.task,
      mode: item.mode,
      translation: item.privateTranslation,
      rubric: item.privateRubric,
      guidance: item.privateGuidance,
    })),
  });
}
