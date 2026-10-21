import { randomUUID } from 'node:crypto';
import { learningProviderInputHash } from './identity';
import type { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { captureSottoProviderAdmission } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { capturedLearningAiOptions, type CapturedLearningAi } from '@/lib/learning-ai';
import {
  createAIProvider,
  type AIResponse,
  type ChatMessage,
  type AIOptions,
} from '@/lib/providers/ai';
import { getCodexSshHost } from '@/lib/agent-availability';
import {
  learningPreparationRequestFingerprint,
  restoreLearningPreparationResponse,
  type LearningPreparationResponseReceipt,
} from './preparation-provider';

export interface LearningCliBinding {
  kind: 'LOCAL_ACCOUNT';
  fingerprint: string;
  revision: string;
}
export interface LearningCliReceipt {
  inputDigest: string;
  attempt: { id: string; fingerprint: string };
  binding: LearningCliBinding;
  response: AIResponse;
}
export interface LearningCliOperation {
  admit: (
    database: Prisma.TransactionClient,
    attempt: LearningCliReceipt['attempt']
  ) => Promise<{ dispatch: boolean }>;
  settle: (
    database: Prisma.TransactionClient,
    attempt: LearningCliReceipt['attempt'],
    outcome: 'succeeded' | 'failed' | 'unknown',
    receipt?: LearningCliReceipt
  ) => Promise<unknown>;
  validateBinding: (
    database: Prisma.TransactionClient,
    expected: LearningCliBinding
  ) => Promise<void>;
}
export class LearningProviderInvocationError extends Error {
  constructor(
    readonly outcome: 'NOT_DISPATCHED' | 'UNKNOWN',
    readonly inputDigest: string,
    options: ErrorOptions
  ) {
    super(`Provider invocation ${outcome.toLowerCase().replaceAll('_', ' ')}.`, options);
    this.name = 'LearningProviderInvocationError';
  }
}

/** One canonical local invocation. Settlement and response persistence precede semantic parsing. */
export async function executeLearningCliOnce(input: {
  ai: CapturedLearningAi;
  inputDigest: string;
  selection: unknown;
  system: string;
  messages: ChatMessage[];
  options: AIOptions;
  responseLimit: number;
  binding: LearningCliBinding;
  operation: LearningCliOperation;
  signal: AbortSignal;
  unresolved: () => void;
}): Promise<AIResponse> {
  const binding = structuredClone(input.binding);
  if (
    input.ai.provider !== 'codex' ||
    getCodexSshHost() ||
    input.ai.isolatedImage ||
    input.ai.model === 'codex' ||
    binding.kind !== 'LOCAL_ACCOUNT' ||
    !/^[a-f0-9]{64}$/.test(binding.fingerprint) ||
    !binding.revision
  )
    throw new Error('A concrete local Codex model and persistent account binding are required.');
  if (
    !Number.isSafeInteger(input.responseLimit) ||
    input.responseLimit < 1 ||
    input.responseLimit > 16 * 1024 * 1024
  )
    throw new Error('Invalid invocation response limit.');
  const attempt = {
    id: randomUUID(),
    fingerprint: learningProviderInputHash({
      inputDigest: input.inputDigest,
      selection: input.selection,
      binding,
    }),
  };
  const admission = await captureSottoProviderAdmission({
    ...input.ai.execution,
    signal: input.signal,
  });
  await admission.validate(input.signal);
  const admitted = await sottoTransaction(
    prisma,
    async (database) => {
      await input.operation.validateBinding(database, binding);
      await input.ai.execution.authorize(database);
      return input.operation.admit(database, attempt);
    },
    { signal: input.signal }
  );
  if (!admitted.dispatch)
    throw new Error('The invocation is already admitted and cannot be redispatched.');
  let dispatched = false;
  try {
    const options = await capturedLearningAiOptions({
      ...input.ai,
      execution: { ...input.ai.execution, signal: input.signal },
    });
    await admission.validate(input.signal);
    if (getCodexSshHost()) throw new Error('The admitted local CLI backend changed.');
    input.signal.throwIfAborted();
    dispatched = true;
    const response = await createAIProvider(input.ai.provider).generateResponse(
      input.system,
      input.messages,
      {
        ...options,
        ...input.options,
        signal: input.signal,
      }
    );
    if (Buffer.byteLength(JSON.stringify(response), 'utf8') > input.responseLimit)
      throw new Error('The invocation response exceeds its receipt byte budget.');
    await admission.validate(input.signal);
    if (getCodexSshHost()) throw new Error('The admitted local CLI backend changed.');
    const receipt = { inputDigest: input.inputDigest, attempt, binding, response };
    await sottoTransaction(prisma, async (database) => {
      await input.operation.validateBinding(database, binding);
      await input.ai.execution.authorize(database);
      await input.operation.settle(database, attempt, 'succeeded', receipt);
    });
    return response;
  } catch (cause) {
    if (dispatched) input.unresolved();
    try {
      await sottoTransaction(prisma, (database) =>
        input.operation.settle(database, attempt, dispatched ? 'unknown' : 'failed')
      );
    } catch (settlement) {
      input.unresolved();
      throw new LearningProviderInvocationError('UNKNOWN', input.inputDigest, {
        cause: new AggregateError([cause, settlement]),
      });
    }
    throw new LearningProviderInvocationError(
      dispatched ? 'UNKNOWN' : 'NOT_DISPATCHED',
      input.inputDigest,
      { cause }
    );
  }
}

/** Exact SDK replay over an owned immutable HTTP response. The supplied fetch never dispatches. */
export async function replayLearningProviderResponse(input: {
  provider: string;
  endpoint?: string;
  system: string;
  messages: ChatMessage[];
  options: AIOptions;
  selection: unknown;
  attemptFingerprint: string;
  receipt: LearningPreparationResponseReceipt;
  signal: AbortSignal;
}) {
  if (['codex', 'claude-code'].includes(input.provider))
    throw new Error('HTTP receipt replay requires an HTTP provider.');
  let consumed = false;
  const replayFetch: typeof fetch = async (resource, init) => {
    if (consumed) throw new Error('A response receipt can be consumed once per replay.');
    consumed = true;
    const request = new Request(resource, init);
    const fingerprint = await learningPreparationRequestFingerprint(
      request,
      input.selection,
      input.signal
    );
    if (fingerprint !== input.attemptFingerprint)
      throw new Error('The saved response request fingerprint changed.');
    return restoreLearningPreparationResponse(input.receipt);
  };
  const response = await createAIProvider(input.provider).generateResponse(
    input.system,
    input.messages,
    {
      ...input.options,
      endpoint: input.endpoint,
      apiKeyOverride: 'SOTTO_OFFLINE_RESPONSE_REPLAY',
      fetch: replayFetch,
      signal: input.signal,
    }
  );
  if (!consumed) throw new Error('The provider did not consume its saved response receipt.');
  return response;
}

/** A parseable JSON body alone never proves that the provider finished the output. */
export function learningHttpCompletion(
  receipt: LearningPreparationResponseReceipt
): 'COMPLETE' | 'TRUNCATED' | 'UNKNOWN' {
  const raw: unknown = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(receipt.bodyBase64, 'base64'))
  );
  if (!raw || typeof raw !== 'object') return 'UNKNOWN';
  const choices = Reflect.get(raw, 'choices');
  if (
    Array.isArray(choices) &&
    choices.length === 1 &&
    choices[0] &&
    typeof choices[0] === 'object'
  ) {
    const reason = Reflect.get(choices[0], 'finish_reason');
    return reason === 'stop' ? 'COMPLETE' : reason === 'length' ? 'TRUNCATED' : 'UNKNOWN';
  }
  const stop = Reflect.get(raw, 'stop_reason');
  if (stop === 'end_turn' || stop === 'stop_sequence') return 'COMPLETE';
  if (stop === 'max_tokens' || stop === 'model_context_window_exceeded') return 'TRUNCATED';
  const status = Reflect.get(raw, 'status');
  if (status === 'incomplete') return 'TRUNCATED';
  if (status === 'completed' && Reflect.get(raw, 'incomplete_details') === null) return 'COMPLETE';
  const candidates = Reflect.get(raw, 'candidates');
  if (
    Array.isArray(candidates) &&
    candidates.length === 1 &&
    candidates[0] &&
    typeof candidates[0] === 'object'
  ) {
    const reason = Reflect.get(candidates[0], 'finishReason');
    return reason === 'STOP' ? 'COMPLETE' : reason === 'MAX_TOKENS' ? 'TRUNCATED' : 'UNKNOWN';
  }
  return 'UNKNOWN';
}
