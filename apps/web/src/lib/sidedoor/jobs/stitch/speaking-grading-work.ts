import { z } from 'zod';
import { storageInputSchema } from '@/lib/sidedoor/storage/core/storage-inputs';
import { assessmentSpeakingInputSchema } from '@/lib/learning/classes/speaking/assessment-speaking-identity';
import { READ_ALOUD_ASSESSMENT_POLICY } from '@/lib/learning/classes/speaking/assessment-speaking-policy';
import { isDeepStrictEqual } from 'node:util';

const scopeSchema = z.object({
  subjectId: z.string().min(1),
  generation: z.number().int().nonnegative().safe(),
});
const parentSchema = z.object({
  kind: z.string().min(1),
  id: z.string().min(1),
  courseId: z.string().min(1),
  parentId: z.string().min(1),
  assessment: z
    .object({
      classId: z.string().min(1),
      userId: z.string().min(1),
      classAttempt: z.number().int().positive(),
      currentClassAttempt: z.number().int().positive(),
      assessmentAttempt: z.number().int().positive(),
      status: z.string().min(1),
      sealedAt: z.number().int().nonnegative().safe().nullable(),
      reviewedMaterialDigest: z.string().nullable(),
    })
    .strict()
    .optional(),
});
const speakingRecordingOwnershipSchema = z.object({
  instanceId: z.string().min(1),
  scopes: z.array(scopeSchema).min(1),
  reference: z.string().min(1),
  associations: z.object({
    recordingId: z.string().min(1),
    createdAt: z.number().int().nonnegative().safe(),
    userId: z.string().min(1),
    prompt: z.object({
      promptId: z.string().min(1),
      createdAt: z.number().int().nonnegative().safe(),
      parents: z.array(parentSchema).min(1),
    }),
    parents: z.array(parentSchema).min(1),
  }),
});

export const speakingGradingPayloadSchema = z
  .object({
    recordingId: z.uuid(),
    recordingCreatedAt: z.number().int().nonnegative().safe(),
    storage: storageInputSchema,
    ownership: speakingRecordingOwnershipSchema,
    classAuthorization: z
      .object({
        classId: z.string().min(1),
        authorization: z
          .object({
            kind: z.enum(['BASE', 'ADDENDUM']),
            receiptId: z.uuid(),
            materialHash: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict()
          .nullable(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** Class jobs bind provider attempts to the original prerequisite receipt. */
export const classSpeakingGradingPayloadSchema = speakingGradingPayloadSchema.extend({
  classAuthorization: speakingGradingPayloadSchema.shape.classAuthorization.unwrap(),
  grant: z
    .object({ id: z.uuid(), revision: z.uuid(), fingerprint: z.string().length(64) })
    .strict(),
});

/** Bind a queued assessment recording to the reviewed task and owned storage. */
export const assessmentSpeakingGradingPayloadSchema = speakingGradingPayloadSchema
  .extend({
    assessment: assessmentSpeakingInputSchema,
    grant: classSpeakingGradingPayloadSchema.shape.grant,
  })
  .superRefine((payload, context) => {
    const { assessment, ownership, storage } = payload;
    const { associations, scopes } = ownership;
    const parent = associations.parents[0];
    const binding = parent?.assessment;
    if (
      payload.classAuthorization !== undefined ||
      assessment.speakingPolicy !== READ_ALOUD_ASSESSMENT_POLICY ||
      payload.grant.id !== assessment.operationId ||
      payload.recordingId !== assessment.recordingId ||
      associations.recordingId !== payload.recordingId ||
      associations.createdAt !== payload.recordingCreatedAt ||
      associations.userId !== assessment.userId ||
      associations.prompt.promptId !== assessment.promptId ||
      storage.consumer !== `recording:${payload.recordingId}:audio` ||
      storage.reference !== ownership.reference ||
      associations.parents.length !== 1 ||
      associations.prompt.parents.length !== 1 ||
      !isDeepStrictEqual(parent, associations.prompt.parents[0]) ||
      parent?.kind !== 'assessment' ||
      parent.id !== assessment.sectionId ||
      parent.parentId !== assessment.assessmentId ||
      parent.courseId !== assessment.courseId ||
      !binding ||
      binding.classId !== assessment.classId ||
      binding.userId !== assessment.userId ||
      binding.classAttempt !== assessment.classAttempt ||
      binding.currentClassAttempt !== assessment.classAttempt ||
      binding.assessmentAttempt !== assessment.assessmentAttempt ||
      binding.status !== 'READY' ||
      binding.sealedAt === null ||
      binding.reviewedMaterialDigest !== assessment.materialDigest ||
      new Set(scopes.map((scope) => scope.subjectId)).size !== scopes.length ||
      !scopes.some(
        (scope) => scope.subjectId === `instance:${ownership.instanceId}` && scope.generation === 0
      ) ||
      !scopes.some((scope) => scope.subjectId === `profile:${assessment.userId}`) ||
      !scopes.some((scope) => scope.subjectId === `course:${assessment.courseId}`) ||
      !scopes.some((scope) => scope.subjectId === `class:${assessment.classId}`)
    )
      context.addIssue({ code: 'custom', message: 'Assessment speaking job binding changed.' });
  });
