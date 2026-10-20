import { readResponseBytes } from 'thesidedoor-core/runtime/stream';
import type { Prisma } from '@/generated/prisma/client';
import {
  executeLearningCliOnce,
  LearningProviderInvocationError,
} from '@/lib/learning/preparation/provider-invocation';
import { capturedLearningAiOptions, type CapturedLearningAi } from '@/lib/learning-ai';
import { createAIProvider, type AIResponse, type ImageContentPart } from '@/lib/providers/ai';
import { decodeCodexImages } from '@/lib/providers/agents/codex-images';
import { getCodexSshHost } from '@/lib/agent-availability';
import {
  learningPreparationProviderRequest,
  learningPreparationRequestFingerprint,
  restoreLearningPreparationResponse,
  type LearningPreparationResponseReceipt,
} from '@/lib/learning/preparation/preparation-provider';
import {
  MATERIAL_RECOGNITION_LIMITS,
  MATERIAL_TRANSCRIPTION_JSON_SCHEMA,
  MaterialRecognitionUnsupported,
  materialRecognitionHash,
  materialRecognitionSelection,
  parseMaterialTranscription,
  prepareMaterialRecognition,
  type PreparedMaterialRecognition,
} from './protocol';

type ProviderOperation = Parameters<typeof learningPreparationProviderRequest>[0];
export type MaterialRecognitionHttpOperation = Pick<ProviderOperation, 'admit' | 'settle'>;
export type RecognitionAttempt = Parameters<ProviderOperation['admit']>[1];
export interface MaterialRecognitionHttpReceipt {
  inputDigest: string;
  attempt: RecognitionAttempt;
  response: LearningPreparationResponseReceipt;
}
export interface MaterialRecognitionCliBinding {
  kind: 'LOCAL_ACCOUNT';
  fingerprint: string;
  revision: string;
}
export interface MaterialRecognitionCliReceipt {
  inputDigest: string;
  attempt: RecognitionAttempt;
  binding: MaterialRecognitionCliBinding;
  response: AIResponse;
}
export interface MaterialRecognitionCliOperation {
  admit: ProviderOperation['admit'];
  settle: (
    database: Prisma.TransactionClient,
    attempt: RecognitionAttempt,
    outcome: 'succeeded' | 'failed' | 'unknown',
    receipt?: MaterialRecognitionCliReceipt
  ) => Promise<unknown>;
  /** Persistent account/config binding, not the ephemeral agent-usage HMAC. */
  validateBinding: (
    database: Prisma.TransactionClient,
    expected: MaterialRecognitionCliBinding
  ) => Promise<void>;
}

export class MaterialRecognitionExecutionError extends Error {
  constructor(
    readonly outcome: 'NOT_DISPATCHED' | 'FAILED' | 'UNKNOWN' | 'OUTPUT_INVALID',
    readonly inputDigest: string,
    options: ErrorOptions
  ) {
    super(`Material recognition ${outcome.toLowerCase().replaceAll('_', ' ')}.`, options);
    this.name = 'MaterialRecognitionExecutionError';
  }
}

function materialRecognitionAttemptSelection(prepared: PreparedMaterialRecognition) {
  return {
    kind: 'material-page-recognition',
    inputDigest: prepared.inputDigest,
    // The HTTP fingerprint includes JSON serialization. Restore this fixed field
    // order after a PostgreSQL JSONB round trip, without changing other callers.
    selection: {
      provider: prepared.selection.provider,
      model: prepared.selection.model,
      endpoint: prepared.selection.endpoint,
      credentialFingerprint: prepared.selection.credentialFingerprint,
      credentialRevision: prepared.selection.credentialRevision,
      capabilitySha256: prepared.selection.capabilitySha256,
    },
  };
}

function checkedInput(ai: CapturedLearningAi, prepared: PreparedMaterialRecognition) {
  const captured = structuredClone(prepared);
  if (
    materialRecognitionHash(materialRecognitionSelection(ai, captured.capability)) !==
    materialRecognitionHash(captured.selection)
  )
    throw new Error('Recognition provider or credential revision changed.');
  const images = captured.messages.flatMap((message) =>
    typeof message.content === 'string'
      ? []
      : message.content.filter((part): part is ImageContentPart => part.type === 'image_url')
  );
  const decoded = decodeCodexImages(images);
  const checked = prepareMaterialRecognition({
    ai,
    source: captured.source,
    capability: captured.capability,
    images: decoded.map((image, index) => ({
      index: captured.source.tiles[index]!.index,
      bytes: image.bytes,
    })),
  });
  if (
    captured.inputDigest !== checked.inputDigest ||
    captured.system !== checked.system ||
    materialRecognitionHash(captured.messages) !== materialRecognitionHash(checked.messages)
  )
    throw new Error('Immutable recognition inputs changed.');
  return checked;
}

function outputOptions(prepared: PreparedMaterialRecognition) {
  return {
    model: prepared.selection.model,
    maxTokens: prepared.capability.maxOutputTokens,
    maxOutputBytes: MATERIAL_RECOGNITION_LIMITS.responseBytes,
    temperature: 0,
    skipModeration: true,
    useWebSearch: false,
    jsonSchema: { name: 'material_page_transcription', schema: MATERIAL_TRANSCRIPTION_JSON_SCHEMA },
  };
}

/** Actual HTTP attempts are journaled by the canonical transport hook. No paid retry dispatch. */
export async function executeMaterialRecognitionHttp(options: {
  ai: CapturedLearningAi;
  prepared: PreparedMaterialRecognition;
  operation: MaterialRecognitionHttpOperation;
  signal: AbortSignal;
  unresolved: () => void;
}) {
  const prepared = checkedInput(options.ai, options.prepared);
  if (prepared.selection.provider === 'codex' || prepared.selection.provider === 'claude-code')
    throw new MaterialRecognitionUnsupported(
      'CLI recognition requires the separate durable invocation journal.'
    );
  let observed = false;
  let outcome: 'NOT_DISPATCHED' | 'FAILED' | 'UNKNOWN' | 'OUTPUT_INVALID' = 'NOT_DISPATCHED';
  const providerRequest = learningPreparationProviderRequest(
    {
      ...options.operation,
      selection: materialRecognitionAttemptSelection(prepared),
      responseReceipt: { maxBytes: MATERIAL_RECOGNITION_LIMITS.responseBytes },
    },
    options.signal,
    () => {
      outcome = 'UNKNOWN';
      options.unresolved();
    }
  );
  const ai: CapturedLearningAi = {
    ...options.ai,
    execution: {
      ...options.ai.execution,
      signal: options.signal,
      providerRequest: async (request, dispatch) => {
        if (observed)
          throw new Error('This recognition invocation cannot dispatch another HTTP attempt.');
        const bytes = await readResponseBytes(request.clone(), {
          signal: options.signal,
          maxBytes: MATERIAL_RECOGNITION_LIMITS.serializedBytes,
        });
        const payload: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
        if (typeof payload !== 'object' || payload === null)
          throw new MaterialRecognitionUnsupported(
            'The recognition HTTP output budget is unavailable.'
          );
        const budgets = ['max_tokens', 'max_completion_tokens', 'max_output_tokens']
          .filter((key) => key in payload)
          .map((key) => Reflect.get(payload, key));
        if (
          !budgets.length ||
          budgets.some(
            (value) =>
              typeof value !== 'number' ||
              !Number.isSafeInteger(value) ||
              value < 1 ||
              value > prepared.capability.maxOutputTokens
          )
        )
          throw new MaterialRecognitionUnsupported(
            'The effective provider output budget exceeds the reviewed recognition capability.'
          );
        observed = true;
        const response = await providerRequest(request, dispatch);
        outcome = response.ok ? 'OUTPUT_INVALID' : 'FAILED';
        return response;
      },
    },
  };
  try {
    options.signal.throwIfAborted();
    const response = await createAIProvider(ai.provider).generateResponse(
      prepared.system,
      prepared.messages,
      {
        ...(await capturedLearningAiOptions(ai)),
        ...outputOptions(prepared),
        signal: options.signal,
      }
    );
    if (!observed) throw new Error('Recognition returned without a journaled provider request.');
    options.signal.throwIfAborted();
    return parseMaterialTranscription(prepared, response.content);
  } catch (error) {
    throw new MaterialRecognitionExecutionError(outcome, prepared.inputDigest, { cause: error });
  }
}

/** Canonical SDK parsing over an owned saved response. This function cannot make a network call. */
export async function replayMaterialRecognitionHttp(options: {
  prepared: PreparedMaterialRecognition;
  receipt: MaterialRecognitionHttpReceipt;
  signal: AbortSignal;
}) {
  const prepared = structuredClone(options.prepared);
  // Preserve the original provider request bytes when durable JSONB has reordered keys.
  prepared.messages = prepared.messages.map((message) => ({
    role: message.role,
    content:
      typeof message.content === 'string'
        ? message.content
        : message.content.map((part) => {
            if (part.type === 'text') return { type: 'text' as const, text: part.text };
            if (part.type === 'image_url') return { type: 'image_url' as const, url: part.url };
            throw new MaterialRecognitionUnsupported(
              'Saved page recognition supports text and page images only.'
            );
          }),
  }));
  const receipt = structuredClone(options.receipt);
  if (
    receipt.inputDigest !== prepared.inputDigest ||
    receipt.response.status < 200 ||
    receipt.response.status >= 300
  )
    throw new Error('No successful response receipt exists for this recognition input.');
  if (['codex', 'claude-code'].includes(prepared.selection.provider))
    throw new MaterialRecognitionUnsupported('CLI responses require invocation receipt replay.');
  let consumed = false;
  const replayFetch: typeof fetch = async (input, init) => {
    if (consumed) throw new Error('A saved response may be consumed only once.');
    consumed = true;
    const request = new Request(input, init);
    const fingerprint = await learningPreparationRequestFingerprint(
      request,
      materialRecognitionAttemptSelection(prepared),
      options.signal
    );
    if (fingerprint !== receipt.attempt.fingerprint)
      throw new Error('The response receipt belongs to a different serialized request.');
    return restoreLearningPreparationResponse(receipt.response);
  };
  const response = await createAIProvider(prepared.selection.provider).generateResponse(
    prepared.system,
    prepared.messages,
    {
      ...outputOptions(prepared),
      endpoint: prepared.selection.endpoint ?? undefined,
      // Required only to instantiate the canonical SDK parser. replayFetch never dispatches.
      apiKeyOverride: 'SOTTO_OFFLINE_RESPONSE_REPLAY',
      fetch: replayFetch,
      signal: options.signal,
    }
  );
  if (!consumed) throw new Error('The canonical provider did not consume the saved response.');
  return parseMaterialTranscription(prepared, response.content);
}

/** One local canonical CLI invocation. Every post-dispatch error remains unknown. */
export async function executeMaterialRecognitionCli(options: {
  ai: CapturedLearningAi;
  prepared: PreparedMaterialRecognition;
  binding: MaterialRecognitionCliBinding;
  operation: MaterialRecognitionCliOperation;
  signal: AbortSignal;
  unresolved: () => void;
}) {
  const prepared = checkedInput(options.ai, options.prepared);
  const binding = structuredClone(options.binding);
  if (
    options.ai.provider !== 'codex' ||
    getCodexSshHost() ||
    options.ai.isolatedImage ||
    options.ai.model === 'codex' ||
    binding.kind !== 'LOCAL_ACCOUNT' ||
    !/^[a-f0-9]{64}$/.test(binding.fingerprint) ||
    !binding.revision
  )
    throw new MaterialRecognitionUnsupported(
      'Local CLI recognition requires an explicit model and persistent local account/config binding.'
    );
  let response: AIResponse;
  try {
    response = await executeLearningCliOnce({
      ai: options.ai,
      inputDigest: prepared.inputDigest,
      selection: prepared.selection,
      system: prepared.system,
      messages: prepared.messages,
      options: outputOptions(prepared),
      responseLimit: MATERIAL_RECOGNITION_LIMITS.responseBytes,
      binding,
      operation: options.operation,
      signal: options.signal,
      unresolved: options.unresolved,
    });
  } catch (error) {
    if (error instanceof LearningProviderInvocationError)
      throw new MaterialRecognitionExecutionError(error.outcome, prepared.inputDigest, {
        cause: error,
      });
    throw error;
  }
  try {
    return parseMaterialTranscription(prepared, response.content);
  } catch (error) {
    throw new MaterialRecognitionExecutionError('OUTPUT_INVALID', prepared.inputDigest, {
      cause: error,
    });
  }
}

export function replayMaterialRecognitionCli(
  prepared: PreparedMaterialRecognition,
  receipt: MaterialRecognitionCliReceipt
) {
  const expected = materialRecognitionHash({
    inputDigest: prepared.inputDigest,
    selection: prepared.selection,
    binding: receipt.binding,
  });
  if (
    receipt.inputDigest !== prepared.inputDigest ||
    receipt.attempt.fingerprint !== expected ||
    Buffer.byteLength(JSON.stringify(receipt.response), 'utf8') >
      MATERIAL_RECOGNITION_LIMITS.responseBytes
  )
    throw new Error('The CLI recognition receipt identity changed.');
  return parseMaterialTranscription(prepared, receipt.response.content);
}
