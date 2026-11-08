import { isDeepStrictEqual } from 'node:util';
import { learningSkills } from '@sotto/shared';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { prerequisitePublicSourceSchema } from '@/lib/classes/help/content/prerequisite-source';
import { prerequisiteAddendumSchema } from '@/lib/classes/help/lifecycle/prerequisite-contract';
import { sottoJobSnapshot } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  assessmentHistoryManifestSchema,
  decodeAssessmentHistory,
} from './assessment-history-codec';
import { AssessmentFenceConflict, type AssessmentFence } from '../lifecycle/assessment-fence';
import { assessmentMaterialDigest, parseAssessmentMaterial } from '../material/assessment-material';
import { readPriorAssessmentProjection } from './assessment-prior-projection';

const taskSchema = z
  .object({
    skill: z.enum(learningSkills),
    task: z.string(),
    options: z.array(z.string()).optional(),
    context: z.string().nullable().optional(),
    mode: z.enum(['READ_ALOUD', 'COMMUNICATIVE']).optional(),
  })
  .strict();
const priorSchema = z
  .object({
    assessmentId: z.string().min(1),
    classAttempt: z.number().int().positive(),
    assessmentAttempt: z.number().int().positive(),
    submissionId: z.string().min(1),
    requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
    operationId: z.uuid(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    tasks: z.array(taskSchema.extend({ id: z.string().min(1) }).strict()),
  })
  .strict();

const historySchema = z
  .object({
    scoringPolicy: z.literal(1).optional(),
    material: z.json(),
    formativeIds: z.array(z.string()),
    formativeTasks: z.array(taskSchema),
    passThresholds: z.partialRecord(z.enum(learningSkills), z.number().finite().min(0).max(1)),
    priorAssessments: z.array(priorSchema).max(100).optional(),
    reviewSource: z
      .object({
        lesson: prerequisitePublicSourceSchema,
        prerequisite: prerequisiteAddendumSchema.nullable(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** Read only after the caller verifies the job, archive, and outcome binding. */
export async function readAssessmentHistory(
  database: Prisma.TransactionClient,
  input: {
    id: string;
    fingerprint: string;
    manifest: z.infer<typeof assessmentHistoryManifestSchema>;
    fence: AssessmentFence;
    materialDigest: string;
  }
) {
  const manifest = assessmentHistoryManifestSchema.parse(input.manifest);
  const pages = [];
  for (let index = 0; index < manifest.chunks; index += 1) {
    const page = await sottoJobSnapshot(database).read(input.id, input.fingerprint, index + 1);
    const next = index + 1 < manifest.chunks ? index + 2 : null;
    if (page.pages !== manifest.chunks + 1 || page.next !== next || page.items.length !== 1)
      throw new AssessmentFenceConflict();
    pages.push(page.items[0]);
  }
  const retained = historySchema.parse(decodeAssessmentHistory(manifest, pages));
  const material = parseAssessmentMaterial(retained.material);
  const fence = input.fence;
  if (
    assessmentMaterialDigest(material) !== input.materialDigest ||
    material.id !== fence.assessmentId ||
    material.classId !== fence.classId ||
    material.courseId !== fence.courseId ||
    material.userId !== fence.userId ||
    material.classAttempt !== fence.classAttempt ||
    material.assessmentAttempt !== fence.assessmentAttempt ||
    material.version !== (fence.materialVersion ?? 1) ||
    material.formativeRevision !== fence.formativeRevision ||
    !isDeepStrictEqual(material.requirements, fence.requirements) ||
    (retained.reviewSource !== undefined &&
      (retained.reviewSource.lesson.course.nativeLang !== fence.requirements.nativeLang ||
        retained.reviewSource.lesson.course.targetLang !== fence.requirements.targetLang ||
        retained.reviewSource.lesson.lesson.level !== fence.requirements.level)) ||
    Object.entries(fence.thresholds).some(
      ([skill, value]) =>
        retained.passThresholds[skill as keyof typeof retained.passThresholds] !== value
    )
  )
    throw new AssessmentFenceConflict();
  await database.$queryRaw`SELECT id FROM "ClassAssessment" WHERE "classId" = ${fence.classId} AND ("classAttempt" < ${fence.classAttempt} OR ("classAttempt" = ${fence.classAttempt} AND "assessmentAttempt" < ${fence.assessmentAttempt})) ORDER BY id FOR UPDATE`;
  const previous = await database.classAssessment.findMany({
    where: {
      classId: fence.classId,
      OR: [
        { classAttempt: { lt: fence.classAttempt } },
        { classAttempt: fence.classAttempt, assessmentAttempt: { lt: fence.assessmentAttempt } },
      ],
    },
    include: { submission: true },
    orderBy: [{ classAttempt: 'asc' }, { assessmentAttempt: 'asc' }],
    take: 101,
  });
  const archived = retained.priorAssessments ?? [];
  if (
    previous.length !== archived.length ||
    previous.filter((prior) => prior.classAttempt === fence.classAttempt).length !==
      fence.assessmentAttempt - 1
  )
    throw new AssessmentFenceConflict();
  let remainingBytes = 32 * 1024 * 1024;
  let previousClassAttempt = 0;
  let previousAssessmentAttempt = 0;
  for (const [index, prior] of previous.entries()) {
    if (prior.classAttempt !== previousClassAttempt) {
      previousClassAttempt = prior.classAttempt;
      previousAssessmentAttempt = 0;
    }
    previousAssessmentAttempt += 1;
    const saved = archived[index];
    if (
      !saved ||
      prior.assessmentAttempt !== previousAssessmentAttempt ||
      prior.id !== saved.assessmentId ||
      prior.courseId !== fence.courseId ||
      prior.userId !== fence.userId ||
      prior.classAttempt !== saved.classAttempt ||
      prior.assessmentAttempt !== saved.assessmentAttempt ||
      prior.status !== 'COMMITTED' ||
      prior.generationOperationId !== saved.operationId ||
      prior.submission?.id !== saved.submissionId ||
      prior.submission.requestDigest !== saved.requestDigest
    )
      throw new AssessmentFenceConflict();
    const projection = await readPriorAssessmentProjection(
      database,
      {
        operationId: saved.operationId,
        fingerprint: saved.fingerprint,
        assessmentId: saved.assessmentId,
        classId: fence.classId,
        courseId: fence.courseId,
        userId: fence.userId,
        classAttempt: saved.classAttempt,
        assessmentAttempt: saved.assessmentAttempt,
      },
      remainingBytes
    );
    remainingBytes -= projection.bytes;
    if (!isDeepStrictEqual(projection.tasks, saved.tasks)) throw new AssessmentFenceConflict();
    for (const { id, ...task } of saved.tasks) {
      const position = retained.formativeIds.indexOf(id);
      if (
        position < 0 ||
        retained.formativeIds.lastIndexOf(id) !== position ||
        !isDeepStrictEqual(retained.formativeTasks[position], task)
      )
        throw new AssessmentFenceConflict();
    }
  }
  return { ...retained, material };
}
