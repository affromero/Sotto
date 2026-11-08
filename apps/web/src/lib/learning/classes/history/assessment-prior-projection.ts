import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { sottoJobOutbox, sottoJobSnapshot } from '@/lib/sidedoor/jobs/core/job-delivery';
import { readAssessmentArchive } from './assessment-archive';
import { AssessmentFenceConflict, assessmentWorkSchema } from '../lifecycle/assessment-fence';
import { decodeAssessmentHistory } from './assessment-history-codec';
import {
  assessmentMaterialDigest,
  exposedAssessmentTasks,
  parseAssessmentMaterial,
} from '../material/assessment-material';

/** Verify a predecessor's projection without recursively loading its own predecessors. */
export async function readPriorAssessmentProjection(
  database: Prisma.TransactionClient,
  input: {
    operationId: string;
    fingerprint: string;
    assessmentId: string;
    classId: string;
    courseId: string;
    userId: string;
    classAttempt: number;
    assessmentAttempt: number;
  },
  remainingBytes: number
) {
  const outbox = sottoJobOutbox(database);
  const operation = await outbox.read(input.operationId);
  if (
    !operation ||
    !operation.complete ||
    operation.fingerprint !== input.fingerprint ||
    operation.job.id !== input.operationId ||
    operation.job.handler !== 'interactions' ||
    operation.job.version !== 6
  )
    throw new AssessmentFenceConflict();
  const { fence } = assessmentWorkSchema.parse(operation.job.payload);
  const archive = await readAssessmentArchive(database, input.operationId);
  if (
    archive.fingerprint !== input.fingerprint ||
    !isDeepStrictEqual(archive.fence, { ...fence, status: 'COMPLETED' }) ||
    !isDeepStrictEqual(operation.job.scopes, fence.ownership.scopes) ||
    fence.status !== 'QUEUED' ||
    fence.id !== input.operationId ||
    fence.assessmentId !== input.assessmentId ||
    fence.classId !== input.classId ||
    fence.courseId !== input.courseId ||
    fence.userId !== input.userId ||
    fence.classAttempt !== input.classAttempt ||
    fence.assessmentAttempt !== input.assessmentAttempt
  )
    throw new AssessmentFenceConflict();
  const page = await sottoJobSnapshot(database).read(input.operationId, input.fingerprint, 0);
  if (page.items.length !== 1) throw new AssessmentFenceConflict();
  const { assessmentOutcomeSchema } = await import('../lifecycle/assessment-outcome');
  const outcome = assessmentOutcomeSchema.parse(page.items[0]);
  const manifest = outcome.history;
  if (
    !manifest ||
    manifest.bytes > remainingBytes ||
    archive.historyDigest !== manifest.digest ||
    page.pages !== manifest.chunks + 1 ||
    page.next !== 1 ||
    outcome.operationId !== input.operationId ||
    outcome.fingerprint !== input.fingerprint ||
    outcome.assessmentId !== input.assessmentId ||
    outcome.classId !== input.classId ||
    outcome.userId !== input.userId ||
    outcome.classAttempt !== input.classAttempt ||
    outcome.assessmentAttempt !== input.assessmentAttempt ||
    outcome.formativeRevision !== fence.formativeRevision ||
    outcome.teachingKind !== fence.teachingReceipt.kind ||
    outcome.teachingReceiptId !== fence.teachingReceipt.receiptId
  )
    throw new AssessmentFenceConflict();
  const pages = [];
  for (let index = 0; index < manifest.chunks; index += 1) {
    const next = await sottoJobSnapshot(database).read(
      input.operationId,
      input.fingerprint,
      index + 1
    );
    if (
      next.pages !== manifest.chunks + 1 ||
      next.next !== (index + 1 < manifest.chunks ? index + 2 : null) ||
      next.items.length !== 1
    )
      throw new AssessmentFenceConflict();
    pages.push(next.items[0]);
  }
  const history = z
    .object({ material: z.json() })
    .passthrough()
    .parse(decodeAssessmentHistory(manifest, pages));
  const material = parseAssessmentMaterial(history.material);
  if (
    assessmentMaterialDigest(material) !== outcome.materialDigest ||
    material.id !== input.assessmentId ||
    material.classId !== input.classId ||
    material.courseId !== input.courseId ||
    material.userId !== input.userId ||
    material.classAttempt !== input.classAttempt ||
    material.assessmentAttempt !== input.assessmentAttempt ||
    material.version !== (fence.materialVersion ?? 1) ||
    material.formativeRevision !== fence.formativeRevision ||
    !isDeepStrictEqual(material.requirements, fence.requirements)
  )
    throw new AssessmentFenceConflict();
  return { tasks: exposedAssessmentTasks(material), bytes: manifest.bytes };
}
