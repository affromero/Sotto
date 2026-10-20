import { randomUUID } from 'node:crypto';
import type { Job } from 'bullmq';
import { delegationGrantBinding } from 'thesidedoor-core/runtime/delegation';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { resolveCapturedLearningAi, captureLearningModerationCredential } from '@/lib/learning-ai';
import { learningCredentialFingerprint } from '@/lib/classes/preparation-selection';
import { learningPreparationGrantSpec } from '@/lib/learning/preparation/preparation-grant';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { resolveStorageInput } from '@/lib/sidedoor/storage/core/storage-inputs';
import {
  admitDurableQueueBatch,
  durableJobProviderExecution,
  durableQueueOperationId,
} from '@/lib/sidedoor/jobs/core/durable-queue';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { createQueue } from '@/lib/queue';
import {
  validateVocabularyIndex,
  vocabularyIndexOperationSchema,
  vocabularyIndexGrant,
  vocabularyIndexPayloadSchema,
} from '@/lib/vocabulary/index-state';
import { updateVocabularyIndexProgress } from '@/lib/vocabulary/index-progress';

export async function prepareVocabularyIndex(job: Job<unknown>, signal?: AbortSignal) {
  const payload = vocabularyIndexPayloadSchema.parse(job.data);
  if (payload.phase !== 'PREPARE') throw new Error('Invalid vocabulary preparation job.');
  const execution = durableJobProviderExecution(job, payload.userId, signal);
  try {
    const source = await sottoTransaction(prisma, async (database) => {
      await execution.authorize(database);
      const current = await validateVocabularyIndex(database, payload.indexId, payload.userId);
      if (current.index.generation !== payload.generation)
        throw new Error('Index preparation changed.');
      return current;
    });
    const ai = await resolveCapturedLearningAi(payload.userId, execution);
    const moderation = await captureLearningModerationCredential(execution);
    const selection = {
      provider: ai.provider,
      model: ai.model,
      ...(ai.endpoint ? { endpoint: ai.endpoint } : {}),
      ...(ai.isolatedImage ? { isolatedImage: ai.isolatedImage } : {}),
      credentialFingerprint: learningCredentialFingerprint(ai.execution.credential),
      moderationCredentialFingerprint: learningCredentialFingerprint(moderation),
    };
    await admitDurableQueueBatch({
      parentJob: job,
      prepare: async (database) => {
        await execution.authorize(database);
        const current = await validateVocabularyIndex(database, payload.indexId, payload.userId);
        if (current.index.generation !== payload.generation)
          throw new Error('Index preparation changed.');
        const input = await resolveStorageInput(database, {
          consumer: `material:${source.index.materialId}:original`,
          reference: source.index.material.originalUrl!,
        });
        await database.materialVocabularyIndex.update({
          where: { id: payload.indexId },
          data: { originalInput: input.input, status: 'ACTIVE', error: null },
        });
        const chunks = await database.vocabularyIndexChunk.findMany({
          where: {
            indexId: payload.indexId,
            status: { in: payload.retry ? ['PENDING', 'FAILED', 'UNRESOLVED'] : ['PENDING'] },
          },
        });
        const children = [];
        for (const chunk of chunks) {
          if (chunk.operation) {
            const previous = vocabularyIndexOperationSchema.parse(chunk.operation);
            const receipt = await sottoJobOutbox(database).read(previous.id);
            if (!receipt) throw new Error('The previous indexing receipt is missing.');
            await sottoJobExecutions(database).requireParentDrained(
              previous.id,
              receipt.fingerprint
            );
            if (
              (await vocabularyIndexGrant(database, previous).read(previous.grant)).attempts.some(
                (attempt) => ['admitted', 'unknown'].includes(attempt.outcome)
              )
            )
              throw new Error('An indexing provider outcome must settle before retrying.');
          }
          const generation = chunk.operation ? chunk.generation + 1 : chunk.generation;
          const jobId = `${chunk.id}-${generation}`;
          const id = durableQueueOperationId('vocabulary-index', jobId);
          const courseScope = current.ownership.scopes.find(
            (scope) => scope.subjectId === `course:${current.index.courseId}`
          )!;
          const profileScope = current.ownership.scopes.find(
            (scope) => scope.subjectId === `profile:${payload.userId}`
          )!;
          const spec = {
            id,
            revision: randomUUID(),
            instanceId: current.ownership.instanceId,
            subject: { id: profileScope.subjectId, generation: profileScope.generation },
            resource: { id: courseScope.subjectId, generation: courseScope.generation },
            operationId: id,
            action: 'vocabulary-parent-provider-request',
            expiresAt: Date.now() + 86_400_000,
            maxRequests: 32,
          };
          const operation = vocabularyIndexOperationSchema.parse({
            id,
            courseId: current.index.courseId,
            userId: payload.userId,
            instanceId: spec.instanceId,
            courseCreatedAt: courseScope.generation,
            userCreatedAt: profileScope.generation,
            expiresAt: spec.expiresAt,
            maxProviderRequests: spec.maxRequests,
            selection,
            grant: delegationGrantBinding(spec),
          });
          await vocabularyIndexGrant(database, operation).create(
            learningPreparationGrantSpec(operation, 'vocabulary')
          );
          await database.vocabularyIndexChunk.update({
            where: { id: chunk.id },
            data: { generation, operation, status: 'QUEUED', error: null },
          });
          children.push({
            queue: createQueue('vocabulary-index'),
            type: 'vocabulary-index',
            payload: { phase: 'CHUNK', userId: payload.userId, chunkId: chunk.id, generation },
            jobId,
            attempts: 1,
          });
        }
        await updateVocabularyIndexProgress(database, payload.indexId);
        return children;
      },
    });
  } catch (error) {
    await prisma.materialVocabularyIndex.updateMany({
      where: { id: payload.indexId, generation: payload.generation, status: { not: 'COMPLETE' } },
      data: {
        status: 'FAILED',
        error: error instanceof Error ? error.message : 'Vocabulary indexing could not start.',
      },
    });
    throw error;
  }
}
