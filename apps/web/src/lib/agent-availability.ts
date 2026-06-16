import { isCommandAvailable } from './local-command';

/** Trimmed CLAUDE_CODE_SSH_HOST, or undefined when the CLI runs locally. */
export function getClaudeSshHost(): string | undefined {
  const host = process.env.CLAUDE_CODE_SSH_HOST?.trim();
  return host ? host : undefined;
}

export function isClaudeAvailable(): Promise<boolean> {
  // With a remote agent (VPS), "available" means the local ssh client exists;
  // the remote `claude` is validated on first execution.
  if (getClaudeSshHost()) return isCommandAvailable('ssh');
  return isCommandAvailable('claude');
}

/** Trimmed CODEX_SSH_HOST, or undefined when the CLI runs locally. */
export function getCodexSshHost(): string | undefined {
  const host = process.env.CODEX_SSH_HOST?.trim();
  return host ? host : undefined;
}

export function isCodexAvailable(): Promise<boolean> {
  // With a remote agent (VPS), "available" means the local ssh client exists;
  // the remote `codex` is validated on first execution.
  if (getCodexSshHost()) return isCommandAvailable('ssh');
  return isCommandAvailable('codex');
}
