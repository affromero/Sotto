import { readResponseBytes } from 'thesidedoor-core/runtime/stream';
import { MATERIAL_FOCUS_ANALYSIS_LIMITS } from '@sotto/shared';
import { prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { capturedLearningAiOptions } from '@/lib/learning-ai';
import { createAIProvider, type AIOptions } from '@/lib/providers/ai';
import { captureCodexMaterialBinding } from '@/lib/agent-usage/providers/codex';
import { learningPreparationProviderRequest } from '@/lib/learning/preparation/preparation-provider';
import {
  executeLearningCliOnce,
  replayLearningProviderResponse,
  learningHttpCompletion,
} from '@/lib/learning/preparation/provider-invocation';
import { restoreMaterialAnalysisAi } from './policy';
import {
  prepareMaterialFocusChunk,
  parseMaterialFocusChunk,
  type MaterialFocusAnalysisUnit,
  type PreparedMaterialFocusAnalysis,
} from './protocol';
import { MaterialAnalysisConflict, readMaterialAnalysisWindow } from './inventory';
import {
  requireMaterialAnalysis,
  createMaterialAnalysisUnit,
  readMaterialAnalysisResponse,
  publishMaterialAnalysisUnit,
  markMaterialAnalysisUnitInvalid,
  markMaterialAnalysisUnitUnknown,
  materialAnalysisHttpStore,
  materialAnalysisCliStore,
  type MaterialAnalysisAuthority,
} from './persistence';

export class MaterialAnalysisOutcomeUnknown extends Error {
  constructor() {
    super('A source-analysis provider request has an unknown outcome.');
    this.name = 'MaterialAnalysisOutcomeUnknown';
  }
}
const attemptSelection = (inputDigest: string) => ({
  purpose: 'material-source-focus',
  inputDigest,
});

/** The canonical transport receives one admitted HTTP attempt for this complete primary interval. */
export async function processMaterialAnalysisUnit(input: {
  context: MaterialAnalysisAuthority;
  analysis: PreparedMaterialFocusAnalysis;
  unit: MaterialFocusAnalysisUnit;
  signal: AbortSignal;
  unresolved: () => void;
}) {
  const { context, signal } = input;
  const prepared = await sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      const saved = await requireMaterialAnalysis(database, context);
      if (saved.row.status !== 'RUNNING')
        throw new MaterialAnalysisConflict('Source analysis stopped before the next chunk.');
      return prepareMaterialFocusChunk({
        analysis: input.analysis,
        unitId: input.unit.id,
        chunks: await readMaterialAnalysisWindow(database, saved.row, input.analysis, input.unit),
      });
    },
    { signal }
  );
  const operation = await sottoTransaction(
    prismaUnfiltered,
    (database) => createMaterialAnalysisUnit(database, context, prepared),
    { signal }
  );
  const owned = { ...context, unitId: operation.id };
  let saved = await sottoTransaction(
    prismaUnfiltered,
    (database) => readMaterialAnalysisResponse(database, owned),
    { signal }
  );
  if (['ANALYZED', 'FAILED', 'OUTPUT_INVALID'].includes(saved.unit.status)) return;
  if (['DISPATCHING', 'UNKNOWN'].includes(saved.unit.status)) {
    await sottoTransaction(prismaUnfiltered, (database) =>
      markMaterialAnalysisUnitUnknown(database, owned)
    );
    input.unresolved();
    throw new MaterialAnalysisOutcomeUnknown();
  }
  const options: AIOptions = {
    model: saved.policy.selection.model,
    maxTokens: prepared.maxOutputTokens,
    maxOutputBytes: MATERIAL_FOCUS_ANALYSIS_LIMITS.responseBytes,
    temperature: 0,
    skipModeration: true,
    useWebSearch: false,
    jsonSchema: prepared.jsonSchema,
    signal,
  };
  let dispatchError: unknown;
  if (saved.unit.status === 'READY') {
    const ai = await restoreMaterialAnalysisAi(saved.policy, { ...context.execution, signal });
    if (saved.policy.cliBinding) {
      const cli = materialAnalysisCliStore(owned, ai, async (database, expected) => {
        await context.execution.authorize(database);
        const binding = await captureCodexMaterialBinding(context.execution, {
          model: saved.policy.selection.model,
        });
        if (
          binding.fingerprint !== expected.fingerprint ||
          binding.selection.configurationSha256 !== expected.revision
        )
          throw new MaterialAnalysisConflict(
            'The admitted local model account or invocation policy changed.'
          );
      });
      try {
        await executeLearningCliOnce({
          ai,
          inputDigest: prepared.inputDigest,
          selection: saved.policy.selection,
          system: prepared.system,
          messages: prepared.messages,
          options,
          responseLimit: MATERIAL_FOCUS_ANALYSIS_LIMITS.responseBytes,
          binding: saved.policy.cliBinding,
          operation: cli,
          signal,
          unresolved: input.unresolved,
        });
      } catch (error) {
        dispatchError = error;
      }
    } else {
      let observed = false;
      const store = materialAnalysisHttpStore(owned, ai);
      const request = learningPreparationProviderRequest(
        {
          ...store,
          selection: attemptSelection(prepared.inputDigest),
          responseReceipt: { maxBytes: MATERIAL_FOCUS_ANALYSIS_LIMITS.responseBytes },
        },
        signal,
        input.unresolved
      );
      const captured = {
        ...ai,
        execution: {
          ...ai.execution,
          signal,
          providerRequest: async (resource: Request, dispatch: () => Promise<Response>) => {
            if (observed)
              throw new MaterialAnalysisConflict(
                'This source unit cannot dispatch another HTTP attempt.'
              );
            const bytes = await readResponseBytes(resource.clone(), {
              signal,
              maxBytes: MATERIAL_FOCUS_ANALYSIS_LIMITS.requestBytes,
            });
            const body: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
            if (!body || typeof body !== 'object')
              throw new MaterialAnalysisConflict(
                'The effective provider request has no output budget.'
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
                  value > prepared.maxOutputTokens
              )
            )
              throw new MaterialAnalysisConflict(
                'The effective provider output budget exceeds the declared analysis ceiling.'
              );
            observed = true;
            return request(resource, dispatch);
          },
        },
      };
      try {
        await createAIProvider(ai.provider).generateResponse(prepared.system, prepared.messages, {
          ...(await capturedLearningAiOptions(captured)),
          ...options,
        });
        if (!observed)
          throw new MaterialAnalysisConflict(
            'The analysis provider returned without a journaled request.'
          );
      } catch (error) {
        dispatchError = error;
      }
    }
    signal.throwIfAborted();
    saved = await sottoTransaction(
      prismaUnfiltered,
      (database) => readMaterialAnalysisResponse(database, owned),
      { signal }
    );
  }
  if (['DISPATCHING', 'UNKNOWN'].includes(saved.unit.status)) {
    await sottoTransaction(prismaUnfiltered, (database) =>
      markMaterialAnalysisUnitUnknown(database, owned)
    );
    input.unresolved();
    throw new MaterialAnalysisOutcomeUnknown();
  }
  if (saved.unit.status === 'FAILED') return;
  if (saved.unit.status !== 'SUCCEEDED' || !saved.receipt)
    throw (
      dispatchError ??
      new MaterialAnalysisConflict('The unit has no complete saved provider response.')
    );
  let result: ReturnType<typeof parseMaterialFocusChunk>;
  try {
    const response =
      saved.receipt.kind === 'HTTP'
        ? await replayLearningProviderResponse({
            provider: saved.policy.selection.provider,
            endpoint: saved.policy.selection.endpoint,
            system: prepared.system,
            messages: prepared.messages,
            options,
            selection: attemptSelection(prepared.inputDigest),
            attemptFingerprint: saved.unit.attemptFingerprint!,
            receipt: saved.receipt.value,
            signal,
          })
        : saved.receipt.value;
    const completion =
      saved.receipt.kind === 'HTTP' ? learningHttpCompletion(saved.receipt.value) : 'COMPLETE';
    result = parseMaterialFocusChunk(prepared, response.content, { completion });
  } catch {
    signal.throwIfAborted();
    await sottoTransaction(
      prismaUnfiltered,
      (database) => markMaterialAnalysisUnitInvalid(database, owned),
      { signal }
    );
    return;
  }
  await sottoTransaction(
    prismaUnfiltered,
    (database) => publishMaterialAnalysisUnit(database, owned, result),
    { signal }
  );
}
