import type { Job } from 'bullmq';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { createQueue } from '@/lib/queue';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  admitDurableQueueBatch,
  durableJobProviderExecution,
  isDurableQueueCleanupFailure,
} from '@/lib/sidedoor/jobs/core/durable-queue';
import { learningPreparationProviderRequest } from '@/lib/learning/preparation/preparation-provider';
import { extractSourceVocabularyInventory } from '@/lib/learning/reading-vocabulary';
import {
  SourceInventorySaturated,
  SourceInventoryIncomplete,
} from '@/lib/learning/reading/source-inventory';
import {
  validateVocabularyChunk,
  vocabularyIndexGrant,
  vocabularyIndexPayloadSchema,
} from '@/lib/vocabulary/index-state';
import { splitVocabularyChunk, vocabularyChunkContext } from '@/lib/vocabulary/index-chunks';
import { updateVocabularyIndexProgress } from '@/lib/vocabulary/index-progress';
import {
  canonicalVocabularyContext,
  canonicalVocabularyWordOffsets,
  splitCanonicalVocabularyChunk,
} from '@/lib/vocabulary/source/ranges';
import { requireVocabularyTextMetadata } from '@/lib/vocabulary/source/publication';

/** Each reviewed chunk publishes once. Interrupted model calls never resume by replaying generation. */
export async function processVocabularyIndexChunk(job: Job<unknown>, workerSignal?: AbortSignal) {
  const payload = vocabularyIndexPayloadSchema.parse(job.data);
  if (payload.phase !== 'CHUNK') throw new Error('Invalid vocabulary chunk job.');
  const controller = new AbortController();
  const signal = workerSignal
    ? AbortSignal.any([workerSignal, controller.signal])
    : controller.signal;
  const base = durableJobProviderExecution(job, payload.userId, signal);
  let unknown = false;
  const admitted = await sottoTransaction(prisma, async (database) => {
    await base.authorize(database);
    await database.$queryRaw`SELECT id FROM "VocabularyIndexChunk" WHERE id = ${payload.chunkId} FOR UPDATE`;
    const current = await validateVocabularyChunk(
      database,
      payload.chunkId,
      payload.generation,
      payload.userId
    );
    if (['COMPLETE', 'SPLIT'].includes(current.chunk.status)) return null;
    if (current.chunk.status !== 'QUEUED')
      throw new Error('Interrupted indexing needs reconciliation before recovery.');
    await vocabularyIndexGrant(database, current.operation).validate(current.operation.grant);
    await database.vocabularyIndexChunk.update({
      where: { id: payload.chunkId },
      data: { status: 'RUNNING' },
    });
    return current;
  });
  if (!admitted) return;
  const validate = async (database: Parameters<typeof base.authorize>[0]) => {
    const current = await validateVocabularyChunk(
      database,
      payload.chunkId,
      payload.generation,
      payload.userId
    );
    if (current.chunk.status !== 'RUNNING')
      throw new Error('Vocabulary indexing is no longer running.');
    await vocabularyIndexGrant(database, current.operation).validate(current.operation.grant);
    return current;
  };
  const markUnknown = () => {
    unknown = true;
    base.onCleanupError?.(new Error('Indexing provider outcome is unresolved.'));
    controller.abort();
  };
  const execution = {
    ...base,
    learningSelection: admitted.operation.selection,
    authorize: async (database: Parameters<typeof base.authorize>[0]) => {
      signal.throwIfAborted();
      await base.authorize(database);
      await validate(database);
      return { userId: payload.userId };
    },
    onCleanupError: () => markUnknown(),
    providerRequest: learningPreparationProviderRequest(
      {
        selection: admitted.operation.selection,
        admit: async (database, attempt) => {
          const current = await validate(database);
          return vocabularyIndexGrant(database, current.operation).admit(
            current.operation.grant,
            attempt
          );
        },
        settle: async (database, attempt, outcome) => {
          return vocabularyIndexGrant(database, admitted.operation).settle(
            admitted.operation.grant,
            attempt,
            outcome
          );
        },
      },
      signal,
      markUnknown
    ),
  };
  let checking = false;
  const heartbeat = setInterval(() => {
    if (checking || signal.aborted) return;
    checking = true;
    void sottoTransaction(prisma, async (database) => {
      await validate(database);
      await database.vocabularyIndexChunk.update({
        where: { id: payload.chunkId },
        data: { updatedAt: new Date() },
      });
    })
      .catch((error: unknown) => controller.abort(error))
      .finally(() => {
        checking = false;
      });
  }, 5000);
  try {
    const canonicalContext = admitted.sourceSnapshot
      ? await sottoTransaction(prisma, (database) =>
          canonicalVocabularyContext(
            database,
            admitted.sourceSnapshot!,
            admitted.chunk.startOffset,
            admitted.chunk.endOffset,
            admitted.index.targetLang
          )
        )
      : null;
    const context =
      canonicalContext ??
      vocabularyChunkContext(
        admitted.index.material.extractedText,
        admitted.chunk.startOffset,
        admitted.chunk.endOffset,
        admitted.index.targetLang
      );
    const words =
      canonicalContext?.hasWords === false
        ? []
        : await extractSourceVocabularyInventory({
            userId: payload.userId,
            execution,
            nativeLang: admitted.index.nativeLang,
            targetLang: admitted.index.targetLang,
            level: 'all source vocabulary levels, without CEFR filtering',
            text: context.text,
            requiredSpan: {
              start:
                canonicalContext?.coreStart ??
                Math.max(0, admitted.chunk.startOffset - context.startOffset),
              end:
                canonicalContext?.coreEnd ??
                Math.min(context.text.length, admitted.chunk.endOffset - context.startOffset),
            },
          });
    await sottoTransaction(prisma, async (database) => {
      await database.$queryRaw`SELECT id FROM "Course" WHERE id = ${admitted.index.courseId} FOR UPDATE`;
      const current = await validate(database);
      for (const word of words) {
        requireVocabularyTextMetadata(word);
        const { startOffset, endOffset } = current.sourceSnapshot
          ? canonicalVocabularyWordOffsets(context, word.sourceStart, word.sourceEnd)
          : {
              startOffset: context.startOffset + word.sourceStart,
              endOffset: context.startOffset + word.sourceEnd,
            };
        if (startOffset < current.chunk.startOffset || startOffset >= current.chunk.endOffset)
          continue;
        if (
          endOffset > context.endOffset ||
          (current.sourceSnapshot
            ? context.text.slice(word.sourceStart, word.sourceEnd)
            : current.index.material.extractedText.slice(startOffset, endOffset)) !==
            word.sourceForm
        )
          throw new Error('Indexed vocabulary no longer matches the exact source bytes.');
        await database.learnerVocab.createMany({
          data: {
            courseId: current.index.courseId,
            lemma: word.lemma,
            translation: word.gloss,
            partOfSpeech: word.pos,
          },
          skipDuplicates: true,
        });
        const stored = await database.learnerVocab.findUniqueOrThrow({
          where: { courseId_lemma: { courseId: current.index.courseId, lemma: word.lemma } },
        });
        await database.vocabularySourceOccurrence.createMany({
          data: {
            wordId: stored.id,
            courseId: current.index.courseId,
            materialId: current.index.materialId,
            chunkId: current.chunk.id,
            startOffset,
            endOffset,
            quote: current.sourceSnapshot ? null : word.sourceForm,
            ...(current.sourceSnapshot ? { quoteBytes: Buffer.from(word.sourceForm, 'utf8') } : {}),
            meaning: word.gloss,
          },
          skipDuplicates: true,
        });
      }
      await vocabularyIndexGrant(database, current.operation).complete(current.operation.grant);
      await database.vocabularyIndexChunk.update({
        where: { id: payload.chunkId },
        data: {
          status: 'COMPLETE',
          ...(current.sourceSnapshot
            ? { resultBytes: Buffer.from(JSON.stringify(words), 'utf8') }
            : { result: words }),
          error: null,
        },
      });
      await updateVocabularyIndexProgress(database, current.index.id);
    });
    await job.updateProgress(100);
  } catch (error) {
    let failure = error;
    if (
      (error instanceof SourceInventorySaturated || error instanceof SourceInventoryIncomplete) &&
      !unknown &&
      !signal.aborted
    ) {
      try {
        await admitDurableQueueBatch({
          parentJob: job,
          prepare: async (database) => {
            const current = await validate(database);
            const ranges = current.sourceSnapshot
              ? splitCanonicalVocabularyChunk(
                  await canonicalVocabularyContext(
                    database,
                    current.sourceSnapshot,
                    current.chunk.startOffset,
                    current.chunk.endOffset,
                    current.index.targetLang
                  ),
                  current.chunk.startOffset,
                  current.chunk.endOffset,
                  current.index.targetLang
                )
              : splitVocabularyChunk(
                  current.index.material.extractedText,
                  current.chunk.startOffset,
                  current.chunk.endOffset,
                  current.index.targetLang
                );
            await vocabularyIndexGrant(database, current.operation).complete(
              current.operation.grant
            );
            await database.vocabularyIndexChunk.update({
              where: { id: payload.chunkId },
              data: { status: 'SPLIT' },
            });
            await database.vocabularyIndexChunk.createMany({
              data: ranges.map((range) => ({ indexId: current.index.id, ...range })),
              skipDuplicates: true,
            });
            return [
              {
                queue: createQueue('vocabulary-index'),
                type: 'vocabulary-index',
                payload: {
                  phase: 'PREPARE',
                  userId: payload.userId,
                  indexId: current.index.id,
                  generation: current.index.generation,
                  retry: false,
                },
                jobId: `split-${current.chunk.id}-${current.chunk.generation}`,
                attempts: 1,
              },
            ];
          },
        });
        return;
      } catch (splitFailure) {
        failure = splitFailure;
      }
    }
    const uncertain = unknown || signal.aborted || isDurableQueueCleanupFailure(failure);
    if (uncertain) base.onCleanupError?.(failure);
    await sottoTransaction(prisma, async (database) => {
      const current = await database.vocabularyIndexChunk.findUnique({
        where: { id: payload.chunkId },
      });
      if (
        !current ||
        current.generation !== payload.generation ||
        ['COMPLETE', 'SPLIT'].includes(current.status)
      )
        return;
      await vocabularyIndexGrant(database, admitted.operation).revoke(admitted.operation.grant);
      await database.vocabularyIndexChunk.update({
        where: { id: payload.chunkId },
        data: {
          status: uncertain ? 'UNRESOLVED' : 'FAILED',
          error: uncertain
            ? 'Provider outcome or execution cleanup is unresolved.'
            : 'Source coverage or lexical metadata could not be verified.',
        },
      });
      await updateVocabularyIndexProgress(database, current.indexId);
    });
    throw failure;
  } finally {
    clearInterval(heartbeat);
    controller.abort();
  }
}
