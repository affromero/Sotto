import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered } from '@/lib/prisma';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { enqueueDurableQueueJob } from '@/lib/sidedoor/jobs/core/durable-queue';
import { publishLearningCatalog } from '@/lib/learning-map/catalog';
import { languageCatalogAvailability } from '@/lib/learning-map/catalogs';
import { checkRateLimit } from '@/lib/redis';
import { captureMaterialAnalysisPolicy } from './policy';
import { materialFocusAnalysisHash } from './protocol';
import { MaterialAnalysisConflict, materialAnalysisBytesHash } from './inventory';

const language = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z]{2}$/);
export const materialAnalysisRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: z.uuid(),
    native: language,
    target: language,
    materialIds: z.array(z.uuid()).max(10).default([]),
    content: z
      .string()
      .max(20000)
      .refine((value) => value.isWellFormed())
      .default(''),
    includeCourseNote: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.native === value.target)
      context.addIssue({ code: 'custom', message: 'Native and target languages must differ.' });
    if (!value.materialIds.length && !value.content.trim() && !value.includeCourseNote)
      context.addIssue({
        code: 'custom',
        message: 'Select retained materials or paste source text.',
      });
  });
export const materialAnalysisPayloadSchema = z
  .object({ userId: z.string().min(1), analysisId: z.uuid() })
  .strict();
export function materialAnalysisStatusIdentity(row: {
  id: string;
  revision: number;
  status: string;
  identityDigest: string | null;
  resultDigest: string | null;
}) {
  return {
    analysisId: row.id,
    analysisRevision: row.revision,
    status: row.status,
    identityDigest: row.identityDigest,
    resultDigest: row.resultDigest,
    statusUrl: `/api/v1/material-analyses/${row.id}`,
  };
}

/** Capture immutable sources and admit a profile-scoped outbox operation. No model calls. */
export async function requestMaterialAnalysis(
  execution: SottoProviderExecution,
  requestInput: z.input<typeof materialAnalysisRequestSchema>,
  courseId?: string
) {
  const input = materialAnalysisRequestSchema.parse(requestInput);
  const materials = [...new Set(input.materialIds)].sort();
  const intentDigest = materialFocusAnalysisHash({
    ...input,
    materialIds: materials,
    courseId: courseId ?? null,
  });
  const replay = await sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      await execution.authorize(database);
      const alias = await database.materialAnalysisRequest.findUnique({
        where: { userId_requestId: { userId: execution.userId, requestId: input.requestId } },
        include: { analysis: true },
      });
      if (alias && alias.intentDigest !== intentDigest)
        throw new MaterialAnalysisConflict('This request ID belongs to different analysis inputs.');
      return alias?.analysis ?? null;
    },
    { signal: execution.signal }
  );
  if (replay) return materialAnalysisStatusIdentity(replay);
  const rate = await checkRateLimit(`material-analysis:${execution.userId}`, 10, 3600);
  if (!rate.allowed)
    throw new MaterialAnalysisConflict('Analysis admission limit reached. Try again later.', 429);
  const { policy } = await captureMaterialAnalysisPolicy(execution);
  return sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      const actor = await execution.authorize(database);
      if (actor.userId !== execution.userId)
        throw new MaterialAnalysisConflict('The analysis owner changed.');
      await database.$queryRaw`SELECT id FROM "User" WHERE id = ${execution.userId} FOR UPDATE`;
      const user = await database.user.findUniqueOrThrow({
        where: { id: execution.userId },
        select: { createdAt: true },
      });
      const course = courseId
        ? await database.course.findFirst({
            where: {
              id: courseId,
              userId: execution.userId,
              nativeLang: input.native,
              targetLang: input.target,
            },
          })
        : null;
      if (courseId && !course) throw new MaterialAnalysisConflict('Course not found.', 404);
      const prior = await database.materialAnalysisRequest.findUnique({
        where: { userId_requestId: { userId: execution.userId, requestId: input.requestId } },
        include: { analysis: true },
      });
      if (prior) {
        if (prior.intentDigest !== intentDigest)
          throw new MaterialAnalysisConflict(
            'This request ID belongs to different analysis inputs.'
          );
        return materialAnalysisStatusIdentity(prior.analysis);
      }
      const sources: Array<Prisma.MaterialAnalysisSourceUncheckedCreateWithoutAnalysisInput> = [];
      const descriptors: Prisma.InputJsonObject[] = [];
      for (const materialId of materials) {
        const material = await database.courseMaterial.findFirst({
          where: { id: materialId, userId: execution.userId },
          include: {
            extractionRuns: {
              where: { status: { not: 'FAILED' } },
              orderBy: { processingRevision: 'desc' },
              take: 1,
            },
          },
        });
        if (
          !material?.originalUrl ||
          !material.originalSha256 ||
          (material.courseId !== null && material.courseId !== courseId)
        )
          throw new MaterialAnalysisConflict(
            'A material is unavailable or belongs to another course.'
          );
        const run = material.extractionRuns[0];
        if (
          !run ||
          run.processingRevision !== material.processingRevision ||
          run.originalSha256 !== material.originalSha256
        )
          throw new MaterialAnalysisConflict(
            'Process the complete original before analyzing this material.'
          );
        sources.push({
          id: randomUUID(),
          kind: 'MATERIAL',
          order: sources.length,
          name: material.name,
          materialId,
          materialGeneration: BigInt(material.createdAt.getTime()),
          runId: run.id,
          processingRevision: run.processingRevision,
          originalSha256: run.originalSha256,
        });
        descriptors.push({
          kind: 'MATERIAL',
          materialId,
          generation: material.createdAt.getTime(),
          runId: run.id,
          processingRevision: run.processingRevision,
          originalSha256: run.originalSha256,
        });
      }
      if (input.content.trim()) {
        const bytes = Buffer.from(input.content, 'utf8'),
          snapshotSha256 = materialAnalysisBytesHash(bytes);
        sources.push({
          id: randomUUID(),
          kind: 'PASTE',
          order: sources.length,
          name: 'Pasted learner materials',
          snapshotBytes: Uint8Array.from(bytes),
          snapshotSha256,
        });
        descriptors.push({ kind: 'PASTE', snapshotSha256 });
      }
      if (input.includeCourseNote) {
        if (!course)
          throw new MaterialAnalysisConflict('A course is required to analyze its note.', 400);
        const note = await database.courseNote.findUnique({ where: { courseId: course.id } });
        if (!note?.body.trim())
          throw new MaterialAnalysisConflict('The course note has no source text.', 422);
        const bytes = Buffer.from(note.body, 'utf8'),
          snapshotSha256 = materialAnalysisBytesHash(bytes);
        sources.push({
          id: randomUUID(),
          kind: 'COURSE_NOTE',
          order: sources.length,
          name: 'Course note',
          snapshotBytes: Uint8Array.from(bytes),
          snapshotSha256,
          noteId: note.id,
          noteGeneration: BigInt(note.updatedAt.getTime()),
        });
        descriptors.push({
          kind: 'COURSE_NOTE',
          snapshotSha256,
          noteId: note.id,
          noteGeneration: note.updatedAt.getTime(),
        });
      }
      const sourceSetDigest = materialFocusAnalysisHash({
        owner: { id: execution.userId, generation: user.createdAt.getTime() },
        native: input.native,
        target: input.target,
        courseId: courseId ?? null,
        sources: descriptors,
      });
      const unresolved = await database.materialAnalysis.findFirst({
        where: {
          userId: execution.userId,
          sourceSetDigest,
          status: { in: ['RECOVERY_REQUIRED', 'CANCELLING'] },
        },
      });
      if (unresolved)
        throw new MaterialAnalysisConflict(
          'Recover the existing analysis before starting another request for the same sources.'
        );
      const available = languageCatalogAvailability(input.target);
      const catalog =
        available.status === 'PUBLISHED'
          ? await publishLearningCatalog(database, available.catalog)
          : null;
      const admissionDigest = materialFocusAnalysisHash({
        sourceSetDigest,
        catalogHash: catalog?.catalogHash ?? null,
        policy,
      });
      const existing = await database.materialAnalysis.findUnique({
        where: { userId_admissionDigest: { userId: execution.userId, admissionDigest } },
      });
      const analysis =
        existing ??
        (await database.materialAnalysis.create({
          data: {
            userId: execution.userId,
            userGeneration: BigInt(user.createdAt.getTime()),
            nativeLang: input.native,
            targetLang: input.target,
            intendedCourseId: courseId ?? null,
            attachedCourseId: courseId ?? null,
            purpose: courseId ? 'COURSE_IMPORT' : 'PLACEMENT',
            requestId: input.requestId,
            admissionDigest,
            sourceSetDigest,
            catalogRevisionId: catalog?.id ?? null,
            policy,
            sources: { create: sources },
          },
        }));
      await database.materialAnalysisRequest.create({
        data: {
          userId: execution.userId,
          requestId: input.requestId,
          analysisId: analysis.id,
          intentDigest,
        },
      });
      if (!existing)
        await enqueueDurableQueueJob(database, {
          handler: 'material-analysis',
          type: 'analyze_material_sources',
          payload: materialAnalysisPayloadSchema.parse({
            userId: execution.userId,
            analysisId: analysis.id,
          }),
          jobId: `material-analysis-${analysis.id}-${analysis.revision}`,
          attempts: 2,
        });
      return materialAnalysisStatusIdentity(analysis);
    },
    { signal: execution.signal, timeoutMs: 60000 }
  );
}
