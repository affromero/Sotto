import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { sottoStorageInstance } from '@/lib/sidedoor/access/state/store';
import { captureCourseStorage } from '@/lib/sidedoor/storage/core/course-storage';
import { materialStorageScopes } from '@/lib/course-materials';

const scopeSchema = z
  .object({ subjectId: z.string().min(1), generation: z.number().int().nonnegative() })
  .strict();
const base = {
  userId: z.string().min(1),
  createdAt: z.number().int().positive(),
  instanceId: z.uuid(),
  scopes: z.array(scopeSchema).min(3).max(32),
};
export const materialAnalysisJobAuthoritySchema = z
  .object({
    kind: z.literal('material-analysis'),
    analysisId: z.uuid(),
    sourceSetDigest: z.string().regex(/^[a-f0-9]{64}$/),
    ...base,
  })
  .strict();
export const placementSessionJobAuthoritySchema = z
  .object({
    kind: z.literal('placement-session'),
    placementSessionId: z.uuid(),
    inputDigest: z.string().regex(/^[a-f0-9]{64}$/),
    ...base,
  })
  .strict();

export function mergeMaterialAnalysisScopes(scopes: readonly z.infer<typeof scopeSchema>[]) {
  const byId = new Map<string, z.infer<typeof scopeSchema>>();
  for (const scope of scopes) {
    const previous = byId.get(scope.subjectId);
    if (previous && previous.generation !== scope.generation)
      throw new Error('A source deletion scope changed generation.');
    byId.set(scope.subjectId, scope);
  }
  return [...byId.values()].sort((left, right) => left.subjectId.localeCompare(right.subjectId));
}

/** Every selected original participates in the analysis job's canonical erasure proof. */
export async function captureMaterialAnalysisJobAuthority(
  database: Prisma.TransactionClient,
  input: { userId: string; analysisId: string }
) {
  const analysis = await database.materialAnalysis.findFirst({
    where: { id: input.analysisId, userId: input.userId },
  });
  if (!analysis) throw new Error('The owned material analysis no longer exists.');
  const { validateMaterialAnalysisSources } = await import('../analysis/inventory');
  const sources = await validateMaterialAnalysisSources(database, analysis);
  const instance = await sottoStorageInstance(database).read();
  const scopes = [
    { subjectId: instance.subjectId, generation: instance.generation },
    { subjectId: `profile:${analysis.userId}`, generation: Number(analysis.userGeneration) },
    { subjectId: `material-analysis:${analysis.id}`, generation: analysis.createdAt.getTime() },
  ];
  if (analysis.intendedCourseId) {
    const course = await captureCourseStorage(database, analysis.intendedCourseId);
    if (course.userId !== input.userId || course.instanceId !== instance.instanceId)
      throw new Error('The analysis course authority changed.');
    scopes.push(...course.scopes);
  }
  for (const source of sources) {
    if (source.kind !== 'MATERIAL') continue;
    const material = await database.courseMaterial.findUniqueOrThrow({
      where: { id: source.materialId! },
    });
    const captured = await materialStorageScopes(database, material);
    if (captured.instanceId !== instance.instanceId)
      throw new Error('The analysis material instance changed.');
    scopes.push(...captured.scopes);
  }
  const authority = materialAnalysisJobAuthoritySchema.parse({
    kind: 'material-analysis',
    analysisId: analysis.id,
    userId: analysis.userId,
    createdAt: analysis.createdAt.getTime(),
    sourceSetDigest: analysis.sourceSetDigest,
    instanceId: instance.instanceId,
    scopes: mergeMaterialAnalysisScopes(scopes),
  });
  return { authority, scopes: authority.scopes };
}

export async function capturePlacementSessionJobAuthority(
  database: Prisma.TransactionClient,
  input: { userId: string; placementSessionId: string }
) {
  const session = await database.placementSession.findFirst({
    where: { id: input.placementSessionId, userId: input.userId },
  });
  const user = await database.user.findUnique({
    where: { id: input.userId },
    select: { createdAt: true },
  });
  if (!session || !user || BigInt(user.createdAt.getTime()) !== session.userGeneration)
    throw new Error('The owned placement session generation changed.');
  const instance = await sottoStorageInstance(database).read();
  const scopes = [
    { subjectId: instance.subjectId, generation: instance.generation },
    { subjectId: `profile:${session.userId}`, generation: Number(session.userGeneration) },
    { subjectId: `placement-session:${session.id}`, generation: session.createdAt.getTime() },
  ];
  if (session.analysisId) {
    const analysis = await database.materialAnalysis.findFirst({
      where: { id: session.analysisId, userId: session.userId },
    });
    if (
      !analysis ||
      analysis.revision !== session.analysisRevision ||
      analysis.resultDigest !== session.analysisDigest ||
      analysis.nativeLang !== session.nativeLang ||
      analysis.targetLang !== session.targetLang
    )
      throw new Error('The exact placement source analysis changed.');
    scopes.push(
      ...(
        await captureMaterialAnalysisJobAuthority(database, {
          userId: session.userId,
          analysisId: analysis.id,
        })
      ).scopes
    );
  }
  const authority = placementSessionJobAuthoritySchema.parse({
    kind: 'placement-session',
    placementSessionId: session.id,
    userId: session.userId,
    createdAt: session.createdAt.getTime(),
    inputDigest: session.inputDigest,
    instanceId: instance.instanceId,
    scopes: mergeMaterialAnalysisScopes(scopes),
  });
  return { authority, scopes: authority.scopes };
}

export async function validateMaterialAnalysisJobAuthority(
  database: Prisma.TransactionClient,
  authority:
    | z.infer<typeof materialAnalysisJobAuthoritySchema>
    | z.infer<typeof placementSessionJobAuthoritySchema>
) {
  const captured =
    authority.kind === 'material-analysis'
      ? await captureMaterialAnalysisJobAuthority(database, authority)
      : await capturePlacementSessionJobAuthority(database, authority);
  if (!isDeepStrictEqual(captured.authority, authority))
    throw new Error('The durable analysis or placement source authority changed.');
  return { userId: authority.userId };
}
