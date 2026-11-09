import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { skillRequirementsSchema } from '@sotto/shared';
import { z } from 'zod';
import { delegationBindingSchema } from 'thesidedoor-core/runtime/delegation';
import { OptimisticStateStore, type AtomicStateBackend } from 'thesidedoor-core/storage/optimistic';
import { sqlStateBackend } from 'thesidedoor-core/storage/sql';
import type { Prisma } from '@/generated/prisma/client';
import { prerequisiteFenceSchema } from '@/lib/classes/help/lifecycle/prerequisite-fence';
import { materialAnalysisPolicySchema } from '@/lib/course-materials/analysis/policy';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import type { captureAssessmentGenerationSource } from '../material/assessment-source';
import { READ_ALOUD_ASSESSMENT_POLICY } from '../speaking/assessment-speaking-policy';

export const assessmentFenceSchema = z
  .object({
    id: z.uuid(),
    assessmentId: z.string().min(1),
    classId: z.string().min(1),
    courseId: z.string().min(1),
    userId: z.string().min(1),
    classAttempt: z.number().int().positive(),
    assessmentAttempt: z.number().int().positive(),
    materialVersion: z.literal(2).optional(),
    speakingPolicy: z.literal(READ_ALOUD_ASSESSMENT_POLICY).optional(),
    ownership: prerequisiteFenceSchema.shape.ownership,
    formativeRevision: z.string().regex(/^[a-f0-9]{64}$/),
    teachingReceipt: z
      .object({ kind: z.enum(['BASE', 'ADDENDUM']), receiptId: z.string().min(1) })
      .strict(),
    requirements: skillRequirementsSchema,
    thresholds: z.partialRecord(
      z.enum(['GRAMMAR', 'READING', 'LISTENING', 'SPEAKING', 'WRITING']),
      z.number().finite().min(0).max(1)
    ),
    selection: prerequisiteFenceSchema.shape.selection,
    cliBinding: materialAnalysisPolicySchema.shape.cliBinding,
    grant: delegationBindingSchema,
    status: z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'UNRESOLVED']),
  })
  .strict()
  .refine(
    (value) =>
      value.userId === value.ownership.userId &&
      value.id === value.grant.id &&
      value.requirements.scope === 'CLASS' &&
      value.requirements.level === 'A1' &&
      (!value.speakingPolicy ||
        (value.materialVersion === undefined &&
          value.requirements.skills.SPEAKING.state === 'REQUIRED')) &&
      (value.selection.provider === 'codex') === (value.cliBinding !== null) &&
      new Set(value.ownership.scopes.map((scope) => scope.subjectId)).size === 4 &&
      value.ownership.scopes.some(
        (scope) =>
          scope.subjectId === `instance:${value.ownership.instanceId}` && scope.generation === 0
      ) &&
      value.ownership.scopes.some((scope) => scope.subjectId === `profile:${value.userId}`) &&
      value.ownership.scopes.some((scope) => scope.subjectId === `course:${value.courseId}`) &&
      value.ownership.scopes.some((scope) => scope.subjectId === `class:${value.classId}`) &&
      Object.entries(value.requirements.skills).every(
        ([skill, requirement]) =>
          (requirement.state === 'REQUIRED') === Object.hasOwn(value.thresholds, skill)
      )
  );
export type AssessmentFence = z.infer<typeof assessmentFenceSchema>;
/** Bind the learner's preparation intent to the exact acknowledged teaching. */
export function assessmentRequestRevision(value: {
  classAttempt: number;
  assessmentAttempt: number;
  formativeRevision: string;
  teachingReceipt: { kind: 'BASE' | 'ADDENDUM'; receiptId: string };
}) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        'assessment-request-v2',
        value.classAttempt,
        value.assessmentAttempt,
        value.formativeRevision,
        value.teachingReceipt.kind,
        value.teachingReceipt.receiptId,
      ])
    )
    .digest('hex');
}
export const assessmentWorkSchema = z
  .object({ kind: z.literal('CLASS_ASSESSMENT'), fence: assessmentFenceSchema })
  .strict();

export class AssessmentFenceConflict extends Error {
  constructor() {
    super('An assessment request is already active or needs recovery.');
    this.name = 'AssessmentFenceConflict';
  }
}

export function assessmentFenceStore(backend: AtomicStateBackend) {
  return new OptimisticStateStore<{ current: AssessmentFence | null }>({
    backend,
    parse: (value) => z.object({ current: assessmentFenceSchema.nullable() }).strict().parse(value),
    initial: () => ({ current: null }),
  });
}

export function assessmentFenceBackend(database: Prisma.TransactionClient, classId: string) {
  return sqlStateBackend(
    { query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
    'postgres',
    assessmentFenceStateId(classId)
  );
}

export function assessmentFenceStateId(classId: string) {
  return `${SIDEDOOR_STATE_ID}:assessment:${createHash('sha256').update(classId).digest('hex')}`;
}

/** Existing work is replayed only for the exact same source, teaching and provider. */
export function admitAssessmentFence(current: AssessmentFence | null, proposed: AssessmentFence) {
  const next = assessmentFenceSchema.parse(proposed);
  if (next.status !== 'QUEUED') throw new AssessmentFenceConflict();
  if (!current) return next;
  const existing = assessmentFenceSchema.parse(current);
  if (
    ['QUEUED', 'RUNNING'].includes(existing.status) &&
    existing.classId === next.classId &&
    existing.courseId === next.courseId &&
    existing.userId === next.userId &&
    existing.classAttempt === next.classAttempt &&
    existing.assessmentAttempt === next.assessmentAttempt &&
    (existing.materialVersion ?? 1) === (next.materialVersion ?? 1) &&
    existing.speakingPolicy === next.speakingPolicy &&
    existing.formativeRevision === next.formativeRevision &&
    isDeepStrictEqual(existing.teachingReceipt, next.teachingReceipt) &&
    isDeepStrictEqual(existing.requirements, next.requirements) &&
    isDeepStrictEqual(existing.thresholds, next.thresholds) &&
    isDeepStrictEqual(existing.ownership, next.ownership) &&
    isDeepStrictEqual(existing.selection, next.selection) &&
    isDeepStrictEqual(existing.cliBinding, next.cliBinding)
  )
    return existing;
  throw new AssessmentFenceConflict();
}

/** Call within the same Serializable transaction as the operation grant and outbox. */
export async function recordAssessmentFence(
  backend: AtomicStateBackend,
  proposed: AssessmentFence
) {
  return assessmentFenceStore(backend).transact((state) => {
    state.current = admitAssessmentFence(state.current, proposed);
    return state.current;
  });
}

export function assertAssessmentFenceSource(
  fence: AssessmentFence,
  source: Pick<
    Awaited<ReturnType<typeof captureAssessmentGenerationSource>>,
    | 'classId'
    | 'courseId'
    | 'userId'
    | 'classAttempt'
    | 'formativeRevision'
    | 'teachingReceipt'
    | 'ownership'
    | 'requirements'
    | 'thresholds'
  >
) {
  const current = assessmentFenceSchema.parse(fence);
  if (
    !['QUEUED', 'RUNNING'].includes(current.status) ||
    current.classId !== source.classId ||
    current.courseId !== source.courseId ||
    current.userId !== source.userId ||
    current.classAttempt !== source.classAttempt ||
    current.formativeRevision !== source.formativeRevision ||
    !isDeepStrictEqual(current.teachingReceipt, source.teachingReceipt) ||
    !isDeepStrictEqual(current.ownership, source.ownership) ||
    !isDeepStrictEqual(current.requirements, source.requirements) ||
    !isDeepStrictEqual(current.thresholds, source.thresholds)
  )
    throw new AssessmentFenceConflict();
}
