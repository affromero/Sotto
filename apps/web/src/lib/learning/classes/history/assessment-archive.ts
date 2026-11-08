import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import {
  assessmentFenceSchema,
  AssessmentFenceConflict,
  type AssessmentFence,
} from '../lifecycle/assessment-fence';

const archiveSchema = z
  .object({
    version: z.literal(1),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    historyDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    fence: assessmentFenceSchema,
  })
  .strict();

export function assessmentArchiveId(operationId: string) {
  return `${SIDEDOOR_STATE_ID}:assessment-archive:${z.uuid().parse(operationId)}`;
}

/** Preserve a completed fence once, in the same transaction that seals its outcome. */
export async function createAssessmentArchive(
  database: Prisma.TransactionClient,
  input: { fingerprint: string; fence: AssessmentFence; historyDigest?: string }
) {
  const archive = archiveSchema.parse({ version: 1, ...input });
  if (archive.fence.status !== 'COMPLETED') throw new AssessmentFenceConflict();
  const id = assessmentArchiveId(archive.fence.id);
  if (await database.sidedoorState.findUnique({ where: { id } }))
    throw new AssessmentFenceConflict();
  await database.sidedoorState.create({ data: { id, revision: randomUUID(), state: archive } });
}

/** Read the exact archived operation; the caller still verifies its durable outcome. */
export async function readAssessmentArchive(
  database: Prisma.TransactionClient,
  operationId: string
) {
  const row = await database.sidedoorState.findUnique({
    where: { id: assessmentArchiveId(operationId) },
  });
  if (!row) throw new AssessmentFenceConflict();
  const archive = archiveSchema.parse(row.state);
  if (archive.fence.id !== operationId || archive.fence.status !== 'COMPLETED')
    throw new AssessmentFenceConflict();
  return { revision: row.revision, ...archive };
}
