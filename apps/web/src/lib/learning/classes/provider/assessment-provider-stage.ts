import type { Prisma } from '@/generated/prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { capturedLearningAiOptions, resolveCapturedLearningAi } from '@/lib/learning-ai';
import { createAIProvider } from '@/lib/providers/ai';
import { captureCodexMaterialBinding } from '@/lib/agent-usage/providers/codex';
import { moderateOrThrow } from '@/lib/moderation';
import { learningProviderInputHash } from '@/lib/learning/preparation/identity';
import { executeLearningCliOnce } from '@/lib/learning/preparation/provider-invocation';
import { assessmentProviderRequest } from './assessment-provider-request';
import {
  admitAssessmentProviderCall,
  prepareAssessmentProviderCall,
  readAssessmentProviderCall,
  requireCompleteAssessmentProviderStage,
  assessmentCallInventoryDigest,
} from './assessment-provider-journal';
import { readAssessmentCliCall, settleAssessmentCliCall } from './assessment-cli-journal';
import { AssessmentFenceConflict, type AssessmentFence } from '../lifecycle/assessment-fence';
import { requirePendingAssessmentWork } from '../generation/assessment-work';

/** Journal one exact author or review request and expose proof for its final transaction. */
export async function invokeAssessmentProviderStage(input: {
  identity: { id: string; fingerprint: string };
  execution: SottoProviderExecution;
  current: AssessmentFence;
  stage: Parameters<typeof prepareAssessmentProviderCall>[1]['stage'];
  sourceDigest: string;
  request: { system: string; payload: string; schema: Record<string, unknown>; schemaName: string };
  unresolved: () => void;
  replayOnly?: boolean;
}) {
  const identity = { ...input.identity };
  const execution = { ...input.execution };
  const current = structuredClone(input.current);
  const requestInput = structuredClone(input.request);
  const signal = execution.signal ?? new AbortController().signal;
  const pending = await sottoTransaction(
    prisma,
    (database) => requirePendingAssessmentWork(database, identity, execution, 'RUNNING'),
    { signal }
  );
  if (!isDeepStrictEqual(pending.current, current)) throw new AssessmentFenceConflict();
  if (current.selection.provider === 'claude-code')
    throw new Error(
      'Assessment generation requires a durable CLI invocation before this provider can be used.'
    );
  const inputDigest = learningProviderInputHash({
    version: 2,
    stage: input.stage,
    sourceDigest: input.sourceDigest,
    selection: current.selection,
    cliBinding: current.cliBinding,
    request: requestInput,
    maxTokens: 4000,
    temperature: 0.3,
  });
  const request = assessmentProviderRequest({
    identity,
    execution,
    stage: input.stage,
    inputDigest,
    selection: current.selection,
    signal,
    unresolved: input.unresolved,
    replayOnly: input.replayOnly,
    ...(current.cliBinding ? { startOrdinal: 1 } : {}),
  });
  const authorize: SottoProviderExecution['authorize'] = async (database) => {
    const pending = await requirePendingAssessmentWork(database, identity, execution, 'RUNNING');
    return { userId: pending.current.userId };
  };
  const ai = await resolveCapturedLearningAi(current.userId, {
    ...execution,
    signal,
    authorize,
    learningSelection: current.selection,
    providerRequest: request,
  });
  const capturedOptions = await capturedLearningAiOptions(ai);
  const offlineFetch: typeof fetch = (resource, init) =>
    request(new Request(resource, init), async () => {
      throw new AssessmentFenceConflict();
    });
  const options = input.replayOnly
    ? {
        ...capturedOptions,
        fetch: offlineFetch,
        moderation: capturedOptions.moderation
          ? { ...capturedOptions.moderation, fetch: offlineFetch }
          : undefined,
      }
    : capturedOptions;
  let content: string;
  let cliInventory: string | undefined;
  if (current.cliBinding) {
    const binding = current.cliBinding;
    const context = {
      identity,
      execution,
      stage: input.stage,
      inputDigest,
      ordinal: 0,
      role: 'CLI' as const,
      moderationInput: requestInput.payload,
    };
    const saved = await sottoTransaction(
      prisma,
      async (database) => {
        if (!input.replayOnly) await prepareAssessmentProviderCall(database, context);
        return readAssessmentProviderCall(database, context);
      },
      { signal }
    );
    if (!saved) throw new AssessmentFenceConflict();
    if (saved.status === 'SUCCEEDED') {
      const retained = await sottoTransaction(
        prisma,
        async (database) => {
          const response = await readAssessmentCliCall(database, context);
          const rows = await database.classAssessmentProviderCall.findMany({
            where: { assessmentId: current.assessmentId, stage: input.stage },
            orderBy: { ordinal: 'asc' },
          });
          return { response, inventory: assessmentCallInventoryDigest(rows) };
        },
        { signal }
      );
      content = retained.response.content;
      cliInventory = retained.inventory;
    } else {
      if (input.replayOnly) throw new AssessmentFenceConflict();
      if (saved.status !== 'READY') {
        input.unresolved();
        throw new AssessmentFenceConflict();
      }
      const moderation = options.moderation
        ? { ...options.moderation, bypassCache: true }
        : undefined;
      const response = await executeLearningCliOnce({
        ai,
        inputDigest,
        selection: current.selection,
        system: requestInput.system,
        messages: [{ role: 'user', content: requestInput.payload }],
        options: {
          ...options,
          moderation,
          maxTokens: 4000,
          temperature: 0.3,
          jsonSchema: { name: requestInput.schemaName, schema: requestInput.schema },
        },
        responseLimit: 512 * 1024,
        binding,
        signal,
        unresolved: input.unresolved,
        beforeDispatch: () => moderateOrThrow(requestInput.payload, moderation, signal),
        validateResponse: (result) => moderateOrThrow(result.content, moderation, signal),
        operation: {
          admit: (database, attempt) => admitAssessmentProviderCall(database, context, attempt),
          settle: (database, attempt, outcome, receipt) =>
            settleAssessmentCliCall(database, context, attempt, outcome, receipt),
          validateBinding: async (database, expected) => {
            await execution.authorize(database);
            const captured = await captureCodexMaterialBinding(execution, {
              model: current.selection.model,
            });
            if (
              captured.fingerprint !== expected.fingerprint ||
              captured.selection.configurationSha256 !== expected.revision
            )
              throw new AssessmentFenceConflict();
          },
        },
      });
      content = response.content;
    }
  } else {
    const response = await createAIProvider(ai.provider).generateResponse(
      requestInput.system,
      [{ role: 'user', content: requestInput.payload }],
      {
        ...options,
        moderation: options.moderation ? { ...options.moderation, bypassCache: true } : undefined,
        maxTokens: 4000,
        temperature: 0.3,
        jsonSchema: { name: requestInput.schemaName, schema: requestInput.schema },
      }
    );
    content = response.content;
  }
  const capturedContent = content;
  return {
    content,
    inputDigest,
    verify: async (database: Prisma.TransactionClient) => {
      if (current.cliBinding) {
        const retained = await readAssessmentCliCall(database, {
          identity,
          execution,
          stage: input.stage,
          inputDigest,
          ordinal: 0,
          role: 'CLI',
          moderationInput: requestInput.payload,
        });
        if (retained.content !== capturedContent) throw new AssessmentFenceConflict();
        if (input.replayOnly) {
          const rows = await database.classAssessmentProviderCall.findMany({
            where: { assessmentId: current.assessmentId, stage: input.stage },
            orderBy: { ordinal: 'asc' },
          });
          if (!cliInventory || assessmentCallInventoryDigest(rows) !== cliInventory)
            throw new AssessmentFenceConflict();
        }
      } else {
        await requireCompleteAssessmentProviderStage(
          database,
          { identity, execution, stage: input.stage, inputDigest },
          request.consumedCalls()
        );
        if (input.replayOnly) await request.verifyConsumed(database);
      }
    },
  };
}
