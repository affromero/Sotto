import { z } from 'zod';
import {
  credentialEditContextSchema,
  credentialRemovalRequestSchema,
  credentialSaveRequest,
  credentialSettingsSnapshotSchema,
  reconcileCredentialMutation,
  sameCredentialEditContext,
  type CredentialRemovalRequest,
  type CredentialSaveDraft,
  type CredentialSettingsKey,
  type CredentialSettingsSnapshot,
} from 'thesidedoor-core/configuration/credential-client';

export type CredentialEndpoint = 'ai-keys' | 'byok' | 'visual-cues';
const endpoints = new Set<CredentialEndpoint>(['ai-keys', 'byok', 'visual-cues']);

/** Retain operation identity without retaining submitted credential values. */
export function captureCredentialReceipt(command: CredentialRemovalRequest) {
  const receipt = credentialRemovalRequestSchema.parse({
    context: command.context,
    provider: command.provider,
    expectedRevision: command.expectedRevision,
    operationId: command.operationId,
  });
  Object.freeze(receipt.context.owner);
  Object.freeze(receipt.context);
  return Object.freeze(receipt);
}

function path(endpoint: CredentialEndpoint) {
  if (!endpoints.has(endpoint)) throw new Error('Invalid credential settings endpoint');
  return `/api/v1/settings/${endpoint}`;
}

export class CredentialHttpError extends Error {
  constructor(readonly status: number) {
    super(
      status === 409
        ? 'These settings changed. Reload them and review your edit before saving again.'
        : status === 401 || status === 403
          ? 'Your access changed. Sign in again before editing credentials.'
          : status === 422
            ? 'The provider rejected these credentials. Check the key and account details.'
            : status === 400
              ? 'Check the required credential fields.'
              : 'Credential settings are unavailable. Try loading them again.'
    );
  }
}

/** Access failed during the read after a mutation, whose receipt must be retained. */
export class CredentialReconciliationError extends CredentialHttpError {}

export async function loadCredentialSettings(endpoint: CredentialEndpoint, signal?: AbortSignal) {
  const response = await fetch(path(endpoint), {
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
  });
  signal?.throwIfAborted();
  if (!response.ok) throw new CredentialHttpError(response.status);
  const snapshot = credentialSettingsSnapshotSchema.parse(await response.json());
  signal?.throwIfAborted();
  if (snapshot.context.scope !== endpoint) throw new Error('Credential settings context changed');
  return snapshot;
}

const validation = z.object({
  status: z.enum(['valid', 'inconclusive']),
  readiness: z.object({ code: z.string(), checkedAt: z.number().finite().nonnegative() }),
});
const receipt = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('saved'),
    revision: z.uuid(),
    context: credentialEditContextSchema,
    validation,
  }),
  z.object({
    status: z.literal('removed'),
    revision: z.uuid(),
    context: credentialEditContextSchema,
  }),
  z.object({
    status: z.literal('needs_confirmation'),
    operationId: z.uuid(),
    context: credentialEditContextSchema,
    validation: validation.extend({ status: z.literal('inconclusive') }),
  }),
]);

export type CredentialMutationResult =
  | { status: 'confirmed'; snapshot: CredentialSettingsSnapshot; key: CredentialSettingsKey | null }
  | { status: 'needs_confirmation' }
  | { status: 'acknowledged'; operation: 'save' | 'remove' }
  | { status: 'unknown' | 'superseded' | 'context_changed' };

/** A fresh read only reconciles the captured operation. It never retries a write. */
export async function reconcileCredentialSettings(
  endpoint: CredentialEndpoint,
  command: CredentialRemovalRequest,
  kind: 'save' | 'remove',
  signal?: AbortSignal
): Promise<CredentialMutationResult> {
  const snapshot = await loadCredentialSettings(endpoint, signal);
  const result = reconcileCredentialMutation(command, snapshot, kind);
  if (result.status !== 'confirmed') return result;
  return { status: 'confirmed', snapshot, key: result.key };
}

/** Uncertain writes are reconciled with their receipt, without resubmitting values. */
interface MutationSubmission {
  endpoint: CredentialEndpoint;
  command: CredentialRemovalRequest;
  body: unknown;
  kind: 'save' | 'remove';
  signal?: AbortSignal;
  headers: Headers;
}

async function mutate(submission: MutationSubmission): Promise<CredentialMutationResult> {
  const { endpoint, command, body, kind, signal, headers } = submission;
  if (command.context.scope !== endpoint) throw new Error('Credential edit context changed');
  signal?.throwIfAborted();
  let acknowledged = false;
  try {
    const response = await fetch(path(endpoint), {
      method: kind === 'save' ? 'POST' : 'DELETE',
      credentials: 'same-origin',
      cache: 'no-store',
      headers,
      body: JSON.stringify(body),
      signal,
    });
    signal?.throwIfAborted();
    if (response.status >= 400 && response.status < 500)
      throw new CredentialHttpError(response.status);
    if (response.ok) {
      const parsed = receipt.safeParse(await response.json());
      signal?.throwIfAborted();
      if (parsed.success && sameCredentialEditContext(parsed.data.context, command.context)) {
        const result = parsed.data;
        if (
          kind === 'save' &&
          result.status === 'needs_confirmation' &&
          result.operationId === command.operationId
        )
          return { status: 'needs_confirmation' };
        acknowledged =
          result.status === (kind === 'save' ? 'saved' : 'removed') &&
          'revision' in result &&
          result.revision === command.operationId;
      }
    }
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof CredentialHttpError) throw error;
  }
  try {
    return await reconcileCredentialSettings(endpoint, command, kind, signal);
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof CredentialHttpError && (error.status === 401 || error.status === 403))
      throw new CredentialReconciliationError(error.status);
    return acknowledged ? { status: 'acknowledged', operation: kind } : { status: 'unknown' };
  }
}

export interface CredentialSaveOptions {
  signal?: AbortSignal;
  allowUnverified?: boolean;
  reviewedEndpoint?: string;
}

export function saveCredentialSettings(
  endpoint: CredentialEndpoint,
  draft: CredentialSaveDraft,
  options: CredentialSaveOptions = {}
) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (options.reviewedEndpoint && endpoint === 'ai-keys' && draft.provider === 'local')
    headers.set('x-sotto-reviewed-ai-endpoint', options.reviewedEndpoint);
  return mutate({
    kind: 'save',
    endpoint,
    headers,
    command: captureCredentialReceipt(draft),
    body: credentialSaveRequest(draft, options.allowUnverified ?? false),
    signal: options.signal,
  });
}

export function removeCredentialSettings(
  endpoint: CredentialEndpoint,
  command: CredentialRemovalRequest,
  signal?: AbortSignal
) {
  return mutate({
    kind: 'remove',
    endpoint,
    command: captureCredentialReceipt(command),
    body: command,
    signal,
    headers: new Headers({ 'content-type': 'application/json' }),
  });
}
