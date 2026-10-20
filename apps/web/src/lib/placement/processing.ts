import { z } from 'zod';
import type { Job } from 'bullmq';
import { readResponseBytes } from 'thesidedoor-core/runtime/stream';
import { prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { withSottoJobExecution } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import {
  loadDurableQueueJob,
  bindDurableQueueJob,
  completeDurableQueueJob,
  durableJobProviderExecution,
  bindDurableQueueCleanup,
  isDurableQueueCleanupFailure,
} from '@/lib/sidedoor/jobs/core/durable-queue';
import { capturedLearningAiOptions } from '@/lib/learning-ai';
import { createAIProvider, type AIOptions } from '@/lib/providers/ai';
import { captureCodexMaterialBinding } from '@/lib/agent-usage/providers/codex';
import { learningPreparationProviderRequest } from '@/lib/learning/preparation/preparation-provider';
import {
  executeLearningCliOnce,
  replayLearningProviderResponse,
  learningHttpCompletion,
} from '@/lib/learning/preparation/provider-invocation';
import { restoreMaterialAnalysisAi } from '@/lib/course-materials/analysis/policy';
import {
  MaterialAnalysisConflict,
  materialAnalysisBytesHash,
} from '@/lib/course-materials/analysis/inventory';
import { parsePlacementQuestionBatch } from '@/lib/placement-test';
import {
  requirePlacementSession,
  readPlacementResponse,
  placementHttpStore,
  placementCliStore,
  type PlacementAuthority,
} from './journal';

const payloadSchema = z
  .object({ userId: z.string().min(1), placementSessionId: z.uuid() })
  .strict();
const selection = (inputDigest: string) => ({ purpose: 'placement-quiz', inputDigest });
class PlacementOutcomeUnknown extends Error {}
const messageSchema = z
  .array(z.object({ role: z.literal('user'), content: z.string() }).strict())
  .length(1);
const jsonSchemaSchema = z
  .object({ name: z.string().min(1), schema: z.record(z.string(), z.unknown()) })
  .strict();

async function markUnknown(context: PlacementAuthority) {
  await sottoTransaction(prismaUnfiltered, async (database) => {
    const saved = await requirePlacementSession(database, context);
    if (['GENERATING', 'DISPATCHING', 'RECOVERY_REQUIRED'].includes(saved.row.status))
      await database.placementSession.update({
        where: { id: saved.row.id },
        data: {
          status: 'RECOVERY_REQUIRED',
          failureReason:
            'The quiz invocation outcome is unknown. Explicit recovery is required before equivalent generation.',
          settledAt: new Date(),
        },
      });
  });
}

/** One saved response is replayed through the canonical provider without a live credential. */
async function executeSession(
  context: PlacementAuthority,
  signal: AbortSignal,
  unresolved: () => void
) {
  let saved = await sottoTransaction(
    prismaUnfiltered,
    (database) => readPlacementResponse(database, context),
    { signal }
  );
  if (['READY', 'ACCEPTED', 'FAILED', 'OUTPUT_INVALID'].includes(saved.row.status)) return;
  if (['GENERATING', 'DISPATCHING', 'RECOVERY_REQUIRED'].includes(saved.row.status)) {
    await markUnknown(context);
    unresolved();
    throw new PlacementOutcomeUnknown('The prior quiz generation has an unknown outcome.');
  }
  const messages = messageSchema.parse(JSON.parse(saved.input.messagesJson));
  const jsonSchema = jsonSchemaSchema.parse(JSON.parse(saved.input.jsonSchemaJson));
  const options: AIOptions = {
    model: saved.policy.selection.model,
    maxTokens: saved.input.maxOutputTokens,
    maxOutputBytes: 512 * 1024,
    temperature: 0,
    skipModeration: true,
    useWebSearch: false,
    jsonSchema,
    signal,
  };
  let dispatchError: unknown;
  if (saved.row.status === 'QUEUED') {
    await sottoTransaction(
      prismaUnfiltered,
      async (database) => {
        const current = await requirePlacementSession(database, context);
        if (current.row.status !== 'QUEUED')
          throw new MaterialAnalysisConflict('The quiz generation state changed.');
        if (current.row.expiresAt.getTime() <= Date.now())
          throw new MaterialAnalysisConflict('The placement session expired.');
        await database.placementSession.update({
          where: { id: current.row.id },
          data: { status: 'GENERATING' },
        });
      },
      { signal }
    );
    try {
      const ai = await restoreMaterialAnalysisAi(saved.policy, { ...context.execution, signal });
      if (saved.policy.cliBinding) {
        const operation = placementCliStore(context, ai, async (database, expected) => {
          await context.execution.authorize(database);
          const binding = await captureCodexMaterialBinding(context.execution, {
            model: saved.policy.selection.model,
          });
          if (
            binding.fingerprint !== expected.fingerprint ||
            binding.selection.configurationSha256 !== expected.revision
          )
            throw new MaterialAnalysisConflict(
              'The captured placement CLI account or configuration changed.'
            );
        });
        await executeLearningCliOnce({
          ai,
          inputDigest: saved.row.inputDigest,
          selection: saved.policy.selection,
          system: saved.input.system,
          messages,
          options,
          responseLimit: 512 * 1024,
          binding: saved.policy.cliBinding,
          operation,
          signal,
          unresolved,
        });
      } else {
        let observed = false;
        const operation = placementHttpStore(context, ai);
        const request = learningPreparationProviderRequest(
          {
            ...operation,
            selection: selection(saved.row.inputDigest),
            responseReceipt: { maxBytes: 512 * 1024 },
          },
          signal,
          unresolved
        );
        const captured = {
          ...ai,
          execution: {
            ...ai.execution,
            signal,
            providerRequest: async (resource: Request, dispatch: () => Promise<Response>) => {
              if (observed)
                throw new MaterialAnalysisConflict('A placement session permits one HTTP attempt.');
              const bytes = await readResponseBytes(resource.clone(), {
                signal,
                maxBytes: 512 * 1024,
              });
              const body: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
              if (!body || typeof body !== 'object')
                throw new MaterialAnalysisConflict(
                  'The placement provider request has no explicit budget.'
                );
              const budgets = ['max_tokens', 'max_completion_tokens', 'max_output_tokens']
                .filter((key) => key in body)
                .map((key) => Reflect.get(body, key));
              if (
                !budgets.length ||
                budgets.some(
                  (value) =>
                    typeof value !== 'number' ||
                    !Number.isSafeInteger(value) ||
                    value < 1 ||
                    value > saved.input.maxOutputTokens
                )
              )
                throw new MaterialAnalysisConflict(
                  'The effective placement output budget exceeds its captured ceiling.'
                );
              observed = true;
              return request(resource, dispatch);
            },
          },
        };
        await createAIProvider(ai.provider).generateResponse(saved.input.system, messages, {
          ...(await capturedLearningAiOptions(captured)),
          ...options,
        });
        if (!observed)
          throw new MaterialAnalysisConflict(
            'The placement provider returned without a journaled request.'
          );
      }
    } catch (error) {
      dispatchError = error;
    }
    signal.throwIfAborted();
    saved = await sottoTransaction(
      prismaUnfiltered,
      (database) => readPlacementResponse(database, context),
      { signal }
    );
  }
  if (['DISPATCHING', 'RECOVERY_REQUIRED'].includes(saved.row.status)) {
    await markUnknown(context);
    unresolved();
    throw new PlacementOutcomeUnknown('The quiz invocation has an unknown outcome.');
  }
  if (saved.row.status === 'FAILED') return;
  if (saved.row.status === 'GENERATING') {
    await sottoTransaction(
      prismaUnfiltered,
      async (database) => {
        const current = await requirePlacementSession(database, context);
        if (current.row.status === 'GENERATING' && !current.row.attemptId)
          await database.placementSession.update({
            where: { id: current.row.id },
            data: {
              status: 'FAILED',
              failureReason: 'Placement provider preparation failed before dispatch.',
            },
          });
      },
      { signal }
    );
    if (dispatchError) throw dispatchError;
    return;
  }
  if (saved.row.status !== 'SUCCEEDED' || !saved.receipt)
    throw (
      dispatchError ?? new MaterialAnalysisConflict('The quiz has no retained complete response.')
    );
  let questions;
  try {
    const response =
      saved.receipt.kind === 'HTTP'
        ? await replayLearningProviderResponse({
            provider: saved.policy.selection.provider,
            endpoint: saved.policy.selection.endpoint,
            system: saved.input.system,
            messages,
            options,
            selection: selection(saved.row.inputDigest),
            attemptFingerprint: saved.row.attemptFingerprint!,
            receipt: saved.receipt.value,
            signal,
          })
        : saved.receipt.value;
    if (saved.receipt.kind === 'HTTP' && learningHttpCompletion(saved.receipt.value) !== 'COMPLETE')
      throw new Error('Truncated or unknown completion cannot publish a quiz.');
    questions = parsePlacementQuestionBatch(
      response.content,
      saved.row.nativeLang,
      saved.input.perBand
    );
  } catch {
    signal.throwIfAborted();
    await sottoTransaction(
      prismaUnfiltered,
      async (database) => {
        const current = await requirePlacementSession(database, context);
        if (current.row.status === 'SUCCEEDED')
          await database.placementSession.update({
            where: { id: current.row.id },
            data: {
              status: 'OUTPUT_INVALID',
              failureReason:
                'The retained provider response did not contain a complete valid placement quiz.',
            },
          });
      },
      { signal }
    );
    return;
  }
  const bytes = Buffer.from(JSON.stringify(questions), 'utf8');
  await sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      const current = await requirePlacementSession(database, context);
      if (current.row.status !== 'SUCCEEDED' || !current.row.responseBytes)
        throw new MaterialAnalysisConflict('The quiz response changed before publication.');
      await database.placementSession.update({
        where: { id: current.row.id },
        data: {
          status: 'READY',
          questionsBytes: Uint8Array.from(bytes),
          questionsDigest: materialAnalysisBytesHash(bytes),
          failureReason: null,
        },
      });
    },
    { signal }
  );
}

export async function processPlacementGeneration(job: Job<unknown>, workerSignal?: AbortSignal) {
  const signal = workerSignal
    ? AbortSignal.any([workerSignal, AbortSignal.timeout(1800000)])
    : AbortSignal.timeout(1800000);
  const work = await sottoTransaction(
    prismaUnfiltered,
    (database) => loadDurableQueueJob(database, job, 'placement-generation', 1),
    { signal }
  );
  if (work.complete) return;
  const payload = payloadSchema.parse(work.payload.payload),
    bound = bindDurableQueueJob(job, payload, work);
  const execution = durableJobProviderExecution(bound, payload.userId, signal),
    context = { ...payload, execution };
  let unknown = false,
    ran = false;
  try {
    await withSottoJobExecution({
      database: prismaUnfiltered,
      parentId: work.operationId,
      fingerprint: work.fingerprint,
      signal,
      isCleanupFailure: (error) =>
        unknown || error instanceof PlacementOutcomeUnknown || isDurableQueueCleanupFailure(error),
      validate: async (database) => {
        const current = await loadDurableQueueJob(database, job, 'placement-generation', 1);
        if (current.complete) return false;
        await requirePlacementSession(database, context);
        return true;
      },
      run: async ({ markCleanupUnconfirmed }) => {
        ran = true;
        bindDurableQueueCleanup(bound, markCleanupUnconfirmed);
        await executeSession(context, signal, () => {
          unknown = true;
          markCleanupUnconfirmed();
        });
        await sottoTransaction(
          prismaUnfiltered,
          (database) => completeDurableQueueJob(database, bound),
          { signal }
        );
      },
    });
    if (!ran) {
      const current = await sottoTransaction(
        prismaUnfiltered,
        (database) => loadDurableQueueJob(database, job, 'placement-generation', 1),
        { signal }
      );
      if (!current.complete)
        throw new MaterialAnalysisConflict('The placement job stopped before completion.');
    }
  } catch (cause) {
    if (unknown) throw cause;
    try {
      await sottoTransaction(prismaUnfiltered, async (database) => {
        const current = await requirePlacementSession(database, context);
        if (['DISPATCHING', 'RECOVERY_REQUIRED'].includes(current.row.status)) {
          unknown = true;
          await database.placementSession.update({
            where: { id: current.row.id },
            data: {
              status: 'RECOVERY_REQUIRED',
              failureReason:
                'The quiz invocation outcome is unknown. Explicit recovery is required.',
            },
          });
        } else if (['QUEUED', 'GENERATING'].includes(current.row.status))
          await database.placementSession.update({
            where: { id: current.row.id },
            data: {
              status: 'FAILED',
              failureReason: signal.aborted
                ? 'Quiz preparation was cancelled.'
                : 'Quiz preparation failed before a complete response was published.',
            },
          });
      });
    } catch (settlement) {
      throw new AggregateError([cause, settlement], 'Placement failure could not be settled.');
    }
    throw cause;
  }
}
