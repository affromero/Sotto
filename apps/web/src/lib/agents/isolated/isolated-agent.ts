import {
  DockerIsolatedRunner,
  IsolatedCleanupError,
  type IsolatedIdentity,
} from 'thesidedoor-core/runtime/isolated';
import {
  startCredentialBroker,
  isolatedClaudeRelay,
  CredentialBrokerCleanupError,
  type CredentialBroker,
} from 'thesidedoor-core/runtime/credential-broker';
export { CredentialBrokerCleanupError } from 'thesidedoor-core/runtime/credential-broker';
import type { ProcessChunk } from 'thesidedoor-core/runtime/process';

/** Explicit API-key execution. Subscription credentials are never accepted here. */
export interface IsolatedClaudeExecution {
  image: string;
  cliVersion: '2.1.283';
  executionId: string;
  endpoint: string;
  credential: string;
  expiresAt: number;
  maxOutputTokens: number;
  /** Revalidate recipient/credential authority and reserve every HTTP attempt. */
  admit(request: {
    executionId: string;
    model: string;
    maxOutputTokens: number;
    signal: AbortSignal;
  }): Promise<void>;
  authenticatedFetch: typeof fetch;
  recordIdentity(identity: IsolatedIdentity): Promise<void>;
  recordCleanup(identity: IsolatedIdentity): Promise<void>;
  onCleanupError?(error: unknown): void;
}

export { IsolatedCleanupError };

export async function* streamIsolatedClaude(request: {
  execution: IsolatedClaudeExecution;
  model: string;
  args: string[];
  prompt: string;
  signal?: AbortSignal;
  timeoutMs: number;
}): AsyncGenerator<ProcessChunk> {
  if (!request.model.startsWith('claude-'))
    throw new Error(
      'Isolated Claude requires a canonical API model ID; CLI aliases are unsupported'
    );
  if (process.platform !== 'linux')
    throw new Error('Isolated Claude requires a local Linux Docker host');
  if (request.execution.cliVersion !== '2.1.283')
    throw new Error('Unsupported isolated Claude protocol');
  const broker = await startCredentialBroker({
    executionId: request.execution.executionId,
    protocol: 'anthropic-messages',
    endpoint: request.execution.endpoint,
    model: request.model,
    credential: request.execution.credential,
    expiresAt: request.execution.expiresAt,
    maxOutputTokens: request.execution.maxOutputTokens,
    maxRequestBytes: 2 * 1024 * 1024,
    maxResponseBytes: 16 * 1024 * 1024,
    maxConcurrentRequests: 1,
    requestTimeoutMs: request.timeoutMs,
    signal: request.signal,
    admit: request.execution.admit,
    fetch: request.execution.authenticatedFetch,
  });
  let primary: unknown;
  try {
    yield* new DockerIsolatedRunner().stream({
      executionId: request.execution.executionId,
      image: request.execution.image,
      command: ['node', '-e', isolatedClaudeRelay],
      input: JSON.stringify({
        token: broker.token,
        args: request.args,
        prompt: request.prompt,
        maxOutputTokens: request.execution.maxOutputTokens,
      }),
      brokerDirectory: broker.directory,
      signal: request.signal,
      timeoutMs: request.timeoutMs,
      maxOutputBytes: 16 * 1024 * 1024,
      memoryMb: 1024,
      cpus: 1,
      pids: 64,
      scratchMb: 64,
      recordIdentity: request.execution.recordIdentity,
      recordCleanup: request.execution.recordCleanup,
    });
  } catch (error) {
    primary = error;
    if (error instanceof IsolatedCleanupError || error instanceof CredentialBrokerCleanupError)
      request.execution.onCleanupError?.(error);
    throw error;
  } finally {
    await closeBroker(broker, primary, request.execution.onCleanupError);
  }
}

async function closeBroker(
  broker: CredentialBroker,
  primary: unknown,
  onCleanupError?: (error: unknown) => void
): Promise<void> {
  try {
    await broker.close();
  } catch (error) {
    onCleanupError?.(error);
    if (primary)
      throw new AggregateError([primary, error], 'Isolated execution and broker cleanup failed');
    throw error;
  }
}
