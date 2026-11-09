import { expect, vi } from 'vitest';
import { validateAssessmentAudioLineage } from '@/lib/learning/classes/audio/assessment-audio-lineage';
import { stageAssessmentSection } from '@/lib/learning/classes/generation/assessment-draft';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { randomUUID } from 'node:crypto';
import { isSerializationConflict } from 'thesidedoor-core/storage/sql';
import type { SharedTestInstance } from '../../../../../helpers/setup/shared-instance';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';

interface AudioQueueContext {
  instance: SharedTestInstance;
  audioQueue: typeof import('@/lib/queue');
  operation: { id: string; fingerprint: string };
  execution: SottoProviderExecution;
  completionMode: string;
  truncated: {
    skill: string;
    passage: string;
    items: Array<{
      question: string;
      options: string[];
      correctIndex: number;
      explanation: string;
    }>;
  };
  finalizedReading: unknown;
  speakingDraft: {
    skill: string;
    items: Array<{
      task: string;
      mode: string;
      translation: string;
      rubric: string;
      guidance: string;
      criteria?: Array<{ id: string; description: string; modality: string }>;
    }>;
  };
  heldOut: { episodeId: string | null; episode: { script: { id: string } | null } | null };
  authoredQuestion: { id: string };
  assessment: string;
  queuedAudio: string[];
  generationKey: string;
  durableQueueOperationId: typeof import('@/lib/sidedoor/jobs/core/durable-queue').durableQueueOperationId;
}

export async function checkAssessmentAudioQueue({
  instance,
  audioQueue,
  operation,
  execution,
  completionMode,
  truncated,
  finalizedReading,
  speakingDraft,
  heldOut,
  authoredQuestion,
  assessment,
  queuedAudio,
  generationKey,
  durableQueueOperationId,
}: AudioQueueContext) {
  if (!heldOut.episodeId) throw new Error('Held-out episode missing');
  const { queueAssessmentAudio } =
    await import('@/lib/learning/classes/audio/assessment-audio-queue');
  if (completionMode === 'review_oversize') {
    await sottoTransaction(instance.database, async (tx) => {
      await stageAssessmentSection(tx, operation, execution, {
        ...truncated,
        items: truncated.items.map((item, index) => ({
          ...item,
          question: `${index}${'x'.repeat(2_100)}`,
        })),
      });
      await stageAssessmentSection(tx, operation, execution, {
        ...speakingDraft,
        items: speakingDraft.items.map((item, index) => ({
          ...item,
          task: `${index}${'t'.repeat(700)}`,
          translation: 'a'.repeat(700),
          rubric: 'b'.repeat(700),
          guidance: 'c'.repeat(700),
        })),
      });
      await stageAssessmentSection(tx, operation, execution, {
        skill: 'WRITING',
        items: Array.from({ length: 3 }, (_, index) => ({
          task: `${index}${'w'.repeat(1_000)}`,
          rubric: 'r'.repeat(1_000),
          guidance: 'g'.repeat(1_000),
        })),
      });
    });
    await expect(queueAssessmentAudio({ identity: operation, execution })).rejects.toThrow(
      /too large to review/
    );
    expect(await instance.database.segment.count({ where: { episodeId: heldOut.episodeId } })).toBe(
      0
    );
    return true;
  }
  await sottoTransaction(instance.database, async (tx) => {
    await stageAssessmentSection(
      tx,
      operation,
      execution,
      completionMode.startsWith('yield') ? truncated : finalizedReading
    );
    await stageAssessmentSection(tx, operation, execution, speakingDraft);
    await stageAssessmentSection(tx, operation, execution, {
      skill: 'WRITING',
      items: Array.from({ length: 3 }, (_, index) => ({
        task: `Independent writing ${index}`,
        rubric: 'Criteria',
        guidance: 'Guidance',
      })),
    });
  });
  const { requireAssessmentReviewCapacity } =
    await import('@/lib/learning/classes/review/assessment-review-capacity');
  await expect(
    sottoTransaction(instance.database, async (tx) => {
      const prompt = await tx.writingPrompt.findFirstOrThrow({
        where: { assessmentSection: { assessmentId: assessment } },
      });
      await tx.writingPrompt.update({
        where: { id: prompt.id },
        data: { ideas: ['Changed'] },
      });
      await expect(requireAssessmentReviewCapacity(tx, operation, execution)).rejects.toThrow();
      await tx.writingPrompt.update({ where: { id: prompt.id }, data: { ideas: [] } });
      await tx.classAssessmentQuestion.update({
        where: { id: authoredQuestion.id },
        data: { explanation: 'Changed after staging' },
      });
      await expect(requireAssessmentReviewCapacity(tx, operation, execution)).rejects.toThrow();
      throw new Error('Roll back changed review fields');
    })
  ).rejects.toThrow('Roll back changed review fields');
  await instance.database.episode.update({
    where: { id: heldOut.episodeId },
    data: { ttsModel: 'unexpected-existing-model' },
  });
  await expect(queueAssessmentAudio({ identity: operation, execution })).rejects.toThrow();
  expect(await instance.database.segment.count({ where: { episodeId: heldOut.episodeId } })).toBe(
    0
  );
  await instance.database.episode.update({
    where: { id: heldOut.episodeId },
    data: { ttsModel: null },
  });
  const actualQueue = audioQueue.createQueue('audio-generation');
  const add = actualQueue.add.bind(actualQueue);
  let releaseStale!: () => void;
  let staleReady!: () => void;
  const staleGate = new Promise<void>((resolve) => {
    releaseStale = resolve;
  });
  const staleStarted = new Promise<void>((resolve) => {
    staleReady = resolve;
  });
  const stale =
    completionMode === 'worker'
      ? instance.database
          .$transaction(
            async (tx) => {
              const prompt = await tx.writingPrompt.findFirstOrThrow({
                where: { assessmentSection: { assessmentId: assessment } },
              });
              staleReady();
              await staleGate;
              await tx.writingPrompt.update({
                where: { id: prompt.id },
                data: { task: 'Stale source change' },
              });
            },
            { isolationLevel: 'Serializable', timeout: 30000 }
          )
          .then(
            () => null,
            (error: unknown) => error
          )
      : null;
  if (stale) await staleStarted;
  const lostAcknowledgment = vi
    .spyOn(actualQueue, 'add')
    .mockImplementationOnce(async (...args) => {
      await add(...args);
      throw new Error('Lost delivery acknowledgment');
    });
  try {
    await expect(queueAssessmentAudio({ identity: operation, execution })).rejects.toThrow(
      'Lost delivery acknowledgment'
    );
  } finally {
    releaseStale();
    lostAcknowledgment.mockRestore();
    const segments = await instance.database.segment.findMany({
      where: { episodeId: heldOut.episodeId },
    });
    for (const segment of segments)
      queuedAudio.push(
        durableQueueOperationId(
          audioQueue.audioGenerationQueue.name,
          `audio-${heldOut.episodeId}-${segment.id}-v${segment.version}-${generationKey}`
        )
      );
  }
  if (stale) expect(isSerializationConflict(await stale)).toBe(true);
  const deliveries = await Promise.all([
    queueAssessmentAudio({ identity: operation, execution }),
    queueAssessmentAudio({ identity: operation, execution }),
  ]);
  expect(deliveries).toEqual([
    { episodeId: heldOut.episodeId, generationKey },
    { episodeId: heldOut.episodeId, generationKey },
  ]);
  const frozenWriting = await instance.database.writingPrompt.findFirstOrThrow({
    where: { assessmentSection: { assessmentId: assessment } },
  });
  await expect(
    instance.database.writingPrompt.update({
      where: { id: frozenWriting.id },
      data: { task: 'Changed after audio admission' },
    })
  ).rejects.toThrow(/frozen by admitted audio/);
  await expect(
    instance.database.writingPrompt.delete({ where: { id: frozenWriting.id } })
  ).rejects.toThrow(/frozen by admitted audio/);
  await expect(
    instance.database.classAssessmentQuestion.update({
      where: { id: authoredQuestion.id },
      data: { question: 'Changed after audio admission' },
    })
  ).rejects.toThrow(/frozen by admitted audio/);
  await expect(
    instance.database.classAssessment.update({
      where: { id: assessment },
      data: { formativeRevision: '0'.repeat(64) },
    })
  ).rejects.toThrow(/provenance is frozen/);
  await expect(
    instance.database.episode.update({
      where: { id: heldOut.episodeId },
      data: { audioGenerationKey: randomUUID() },
    })
  ).rejects.toThrow(/identity cannot change/);
  await expect(
    instance.database.episode.delete({ where: { id: heldOut.episodeId } })
  ).rejects.toThrow(/deleted with its assessment|frozen by admitted audio/);
  if (!heldOut.episode?.script) throw new Error('Assessment script missing');
  await expect(
    instance.database.script.update({
      where: { id: heldOut.episode.script.id },
      data: { turns: [{ speaker: 'HOST', text: 'Changed' }] },
    })
  ).rejects.toThrow(/frozen by admitted audio/);
  await expect(
    sottoTransaction(instance.database, async (tx) => {
      const writing = await tx.writingPrompt.findFirstOrThrow({
        where: { assessmentSection: { assessmentId: assessment } },
      });
      await expect(
        tx.writingPrompt.update({
          where: { id: writing.id },
          data: { task: 'Changed after audio admission' },
        })
      ).rejects.toThrow(/frozen by admitted audio/);
      throw new Error('Roll back changed staged task');
    })
  ).rejects.toThrow('Roll back changed staged task');
  await sottoTransaction(instance.database, (tx) =>
    validateAssessmentAudioLineage(tx, heldOut.episodeId!, generationKey)
  );
  return false;
}
