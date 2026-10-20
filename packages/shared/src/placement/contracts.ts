import { z } from 'zod';
import { learningLevelSchema } from '../learning-map/catalog';
import { materialFocusAnalysisStatusIdentitySchema } from '../course-materials/analysis';

const language = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z]{2}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const pair = { native: language, target: language };
const nullableAnalysis = {
  analysisId: z.uuid().nullable().default(null),
  analysisRevision: z.number().int().positive().nullable().default(null),
  resultDigest: digest.nullable().default(null),
};
const checkedPair = (value: { native: string; target: string }, context: z.RefinementCtx) => {
  if (value.native === value.target)
    context.addIssue({ code: 'custom', message: 'Native and target languages must differ.' });
};
const checkedAnalysis = (
  value: {
    analysisId: string | null;
    analysisRevision: number | null;
    resultDigest: string | null;
  },
  context: z.RefinementCtx
) => {
  const fields = [value.analysisId, value.analysisRevision, value.resultDigest];
  if (fields.some((value) => value !== null) && fields.some((value) => value === null))
    context.addIssue({
      code: 'custom',
      message: 'Supply the exact analysis ID, revision and result digest together.',
    });
};
export const placementAnalysisReferenceSchema = z
  .object({
    analysisId: z.uuid(),
    analysisRevision: z.number().int().positive(),
    resultDigest: digest,
  })
  .strict();
export const placementSourceRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: z.uuid(),
    ...pair,
    materialIds: z.array(z.uuid()).max(10).default([]),
    content: z
      .string()
      .max(20000)
      .refine((text) => text.isWellFormed())
      .default(''),
    includeCourseNote: z.boolean().default(false),
  })
  .strict()
  .superRefine(checkedPair)
  .superRefine((value, context) => {
    if (!value.materialIds.length && !value.content.trim() && !value.includeCourseNote)
      context.addIssue({
        code: 'custom',
        message: 'Select retained materials or paste source text.',
      });
  });
export const placementSourceAdmissionSchema = materialFocusAnalysisStatusIdentitySchema;
export const placementGenerateRequestSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    requestId: z.uuid(),
    ...pair,
    ...nullableAnalysis,
    acceptPartial: z.boolean().default(false),
  })
  .strict()
  .superRefine(checkedPair)
  .superRefine(checkedAnalysis);
export const placementSubmitRequestSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    requestId: z.uuid(),
    ...pair,
    ...nullableAnalysis,
    placementSessionId: z.uuid(),
    questionsDigest: digest,
    acceptPartial: z.boolean().default(false),
    answers: z
      .array(
        z
          .object({
            id: z.string().regex(/^pq_\d+$/),
            selectedIndex: z.number().int().min(0).max(4),
          })
          .strict()
      )
      .min(6)
      .max(24),
  })
  .strict()
  .superRefine(checkedPair)
  .superRefine(checkedAnalysis)
  .superRefine((value, context) => {
    if (new Set(value.answers.map((answer) => answer.id)).size !== value.answers.length)
      context.addIssue({ code: 'custom', message: 'Answer each preserved question once.' });
  });
export const placementConfirmRequestSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    requestId: z.uuid(),
    ...pair,
    ...placementAnalysisReferenceSchema.shape,
    acceptPartial: z.boolean().default(false),
  })
  .strict()
  .superRefine(checkedPair);
export const placementInferenceSchema = z
  .object({
    level: learningLevelSchema,
    confidence: z.number().min(0).max(1),
    rationale: z.string().min(1).max(4000),
    levelRange: z.object({ from: learningLevelSchema, to: learningLevelSchema }).strict(),
    source: z.literal('MATERIAL_FOCUS_INFERENCE'),
    originalContentComplete: z.boolean(),
  })
  .strict();
export const placementSourceStatusSchema = placementSourceAdmissionSchema
  .extend({
    native: language,
    target: language,
    stale: z.boolean(),
    summary: z
      .object({
        inference: placementInferenceSchema.nullable(),
      })
      .loose()
      .nullable(),
    failureReason: z.string().nullable(),
  })
  .loose();
export type PlacementSourceStatus = z.infer<typeof placementSourceStatusSchema>;

export const placementSessionPublicSchema = z
  .object({
    native: language,
    target: language,
    placementSessionId: z.uuid(),
    status: z.enum([
      'QUEUED',
      'GENERATING',
      'DISPATCHING',
      'SUCCEEDED',
      'READY',
      'FAILED',
      'OUTPUT_INVALID',
      'RECOVERY_REQUIRED',
      'EXPIRED',
      'ACCEPTED',
    ]),
    questionsDigest: digest,
    analysisId: z.uuid().nullable(),
    analysisRevision: z.number().int().positive().nullable(),
    resultDigest: digest.nullable(),
    expiresAt: z.string(),
    failureReason: z.string().nullable(),
    questions: z
      .array(
        z
          .object({
            id: z.string(),
            cefr: learningLevelSchema,
            skill: z.enum(['grammar', 'vocab', 'reading']),
            prompt: z.string(),
            options: z.array(z.string()).length(5),
          })
          .strict()
      )
      .max(24),
  })
  .strict();
export type PlacementAnalysisReference = z.infer<typeof placementAnalysisReferenceSchema>;
export type PlacementGenerateRequest = z.infer<typeof placementGenerateRequestSchema>;
export type PlacementSubmitRequest = z.infer<typeof placementSubmitRequestSchema>;
export type PlacementConfirmRequest = z.infer<typeof placementConfirmRequestSchema>;
export type PlacementInference = z.infer<typeof placementInferenceSchema>;
