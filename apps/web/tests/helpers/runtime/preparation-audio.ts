import { randomUUID } from 'node:crypto';
import { delegationGrantBinding, type DelegationGrant } from 'thesidedoor-core/runtime/delegation';
import type { PrismaClient } from '@/generated/prisma/client';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { captureCourseStorage } from '@/lib/sidedoor/storage/core/course-storage';
import { registerPreparationAudio } from '@/lib/classes/preparation-audio';
import { classPreparationGrant, preparationGrantSpec } from '@/lib/classes/preparation-grant';
import type { ClassPreparation } from '@/lib/classes/preparation-state';
import { classPreparationBackend } from '@/lib/classes/preparation';

/** Creates real persisted course ownership, grant and audio lineage for integration tests. */
export async function linkPreparationAudio(
  database: PrismaClient,
  userId: string,
  episodeId: string,
  options: { courseId?: string; deferRegistration?: boolean } = {}
) {
  return sottoTransaction(database, async (tx) => {
    const curriculum = await tx.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'es' } },
      update: {},
      create: { nativeLang: 'en', targetLang: 'es', title: 'Audio lineage test' },
    });
    const course = options.courseId
      ? await tx.course.findUniqueOrThrow({ where: { id: options.courseId } })
      : await tx.course.upsert({
          where: { userId_nativeLang_targetLang: { userId, nativeLang: 'en', targetLang: 'es' } },
          update: {},
          create: { userId, nativeLang: 'en', targetLang: 'es', curriculumId: curriculum.id },
        });
    const ownership = await captureCourseStorage(tx, course.id);
    const subject = ownership.scopes.find((scope) => scope.subjectId === `profile:${userId}`)!;
    const resource = ownership.scopes.find((scope) => scope.subjectId === `course:${course.id}`)!;
    const now = Date.now();
    const id = randomUUID();
    const grant: DelegationGrant = {
      id,
      revision: randomUUID(),
      instanceId: ownership.instanceId,
      subject: { id: subject.subjectId, generation: subject.generation },
      resource: { id: resource.subjectId, generation: resource.generation },
      operationId: id,
      action: 'class-parent-provider-request',
      expiresAt: now + 600_000,
      maxRequests: 20,
    };
    const operation: ClassPreparation = {
      id,
      courseId: course.id,
      userId,
      instanceId: ownership.instanceId,
      courseCreatedAt: resource.generation,
      userCreatedAt: subject.generation,
      createdAt: now,
      updatedAt: now,
      availableAt: now,
      expiresAt: grant.expiresAt,
      timeZone: 'UTC',
      inputFingerprint: 'b'.repeat(64),
      deferAudio: false,
      maxProviderRequests: 20,
      selection: { provider: 'local', model: 'fixture-model', credentialFingerprint: null },
      grant: delegationGrantBinding(grant),
      status: 'RUNNING',
      classId: null,
      audioEpisodeIds: [],
      result: null,
      failure: null,
    };
    await classPreparationGrant(tx, operation).create(preparationGrantSpec(operation));
    const backend = classPreparationBackend(tx, course.id);
    const previous = await backend.read();
    if (
      !(await backend.compareAndSwap(previous?.revision ?? null, {
        revision: randomUUID(),
        state: operation,
      }))
    )
      throw new Error('Preparation fixture conflicted');
    const episode = await tx.episode.findUniqueOrThrow({
      where: { id: episodeId },
      select: { audioGenerationKey: true },
    });
    const generationKey = episode.audioGenerationKey ?? 'preparation-audio-fixture';
    if (!episode.audioGenerationKey)
      await tx.episode.update({
        where: { id: episodeId },
        data: { audioGenerationKey: generationKey },
      });
    if (!options.deferRegistration)
      await registerPreparationAudio(tx, operation, episodeId, generationKey);
    return { ...operation, audioEpisodeIds: options.deferRegistration ? [] : [episodeId] };
  });
}

export function settlePreparationAudio(
  database: PrismaClient,
  operation: ClassPreparation,
  status: 'completed' | 'revoked'
) {
  return sottoTransaction(database, (tx) => {
    const grant = classPreparationGrant(tx, operation);
    return status === 'completed' ? grant.complete(operation.grant) : grant.revoke(operation.grant);
  });
}
