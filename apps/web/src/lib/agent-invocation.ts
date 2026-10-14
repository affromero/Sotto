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
  remoteOutputSchema?: { json: string; cleanupToken: string };
  remoteImageInputs?: { names: string[]; cleanupToken: string };
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
  if (options.remoteImageInputs?.names.length && args.at(-1) !== '-')
    throw new Error('Remote Codex images require a stdin prompt');
  const invocationArgs = options.remoteImageInputs?.names.length ? args.slice(0, -1) : args;
  const command = [cli, ...invocationArgs].map(shellQuote).join(' ');
  let remote = `env -i ${assignments} ${command}`;
  if (options.remoteOutputSchema || options.remoteImageInputs) {
    const json = options.remoteOutputSchema?.json;
    const cleanupToken =
      options.remoteOutputSchema?.cleanupToken ?? options.remoteImageInputs!.cleanupToken;
    if (cli !== 'codex' || !/^[a-f0-9-]{36}$/.test(cleanupToken))
      throw new Error('Invalid remote output schema invocation');
    if (json && Buffer.byteLength(json) > 1_048_576)
      throw new Error('Output schema exceeds its size limit');
    const parsed: unknown = json ? JSON.parse(json) : undefined;
    if (json && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)))
      throw new Error('Output schema must be a JSON object');
    const names = options.remoteImageInputs?.names ?? [];
    if (
      names.length > 5 ||
      names.some((name) => !/^image-[0-4]\.(?:png|jpeg)$/.test(name)) ||
      new Set(names).size !== names.length
    )
      throw new Error('Invalid remote Codex image input names');
    const encoded = json ? Buffer.from(json).toString('base64') : undefined;
    const prepareImages = names
      .map(
        (name) =>
          `IFS= read -r sotto_image_frame || exit 75\nprintf '%s' "$sotto_image_frame" | base64 -d > "$sotto_schema_dir/${name}" || exit 75`
      )
      .join('\n');
    const imageArgs = names.length
      ? names.map((name) => `'--image' "$sotto_schema_dir/${name}"`).join(' ') + " '--' '-'"
      : '';
    const schemaArg = json ? `'--output-schema' "$sotto_schema_dir/schema.json"` : '';
    remote = `umask 077
sotto_schema_dir=$(mktemp -d) || exit 75
sotto_schema_child=
sotto_schema_cleanup() {
  trap '' HUP INT TERM
  if [ -n "$sotto_schema_child" ]; then
    kill -TERM "$sotto_schema_child" 2>/dev/null || :
    wait "$sotto_schema_child" 2>/dev/null || :
  fi
  if ! rm -rf -- "$sotto_schema_dir"; then
    printf '%s\\n' 'Codex output schema cleanup failed' >&2
    exit 76
  fi
  printf '%s\\n' ${shellQuote('SOTTO_CODEX_SCHEMA_CLEANED ' + cleanupToken)} >&2
}
trap 'sotto_schema_status=$?; trap - EXIT; sotto_schema_cleanup; exit "$sotto_schema_status"' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
${encoded ? `printf '%s' ${shellQuote(encoded)} | base64 -d > "$sotto_schema_dir/schema.json" || exit 75` : ''}
${prepareImages}
exec 3<&0
${remote} ${schemaArg} ${imageArgs} <&3 3<&- &
sotto_schema_child=$!
exec 3<&-
wait "$sotto_schema_child"
sotto_schema_status=$?
sotto_schema_child=
exit "$sotto_schema_status"`;
  }
  return { command: 'ssh', args: [...sshOptions(), '-T', sshHost, remote] };
}
