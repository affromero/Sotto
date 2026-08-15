const BASE_ENV_KEYS = [
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'TERM',
  'TMPDIR',
  'USER',
  'LOGNAME',
  'SHELL',
  'SSH_AUTH_SOCK',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
] as const;

export interface AgentInvocationOptions {
  remoteEnvKeys?: string[];
}

/**
 * Build the environment for a prompt-steerable CLI process. The child receives
 * only ordinary process plumbing plus explicitly named provider credentials;
 * app secrets and unrelated provider keys are absent by default.
 */
export function minimalAgentEnvironment(
  providerKeys: string[],
  overrides: Record<string, string | undefined> = {}
): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {};
  for (const key of [...BASE_ENV_KEYS, ...providerKeys]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...overrides } as NodeJS.ProcessEnv;
}

function sshOptions(): string[] {
  const options = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes'];
  const keyPath = process.env.SOTTO_AGENT_SSH_KEY_PATH?.trim();
  const knownHostsPath = process.env.SOTTO_AGENT_SSH_KNOWN_HOSTS_PATH?.trim();
  if (keyPath) options.push('-i', keyPath);
  if (knownHostsPath) options.push('-o', `UserKnownHostsFile=${knownHostsPath}`);
  return options;
}

/** Single-quote a value for safe interpolation into a remote shell command. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Resolve direct local execution or an SSH-wrapped remote agent invocation. */
export function buildAgentInvocation(
  cli: string,
  args: string[],
  sshHost?: string,
  options: AgentInvocationOptions = {}
): { command: string; args: string[] } {
  if (!sshHost) return { command: cli, args };
  const remoteKeys = [...new Set([...BASE_ENV_KEYS, ...(options.remoteEnvKeys ?? [])])];
  for (const key of remoteKeys) {
    if (!/^[A-Z_a-z][A-Z_a-z0-9]*$/.test(key)) {
      throw new Error(`Invalid remote environment key: ${key}`);
    }
  }
  // The remote login shell expands these references before `env -i` starts,
  // preserving only allowlisted values from the remote agent host. Local app
  // credentials are intentionally never copied across SSH.
  const assignments = remoteKeys.map((key) => `${key}="\${${key}-}"`).join(' ');
  const command = [cli, ...args].map(shellQuote).join(' ');
  const remote = `env -i ${assignments} ${command}`;
  return { command: 'ssh', args: [...sshOptions(), '-T', sshHost, remote] };
}
