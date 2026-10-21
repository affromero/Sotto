import { z } from 'zod';
import { learningLevelSchema } from './catalog';
import { skillRequirementsSchema } from '../learning-requirements';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const learningUpgradeCursorSchema = z
  .object({
    schemaVersion: z.literal(1),
    stage: z.enum(['COURSE', 'LESSONS', 'GRAMMAR', 'MATERIALS']),
    afterId: z.string().min(1).max(200).nullable(),
    cutoff: z.iso.datetime(),
    limit: z.number().int().min(1).max(50),
    identityDigest: digest,
  })
  .strict();
export const learningUpgradeItemSchema = z
  .object({
    kind: z.enum(['COURSE', 'LESSON', 'LEGACY_GRAMMAR', 'MATERIAL']),
    id: z.string().min(1).max(200),
    sourceDigest: digest,
    level: learningLevelSchema.nullable(),
    disposition: z.enum([
      'PINNED',
      'WOULD_BIND',
      'CONFIGURATION_BLOCKED',
      'CATALOG_UNAVAILABLE',
      'MAPPED',
      'MAPPING_UNRESOLVED',
      'BROAD_LEGACY',
      'ORIGINAL_UNAVAILABLE',
      'ORIGINAL_VERIFICATION_REQUIRED',
      'EXTRACTION_REQUIRED',
      'EXTRACTION_PENDING',
      'RECOVERY_REQUIRED',
      'ANALYSIS_REQUIRED',
      'ANALYSIS_PENDING',
      'ANALYSIS_READY',
      'ANALYSIS_PARTIAL',
    ]),
    objectiveIds: z.array(z.string()).max(200),
    unresolvedKeys: z.array(z.string()).max(200),
    existingLinks: z.number().int().nonnegative(),
    missingLinks: z.number().int().nonnegative(),
    notes: z.array(z.string().max(400)).max(8),
  })
  .strict();
export const learningUpgradeReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    courseId: z.string(),
    courseGeneration: z.iso.datetime(),
    level: learningLevelSchema,
    startLevel: learningLevelSchema,
    placementSource: z.string().nullable(),
    mode: z.enum(['DRY_RUN', 'APPLY']),
    cursor: learningUpgradeCursorSchema,
    nextCursor: z.string().max(4096).nullable(),
    pageDigest: digest,
    catalog: z
      .object({
        available: z.boolean(),
        hash: digest.nullable(),
        version: z.number().int().positive().nullable(),
        pinned: z.boolean(),
      })
      .strict(),
    coverage: skillRequirementsSchema.nullable(),
    upgrade: z
      .object({
        available: z.boolean(),
        targetHash: digest.nullable(),
        added: z.number().int().nonnegative(),
        removed: z.number().int().nonnegative(),
        changed: z.number().int().nonnegative(),
        earnedTransitionsPreserved: z.literal(true),
      })
      .strict(),
    items: z.array(learningUpgradeItemSchema).max(50),
    changed: z
      .object({
        bindings: z.number().int().nonnegative(),
        lessonLinks: z.number().int().nonnegative(),
      })
      .strict(),
    evidence: z.literal('LEGACY_EVIDENCE_REMAINS_BROAD'),
  })
  .strict();
export const applyLearningUpgradeRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    cursor: z.string().min(1).max(4096),
    expectedLevel: learningLevelSchema,
    expectedCatalogHash: digest.nullable(),
    expectedPageDigest: digest,
  })
  .strict();
export const learningUpgradeCoursesSchema = z
  .object({
    courses: z
      .array(
        z
          .object({
            id: z.string(),
            nativeLang: z.string(),
            targetLang: z.string(),
            level: learningLevelSchema,
          })
          .strict()
      )
      .max(20),
    nextAfterId: z.string().nullable(),
  })
  .strict();
export type LearningUpgradeCursor = z.infer<typeof learningUpgradeCursorSchema>;
export type LearningUpgradeItem = z.infer<typeof learningUpgradeItemSchema>;
export type LearningUpgradeReport = z.infer<typeof learningUpgradeReportSchema>;
