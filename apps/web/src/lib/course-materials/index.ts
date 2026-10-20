import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { z } from 'zod';
import { AccessError } from 'thesidedoor-core/access';
import { readRequestBytes, RequestBodyTooLargeError } from 'thesidedoor-core/runtime/request';
import type { Prisma } from '@/generated/prisma/client';
import type { AuthenticatedRequest } from '../api-keys';
import { prismaUnfiltered } from '../prisma';
import { writeStorageReference } from '../sidedoor/storage/core/storage-write';
import { requireOriginalSottoAdmission } from '../sidedoor/access/core/request-identity';
import { sottoStorageInstance } from '../sidedoor/access/state/store';
import { extractUploadTexts, isUploadFile } from '../note-upload';
import { getEditableCourseNote, mergeCourseNote, setCourseNote } from '../course-notes';
import { sottoTransaction } from '../sidedoor/access/state/transaction';
import type { SottoProviderExecution } from '../sidedoor/credentials/runtime/provider-execution';
import { enqueueMaterialVocabularyIndex } from '../vocabulary/index-admission';

const MAX_MATERIAL_BYTES = 50 * 1024 * 1024;
const MAX_MATERIAL_FILES = 10;
export const materialSelect = {
  id: true,
  name: true,
  mimeType: true,
  byteSize: true,
  extractedText: true,
  createdAt: true,
} as const;

export async function readMaterialForm(request: Request) {
  const bytes = await readRequestBytes(request, MAX_MATERIAL_BYTES + 128 * 1024);
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  const form = await new Request(request.url, {
    method: 'POST',
    headers,
    body: Uint8Array.from(bytes).buffer,
    signal: request.signal,
  }).formData();
  const parsed = z
    .array(z.custom<File>(isUploadFile))
    .max(MAX_MATERIAL_FILES)
    .safeParse(form.getAll('files'));
  if (!parsed.success) throw new AccessError('invalid', 'Choose up to 10 material files.');
  const files = parsed.data;
  if (files.reduce((total, file) => total + file.size, 0) > MAX_MATERIAL_BYTES)
    throw new RequestBodyTooLargeError(MAX_MATERIAL_BYTES);
  return { form, files };
}

export async function materialStorageScopes(
  database: Prisma.TransactionClient,
  input: { id: string; userId: string; createdAt: Date }
) {
  const instance = await sottoStorageInstance(database).read();
  const user = await database.user.findUnique({
    where: { id: input.userId },
    select: { createdAt: true },
  });
  if (!user) throw new AccessError('unauthorized');
  return {
    instanceId: instance.instanceId,
    scopes: [
      { subjectId: instance.subjectId, generation: instance.generation },
      { subjectId: `profile:${input.userId}`, generation: user.createdAt.getTime() },
      { subjectId: `material:${input.id}`, generation: input.createdAt.getTime() },
    ].sort((left, right) => left.subjectId.localeCompare(right.subjectId)),
  };
}

export function materialResponse(material: {
  id: string;
  name: string;
  mimeType: string;
  byteSize: number;
  extractedText: string;
  createdAt: Date;
}) {
  return {
    id: material.id,
    name: material.name,
    mimeType: material.mimeType,
    byteSize: material.byteSize,
    extractedText: material.extractedText,
    createdAt: material.createdAt,
    fileUrl: `/api/v1/materials/${material.id}/file`,
  };
}

/** Originals and extracts have stable profile/material ownership before course attachment. */
export async function importCourseMaterials(
  request: Request,
  admission: AuthenticatedRequest,
  files: File[],
  courseId?: string
) {
  const { uploads, failed } = await extractUploadTexts(files);
  const materials: ReturnType<typeof materialResponse>[] = [];
  for (const { file, sourceText } of uploads) {
    const id = randomUUID();
    const createdAt = new Date();
    const name = file.name.replace(/[\u0000-\u001f\/\\]/g, '_').slice(0, 240) || 'course-material';
    const mimeType = name.toLowerCase().endsWith('.pdf')
      ? 'application/pdf'
      : file.type || 'application/octet-stream';
    const extension = extname(name)
      .slice(1)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    await writeStorageReference({
      database: prismaUnfiltered,
      signal: request.signal,
      prefix: `materials/${admission.userId}/${id}`,
      extension: extension.length <= 12 ? extension || 'bin' : 'bin',
      body: new Uint8Array(await file.arrayBuffer()),
      contentType: mimeType,
      previousReference: () => null,
      captureAdmission: async (database) => {
        await requireOriginalSottoAdmission(database, request, admission);
        if (
          courseId &&
          !(await database.course.findFirst({
            where: { id: courseId, userId: admission.userId },
            select: { id: true },
          }))
        )
          throw new AccessError('conflict');
        await database.courseMaterial.create({
          data: {
            id,
            userId: admission.userId,
            courseId,
            name,
            mimeType,
            byteSize: file.size,
            extractedText: sourceText,
            createdAt,
          },
        });
        return {
          ...(await materialStorageScopes(database, { id, userId: admission.userId, createdAt })),
          consumer: `material:${id}:original`,
          snapshot: null,
        };
      },
      validateAdmission: async (database, captured, committedReference) => {
        await requireOriginalSottoAdmission(database, request, admission);
        const current = await materialStorageScopes(database, {
          id,
          userId: admission.userId,
          createdAt,
        });
        if (
          JSON.stringify(current.scopes) !== JSON.stringify(captured.scopes) ||
          current.instanceId !== captured.instanceId
        )
          throw new AccessError('conflict');
        if (
          courseId &&
          !(await database.course.findFirst({
            where: { id: courseId, userId: admission.userId },
            select: { id: true },
          }))
        )
          throw new AccessError('conflict');
        if (
          !(await database.courseMaterial.findFirst({
            where: { id, userId: admission.userId, originalUrl: committedReference ?? null },
            select: { id: true },
          }))
        )
          throw new AccessError('conflict');
      },
      commit: async (database, originalUrl) => {
        const published = await database.courseMaterial.updateMany({
          where: { id, userId: admission.userId, originalUrl: null },
          data: { originalUrl },
        });
        if (published.count !== 1) throw new AccessError('conflict');
        if (courseId) await enqueueMaterialVocabularyIndex(database, id, admission.userId);
      },
    });
    materials.push(
      materialResponse({
        id,
        name,
        mimeType,
        byteSize: file.size,
        extractedText: sourceText,
        createdAt,
      })
    );
  }
  return { materials, failed };
}

/** Course attachment is idempotent and cannot claim another learner's staged document. */
export async function attachCourseMaterials(
  database: Prisma.TransactionClient,
  userId: string,
  courseId: string,
  materialIds: readonly string[]
) {
  const ids = [...new Set(materialIds)];
  if (!ids.length) return;
  if (!(await database.course.findFirst({ where: { id: courseId, userId }, select: { id: true } })))
    throw new AccessError('conflict');
  const materials = await database.courseMaterial.findMany({
    where: {
      id: { in: ids },
      userId,
      originalUrl: { not: null },
      OR: [{ courseId: null }, { courseId }],
    },
    select: { id: true },
  });
  if (materials.length !== ids.length)
    throw new AccessError(
      'conflict',
      'An uploaded material is no longer available for this course.'
    );
  const attached = await database.courseMaterial.updateMany({
    where: {
      id: { in: ids },
      userId,
      originalUrl: { not: null },
      OR: [{ courseId: null }, { courseId }],
    },
    data: { courseId },
  });
  if (attached.count !== ids.length) throw new AccessError('conflict');
  for (const id of ids) await enqueueMaterialVocabularyIndex(database, id, userId);
}

export async function persistPlacementMaterials(
  courseId: string,
  execution: SottoProviderExecution,
  input: { materialIds: string[]; editableContent: string }
) {
  await sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      const actor = await execution.authorize(database);
      if (actor.userId !== execution.userId) throw new AccessError('conflict');
      await attachCourseMaterials(database, actor.userId, courseId, input.materialIds);
      const note = mergeCourseNote(
        await getEditableCourseNote(courseId, database),
        input.editableContent
      );
      await setCourseNote(courseId, note, database);
    },
    { signal: execution.signal }
  );
}
