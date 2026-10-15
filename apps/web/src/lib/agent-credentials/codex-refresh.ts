import { PassThrough } from 'node:stream';
import { ProcessRunner, ProcessExecutionError } from 'thesidedoor-core/runtime/process';
import { abortable } from 'thesidedoor-core/runtime/stream';
import { codexEnvironment } from '../codex-client';
import { getRecord, getString, isRecord } from '../agent-usage/utils';

export interface RefreshableCodexAccount {
  home: string;
  accountId: string;
  accessToken: string;
}

export class CodexRefreshError extends Error {
  constructor(readonly reason: 'action_required' | 'unavailable') {
    super('Codex account refresh did not establish a usable session.');
  }
}

interface Renewal {
  controller: AbortController;
  promise: Promise<void>;
  users: number;
}

const renewals = new Map<string, Renewal>();

/** Use the managed CLI lifecycle, without forcing rotation or starting a turn. */
export async function renewCodexUsageAccount(
  expected: RefreshableCodexAccount,
  readCurrent: (signal: AbortSignal) => Promise<RefreshableCodexAccount | null>,
  validate: (signal: AbortSignal) => Promise<void>,
  signal: AbortSignal
): Promise<void> {
  signal.throwIfAborted();
  const key = JSON.stringify([expected.home, expected.accountId]);
  let renewal = renewals.get(key);
  if (!renewal) {
    const controller = new AbortController();
    const promise = (async () => {
      await validate(controller.signal);
      const current = await readCurrent(controller.signal);
      await validate(controller.signal);
      if (!current || current.home !== expected.home || current.accountId !== expected.accountId)
        throw new CodexRefreshError('unavailable');
      if (current.accessToken !== expected.accessToken) return;
      await readManagedAccount(expected.home, controller.signal);
    })();
    renewal = { controller, promise, users: 0 };
    renewals.set(key, renewal);
    const owned = renewal;
    void promise
      .finally(() => {
        if (renewals.get(key) === owned) renewals.delete(key);
      })
      .catch(() => undefined);
  }
  renewal.users++;
  try {
    await abortable(renewal.promise, signal);
  } finally {
    renewal.users--;
    if (renewal.users === 0) {
      renewal.controller.abort();
      try {
        await renewal.promise;
      } catch (error) {
        if (
          error instanceof AggregateError ||
          (error instanceof ProcessExecutionError && error.code === 'cleanup_failed')
        )
          throw error;
      }
    }
  }
}

async function readManagedAccount(home: string, signal: AbortSignal): Promise<void> {
  const input = new PassThrough();
  const send = (value: unknown) => input.write(JSON.stringify(value) + '\n');
  send({
    id: 0,
    method: 'initialize',
    params: {
      clientInfo: { name: 'sotto_usage', version: '1.0' },
      capabilities: {},
    },
  });
  let buffer = '';
  let initialized = false;
  let received = false;
  try {
    messages: for await (const chunk of new ProcessRunner().stream({
      command: 'codex',
      args: ['app-server'],
      environment: { ...codexEnvironment(), CODEX_HOME: home },
      inputStream: () => input,
      signal,
      timeoutMs: 15_000,
      maxOutputBytes: 65_536,
    })) {
      if (chunk.channel !== 'stdout') continue;
      buffer += chunk.text;
      let end: number;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        let message: unknown;
        try {
          message = JSON.parse(line);
        } catch {
          throw new CodexRefreshError('unavailable');
        }
        if (!isRecord(message)) throw new CodexRefreshError('unavailable');
        if (message.id === 0 && !initialized) {
          if (message.error) throw new CodexRefreshError('unavailable');
          initialized = true;
          send({ method: 'initialized', params: {} });
          send({ id: 1, method: 'account/read', params: { refreshToken: false } });
        } else if (message.id === 1 && initialized) {
          const result = getRecord(message, 'result');
          if (message.error) {
            const detail = getString(getRecord(message, 'error')?.message) ?? '';
            throw new CodexRefreshError(
              /refresh.token|not logged in|unauthorized/i.test(detail)
                ? 'action_required'
                : 'unavailable'
            );
          }
          if (getString(getRecord(result, 'account')?.type) !== 'chatgpt')
            throw new CodexRefreshError('action_required');
          received = true;
          break messages;
        }
      }
    }
    if (!received) throw new CodexRefreshError('unavailable');
  } finally {
    input.destroy();
  }
}
