import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@/generated/prisma/client';
import { fenceAssessmentStorageInputs } from '@/lib/learning/classes/lifecycle/assessment-storage-fence';
import { resolveStorageInput } from '@/lib/sidedoor/storage/core/storage-inputs';
import { validateClassPreparation } from '../preparation';
import { PreparationConflictError, type ClassPreparation } from '../preparation-state';
import { speakingRepairSourceHash } from '../repair/speaking-repair-source';
import {
  speakingReferenceEnvelopeSchema,
  speakingReferenceKeyForEnvelope,
  verifySpeakingReferenceEnvelope,
  type SpeakingReferenceBinding,
  type SpeakingReferenceEnvelope,
} from '../speaking/speaking-reference-crypto';

async function requireSpeakingOperation(
  database: Prisma.TransactionClient,
  operation: ClassPreparation
) {
  const current = await validateClassPreparation(database, operation.courseId, operation.id);
  if (
    !isDeepStrictEqual(current.intent, operation.intent) ||
    !isDeepStrictEqual(current.grant, operation.grant) ||
    current.userId !== operation.userId ||
    current.instanceId !== operation.instanceId ||
    current.courseCreatedAt !== operation.courseCreatedAt ||
    current.userCreatedAt !== operation.userCreatedAt ||
    current.intent?.kind !== 'REPAIR' ||
    !current.intent.skills.includes('SPEAKING') ||
    !current.intent.speakingSourceHash
  )
    throw new PreparationConflictError('The speaking repair authority changed.');
  return current.intent;
}

function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function material(database: Prisma.TransactionClient, sectionId: string) {
  const section = await database.classSection.findUniqueOrThrow({
    where: { id: sectionId },
    include: { prompts: { orderBy: { id: 'asc' } } },
  });
  const { prompts, ...sectionData } = section;
  const content = {
    section: sectionData,
    prompts: prompts.map((prompt) => ({
      ...prompt,
      referenceTtsUrl: null,
      referenceEncryption: null,
    })),
  };
  return {
    section,
    materialHash: hash(content),
    sealedHash: hash({
      content,
      references: section.prompts.map((p) => [p.id, p.referenceTtsUrl, p.referenceEncryption]),
    }),
  };
}

export async function stageClassSpeaking(
  database: Prisma.TransactionClient,
  operation: ClassPreparation,
  input: { classId: string; attempt: number; sectionId: string; sourceHash: string }
) {
  const intent = await requireSpeakingOperation(database, operation);
  if (
    input.classId !== intent.classId ||
    input.attempt !== intent.attempt ||
    input.sourceHash !== intent.speakingSourceHash ||
    input.sourceHash !== (await speakingRepairSourceHash(database, input.classId, input.attempt))
  )
    throw new PreparationConflictError('The saved speaking material changed during repair.');
  const staged = await material(database, input.sectionId);
  if (
    staged.section.classId !== input.classId ||
    staged.section.attempt !== input.attempt ||
    staged.section.skill !== 'SPEAKING' ||
    !staged.section.withdrawn ||
    staged.section.status !== 'READY' ||
    staged.section.prompts.length === 0 ||
    staged.section.prompts.some((p) => p.referenceTtsUrl !== null || p.referenceEncryption !== null)
  )
    throw new PreparationConflictError('The staged speaking section changed.');
  await database.classSpeakingStage.create({
    data: {
      sectionId: input.sectionId,
      operationId: operation.id,
      incarnationId: staged.section.incarnationId,
      version: 1,
      sourceHash: input.sourceHash,
      materialHash: staged.materialHash,
    },
  });
}

async function requireStage(
  database: Prisma.TransactionClient,
  operation: ClassPreparation,
  sectionId: string
) {
  const intent = await requireSpeakingOperation(database, operation);
  await database.$queryRaw`SELECT "sectionId" FROM "ClassSpeakingStage" WHERE "sectionId" = ${sectionId} FOR UPDATE`;
  const stage = await database.classSpeakingStage.findUnique({ where: { sectionId } });
  const staged = await material(database, sectionId);
  const recording = await database.speakingRecording.findFirst({
    where: { OR: [{ sectionId }, { promptId: { in: staged.section.prompts.map((p) => p.id) } }] },
    select: { id: true },
  });
  if (
    !stage ||
    stage.version !== 1 ||
    stage.operationId !== operation.id ||
    stage.incarnationId !== staged.section.incarnationId ||
    staged.section.classId !== intent.classId ||
    staged.section.attempt !== intent.attempt ||
    staged.section.skill !== 'SPEAKING' ||
    !staged.section.withdrawn ||
    staged.section.status !== 'READY' ||
    recording !== null ||
    stage.materialHash !== staged.materialHash ||
    stage.sourceHash !== intent.speakingSourceHash ||
    stage.sourceHash !== (await speakingRepairSourceHash(database, intent.classId, intent.attempt))
  )
    throw new PreparationConflictError('The staged speaking material changed.');
  return { stage, staged };
}

export async function verifySpeakingReferenceStage(
  database: Prisma.TransactionClient,
  operation: ClassPreparation,
  input: { sectionId: string; promptId: string }
): Promise<SpeakingReferenceBinding> {
  const { stage, staged } = await requireStage(database, operation, input.sectionId);
  const prompt = staged.section.prompts.find((p) => p.id === input.promptId);
  if (stage.sealedHash !== null || !prompt)
    throw new PreparationConflictError('The staged speaking reference changed.');
  return referenceBinding(database, operation, staged.section, prompt, stage.sourceHash);
}

async function referenceBinding(
  database: Prisma.TransactionClient,
  operation: ClassPreparation,
  section: { id: string; classId: string; incarnationId: string; attempt: number },
  prompt: { id: string; incarnationId: string },
  sourceHash: string
): Promise<SpeakingReferenceBinding> {
  const cls = await database.courseClass.findUnique({
    where: { id: section.classId },
    select: { createdAt: true, courseId: true },
  });
  if (!cls || cls.courseId !== operation.courseId)
    throw new PreparationConflictError('The speaking repair authority changed.');
  return {
    instanceId: operation.instanceId,
    userId: operation.userId,
    userCreatedAt: operation.userCreatedAt,
    courseId: operation.courseId,
    courseCreatedAt: operation.courseCreatedAt,
    classId: section.classId,
    classCreatedAt: cls.createdAt.getTime(),
    sectionId: section.id,
    sectionIncarnationId: section.incarnationId,
    promptId: prompt.id,
    promptIncarnationId: prompt.incarnationId,
    attempt: section.attempt,
    operationId: operation.id,
    sourceHash,
  };
}

async function authenticateReferences(
  database: Prisma.TransactionClient,
  operation: ClassPreparation,
  staged: Awaited<ReturnType<typeof material>>['section'],
  sourceHash: string
) {
  for (const prompt of staged.prompts) {
    if (prompt.referenceTtsUrl === null && prompt.referenceEncryption === null) continue;
    const parsed = speakingReferenceEnvelopeSchema.safeParse(prompt.referenceEncryption);
    if (!prompt.referenceTtsUrl || !parsed.success)
      throw new PreparationConflictError('The staged speaking references changed.');
    const binding = await referenceBinding(database, operation, staged, prompt, sourceHash);
    let key: Buffer | undefined;
    try {
      key = speakingReferenceKeyForEnvelope(parsed.data);
      verifySpeakingReferenceEnvelope(parsed.data, binding, key);
    } catch {
      throw new PreparationConflictError('The staged speaking references changed.');
    } finally {
      key?.fill(0);
    }
  }
}

async function sealedMaterialHash(
  database: Prisma.TransactionClient,
  staged: Awaited<ReturnType<typeof material>>
) {
  const references = [];
  for (const prompt of staged.section.prompts) {
    if (!prompt.referenceTtsUrl) continue;
    const { input } = await resolveStorageInput(database, {
      consumer: `speaking-prompt:${prompt.id}:reference`,
      reference: prompt.referenceTtsUrl,
    });
    references.push({ promptId: prompt.id, input });
  }
  await fenceAssessmentStorageInputs(
    database,
    references.map(({ input }) => input)
  );
  return hash({ version: 1, material: staged.sealedHash, references });
}

export async function sealClassSpeaking(
  database: Prisma.TransactionClient,
  operation: ClassPreparation,
  input: {
    sectionId: string;
    references: ReadonlyMap<string, string>;
    encryptions?: ReadonlyMap<string, SpeakingReferenceEnvelope>;
  }
) {
  const { stage, staged } = await requireStage(database, operation, input.sectionId);
  const ids = new Set(staged.section.prompts.map((prompt) => prompt.id));
  if (
    stage.sealedHash !== null ||
    [...input.references.keys()].some((id) => !ids.has(id)) ||
    [...input.references.keys()].some((id) => !input.encryptions?.has(id)) ||
    [...(input.encryptions?.keys() ?? [])].some(
      (id) => !ids.has(id) || !input.references.has(id)
    ) ||
    staged.section.prompts.some(
      (prompt) =>
        prompt.referenceTtsUrl !== (input.references.get(prompt.id) ?? null) ||
        !isDeepStrictEqual(prompt.referenceEncryption, input.encryptions?.get(prompt.id) ?? null)
    )
  )
    throw new PreparationConflictError('The staged speaking references changed.');
  await authenticateReferences(database, operation, staged.section, stage.sourceHash);
  const sealedHash = await sealedMaterialHash(database, staged);
  await database.classSpeakingStage.update({
    where: { sectionId: input.sectionId },
    data: { sealedHash },
  });
}

export async function activateStagedSpeaking(
  database: Prisma.TransactionClient,
  operation: ClassPreparation
) {
  const intent = await requireSpeakingOperation(database, operation);
  const sections = await database.classSection.findMany({
    where: { classId: intent.classId, skill: 'SPEAKING', attempt: intent.attempt },
    select: { id: true },
  });
  if (sections.length !== 1)
    throw new PreparationConflictError('The staged speaking section is unavailable.');
  const sectionId = sections[0]!.id;
  const { stage, staged } = await requireStage(database, operation, sectionId);
  if (!stage.sealedHash)
    throw new PreparationConflictError('The staged speaking references changed.');
  await authenticateReferences(database, operation, staged.section, stage.sourceHash);
  if (stage.sealedHash !== (await sealedMaterialHash(database, staged)))
    throw new PreparationConflictError('The staged speaking references changed.');
  await database.classSpeakingStage.delete({ where: { sectionId } });
  await database.classSection.update({ where: { id: sectionId }, data: { withdrawn: false } });
}
