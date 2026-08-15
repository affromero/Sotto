import { spawn } from 'child_process';
import { getCodexSshHost } from '../agent-availability';
import { buildAgentInvocation } from '../agent-invocation';
import { codexEnvironment } from '../codex-client';
import { isAgentEffort, type AgentEffortLevel } from './id';

const DISCOVERY_TIMEOUT_MS = 5_000;
const CACHE_MS = 10 * 60 * 1000;
const CODEX_ENV_KEYS = ['CODEX_HOME', 'CODEX_API_KEY'];

export interface CodexModelOffering {
  model: string;
  isDefault: boolean;
  defaultEffort: AgentEffortLevel | null;
  effortOptions: AgentEffortLevel[];
}

interface ModelListResult {
  data?: Array<{
    id?: unknown;
    model?: unknown;
    hidden?: unknown;
    isDefault?: unknown;
    defaultReasoningEffort?: unknown;
    supportedReasoningEfforts?: Array<{ reasoningEffort?: unknown }>;
  }>;
  nextCursor?: unknown;
}

interface AppServerMessage {
  id?: unknown;
  result?: ModelListResult;
  error?: { message?: unknown };
}

let cache: { key: string; at: number; models: CodexModelOffering[] } | null = null;
let inFlight: { key: string; promise: Promise<CodexModelOffering[]> } | null = null;

function cacheKey(): string {
  return `${getCodexSshHost() ?? 'local'}:${process.env.CODEX_HOME ?? 'default'}`;
}

export function resetCodexModelDiscoveryCache(): void {
  cache = null;
  inFlight = null;
}

export function discoverCodexModels(): Promise<CodexModelOffering[]> {
  const key = cacheKey();
  if (cache?.key === key && Date.now() - cache.at < CACHE_MS) {
    return Promise.resolve(cache.models);
  }
  if (inFlight?.key === key) return inFlight.promise;

  const invocation = buildAgentInvocation('codex', ['app-server'], getCodexSshHost(), {
    remoteEnvKeys: CODEX_ENV_KEYS,
  });

  const promise = new Promise<CodexModelOffering[]>((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: codexEnvironment(),
    });
    const offerings: CodexModelOffering[] = [];
    let buffer = '';
    let stderr = '';
    let requestId = 1;
    let settled = false;

    const timer = setTimeout(() => {
      finish(new Error('Codex model discovery timed out.'));
    }, DISCOVERY_TIMEOUT_MS);

    function finish(error?: Error): void {
      if (settled) return;
      settled = true;
      if (inFlight?.promise === promise) inFlight = null;
      clearTimeout(timer);
      child.stdin.end();
      child.kill('SIGTERM');
      if (error) {
        reject(error);
        return;
      }
      cache = { key, at: Date.now(), models: offerings };
      resolve(offerings);
    }

    function send(message: unknown): void {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }

    function requestPage(cursor?: string): void {
      send({
        method: 'model/list',
        id: requestId,
        params: { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) },
      });
    }

    function handleLine(line: string): void {
      let message: AppServerMessage;
      try {
        message = JSON.parse(line) as AppServerMessage;
      } catch {
        return;
      }
      if (message.id === 0) {
        if (message.error) {
          finish(new Error('Codex app-server initialization failed.'));
          return;
        }
        send({ method: 'initialized', params: {} });
        requestPage();
        return;
      }
      if (message.id !== requestId) return;
      if (message.error) {
        const detail =
          typeof message.error.message === 'string' ? `: ${message.error.message}` : '';
        finish(new Error(`Codex model discovery failed${detail}`));
        return;
      }

      for (const entry of message.result?.data ?? []) {
        if (entry.hidden === true) continue;
        const model =
          typeof entry.model === 'string'
            ? entry.model
            : typeof entry.id === 'string'
              ? entry.id
              : null;
        if (!model || offerings.some((offering) => offering.model === model)) continue;
        offerings.push({
          model,
          isDefault: entry.isDefault === true,
          defaultEffort:
            typeof entry.defaultReasoningEffort === 'string' &&
            isAgentEffort(entry.defaultReasoningEffort)
              ? entry.defaultReasoningEffort
              : null,
          effortOptions: (entry.supportedReasoningEfforts ?? []).flatMap((option) =>
            typeof option.reasoningEffort === 'string' && isAgentEffort(option.reasoningEffort)
              ? [option.reasoningEffort]
              : []
          ),
        });
      }

      const cursor = message.result?.nextCursor;
      if (typeof cursor === 'string' && cursor) {
        requestId += 1;
        requestPage(cursor);
        return;
      }
      if (offerings.length === 0) {
        finish(new Error('Codex returned no picker-visible models.'));
        return;
      }
      finish();
    }

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) handleLine(line);
        newline = buffer.indexOf('\n');
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-500);
    });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (!settled) {
        finish(
          new Error(
            `Codex app-server exited with code ${code ?? 'unknown'}${stderr ? `: ${stderr}` : ''}`
          )
        );
      }
    });

    send({
      method: 'initialize',
      id: 0,
      params: { clientInfo: { name: 'sotto', title: 'Sotto', version: '0.1.0' } },
    });
  });
  inFlight = { key, promise };
  return promise;
}
