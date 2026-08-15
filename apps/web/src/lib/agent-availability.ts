import { spawn } from 'child_process';
import { buildAgentInvocation, minimalAgentEnvironment } from './agent-invocation';
import { installCurrentProviderCredentialSnapshot } from './agent-credentials';

export type AgentReadiness = 'ready' | 'not_installed' | 'not_authenticated' | 'unreachable';

export interface AgentStatus {
  readiness: AgentReadiness;
  version: string | null;
  detail: string | null;
}

type AgentProvider = 'claude-code' | 'codex';

const PROBE_TIMEOUT_MS = 10_000;
const CACHE_MS = 60_000;
const CLAUDE_ENV_KEYS = [
  'CLAUDE_HOME',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
];
const CODEX_ENV_KEYS = ['CODEX_HOME', 'CODEX_API_KEY'];
let statusCache = new Map<AgentProvider, { at: number; status: AgentStatus }>();
let statusInFlight = new Map<AgentProvider, Promise<AgentStatus>>();

/** Trimmed CLAUDE_CODE_SSH_HOST, or undefined when the CLI runs locally. */
export function getClaudeSshHost(): string | undefined {
  const host = process.env.CLAUDE_CODE_SSH_HOST?.trim();
  return host || undefined;
}

/** Trimmed CODEX_SSH_HOST, or undefined when the CLI runs locally. */
export function getCodexSshHost(): string | undefined {
  const host = process.env.CODEX_SSH_HOST?.trim();
  return host || undefined;
}

function providerConfig(provider: AgentProvider): {
  cli: string;
  sshHost?: string;
  authArgs: string[];
  envKeys: string[];
} {
  return provider === 'claude-code'
    ? {
        cli: 'claude',
        sshHost: getClaudeSshHost(),
        authArgs: ['auth', 'status'],
        envKeys: CLAUDE_ENV_KEYS,
      }
    : {
        cli: 'codex',
        sshHost: getCodexSshHost(),
        authArgs: ['login', 'status'],
        envKeys: CODEX_ENV_KEYS,
      };
}

function probe(
  provider: AgentProvider,
  args: string[]
): Promise<{ ok: boolean; output: string; error: string }> {
  const config = providerConfig(provider);
  const invocation = buildAgentInvocation(config.cli, args, config.sshHost, {
    remoteEnvKeys: config.envKeys,
  });
  return new Promise((resolve) => {
    const child = spawn(invocation.command, invocation.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: minimalAgentEnvironment(config.envKeys),
    });
    let output = '';
    let error = '';
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok, output: output.trim(), error: error.trim() });
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(false);
    }, PROBE_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-500);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      error = `${error}${chunk.toString()}`.slice(-500);
    });
    child.on('error', (spawnError) => {
      error = spawnError.message;
      finish(false);
    });
    child.on('close', (code) => finish(code === 0));
  });
}

export function getAgentStatus(provider: AgentProvider): Promise<AgentStatus> {
  const cached = statusCache.get(provider);
  if (cached && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached.status);
  const existing = statusInFlight.get(provider);
  if (existing) return existing;
  const promise = (async () => {
    installCurrentProviderCredentialSnapshot(provider);
    const config = providerConfig(provider);
    const version = await probe(provider, ['--version']);
    let status: AgentStatus;
    if (!version.ok) {
      status = {
        readiness: config.sshHost ? 'unreachable' : 'not_installed',
        version: null,
        detail: version.error || 'CLI version probe failed.',
      };
    } else {
      const auth = await probe(provider, config.authArgs);
      status = auth.ok
        ? { readiness: 'ready', version: version.output || null, detail: null }
        : {
            readiness: 'not_authenticated',
            version: version.output || null,
            detail: auth.error || auth.output || 'CLI authentication probe failed.',
          };
    }
    statusCache.set(provider, { at: Date.now(), status });
    return status;
  })().finally(() => statusInFlight.delete(provider));
  statusInFlight.set(provider, promise);
  return promise;
}

export function resetAgentStatusCache(): void {
  statusCache = new Map();
  statusInFlight = new Map();
}

export async function isClaudeAvailable(): Promise<boolean> {
  return (await getAgentStatus('claude-code')).readiness === 'ready';
}

export async function isCodexAvailable(): Promise<boolean> {
  return (await getAgentStatus('codex')).readiness === 'ready';
}
