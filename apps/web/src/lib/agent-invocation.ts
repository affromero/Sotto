const SSH_OPTS = ['-o', 'BatchMode=yes', '-T'];

/** Single-quote a value for safe interpolation into a remote shell command. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Resolve direct local execution or an SSH-wrapped remote agent invocation. */
export function buildAgentInvocation(
  cli: string,
  args: string[],
  sshHost?: string,
): { command: string; args: string[] } {
  if (!sshHost) return { command: cli, args };
  const remote = [cli, ...args].map(shellQuote).join(' ');
  return { command: 'ssh', args: [...SSH_OPTS, sshHost, remote] };
}
