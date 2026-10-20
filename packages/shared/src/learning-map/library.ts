import { z } from 'zod';
import { learningLevelSchema } from './catalog';
import {
  materialFocusAnalysisStatusIdentitySchema,
  materialFocusAnalysisCoverageSchema,
  materialMergedSourceFocusSchema,
} from '../course-materials/analysis';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const courseAnalysisListSchema = z
  .object({
    courseId: z.string().min(1),
    items: z
      .array(
        materialFocusAnalysisStatusIdentitySchema.extend({
          createdAt: z.iso.datetime(),
          completedAt: z.iso.datetime().nullable(),
          retryOfAnalysisId: z.uuid().nullable(),
          sourceNames: z.array(z.string()),
          focusCount: z.number().int().nonnegative(),
        })
      )
      .max(20),
    nextCursor: z.string().nullable(),
  })
  .strict();

export const sourceFocusSummarySchema = z.object({
  id: digest,
  order: z.number().int().nonnegative(),
  title: z.string().min(1),
  kind: z.enum(['GRAMMAR', 'SITUATION', 'COMBINED', 'VOCABULARY', 'OTHER']),
  level: learningLevelSchema.nullable(),
  objectiveIds: z.array(z.string().min(1)),
  focusDigest: digest,
  detailUrl: z.string().min(1),
});

export const sourceFocusDetailSchema = z
  .object({
    analysisId: z.uuid(),
    analysisRevision: z.number().int().positive(),
    resultDigest: digest,
    focusDigest: digest,
    focus: materialMergedSourceFocusSchema,
    coverage: materialFocusAnalysisCoverageSchema,
  })
  .strict();
