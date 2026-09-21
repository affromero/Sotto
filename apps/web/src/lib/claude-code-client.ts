import { ProcessRunner, ProcessExecutionError } from 'thesidedoor-core/runtime/process';
import { interruptibleStream } from 'thesidedoor-core/runtime/stream';
import {
  ClaudeOutputDecoder,
  CliProtocolError,
  type CliOutputEvent,
} from 'thesidedoor-core/runtime/cli';
import { GenerationUsageError } from 'thesidedoor-core/ai/usage';
import type { TokenUsage } from 'thesidedoor-core/ai';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { getClaudeSshHost, isClaudeAvailable } from './agent-availability';
import { buildAgentInvocation, minimalAgentEnvironment } from './agent-invocation';
import { parseAgentModelId, type AgentEffortLevel } from './agent-models/id';
import { logger } from './logger';
import { getAiProviderMeta } from './providers/ai-registry';
import {
  installCurrentProviderCredentialSnapshot,
  supersedesCredentials,
} from './agent-credentials';
import type { ImageContentPart } from './providers/ai';

const CLAUDE_CODE_DEFAULT_MODEL = getAiProviderMeta('claude-code').defaultModel;

export { buildAgentInvocation, shellQuote } from './agent-invocation';
export { getClaudeSshHost, isClaudeAvailable };
export { serializeMessages } from './agent-messages';

/**
 * The shared credentials file that seeds every per-invocation config dir and
 * receives refreshed tokens back. It lives under CLAUDE_HOME when that points
 * at a persistent volume, otherwise in writable /tmp. Cached for the container
 * lifetime.
 */
let _sharedCredentialsPath: string | null | undefined = undefined;

/**
 * The CLI rotates its refresh token on every OAuth refresh and retires the
 * previous one, so CLAUDE_CODE_CREDENTIALS_JSON is a bootstrap seed, never the
 * running state: overwriting a rotated file with the frozen secret leaves the
 * app holding a token the server has already invalidated. Seed only when the
 * secret is newer than what is on disk, which covers both an empty volume and
 * an operator pasting fresh credentials after the stored ones died.
 */
function seedSharedCredentials(credsPath: string, credsJson: string): void {
  if (!supersedesCredentials('claude-code', credsPath, credsJson)) {
    logger.info('claude-code: keeping the rotated credentials over the configured seed');
    return;
  }
  mkdirSync(/* turbopackIgnore: true */ dirname(credsPath), { recursive: true });
  // 0660, not 0600: this volume is shared with the other apps on the host that
  // drive the same login, and they run as a different uid. The directory is
  // setgid to the group they have in common, so the group bit is what makes one
  // lineage possible at all. Still unreadable to anyone outside that group.
  writeFileSync(/* turbopackIgnore: true */ credsPath, credsJson, { mode: 0o660 });
  logger.info('claude-code: seeded credentials from CLAUDE_CODE_CREDENTIALS_JSON');
}

export function resetClaudeRuntimeForTests(): void {
  _sharedCredentialsPath = undefined;
}

function sharedCredentialsPath(): string | null {
  if (_sharedCredentialsPath !== undefined) return _sharedCredentialsPath;

  // CLAUDE_HOME is the durable location (a mounted volume); /tmp only holds the
  // seed for the container's lifetime and loses every refresh on restart.
  const claudeHome = process.env.CLAUDE_HOME;
  const credsJson = process.env.CLAUDE_CODE_CREDENTIALS_JSON;
  if (!claudeHome && !credsJson) {
    _sharedCredentialsPath = null;
    return null;
  }

  const credsPath = join(
    /* turbopackIgnore: true */ claudeHome || '/tmp/claude-runtime/.claude',
    '.credentials.json'
  );
  if (credsJson) {
    try {
      seedSharedCredentials(credsPath, credsJson);
    } catch (err) {
      logger.warn('claude-code: failed to seed the shared credentials file', {
        path: credsPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  _sharedCredentialsPath = credsPath;
  return credsPath;
}

interface InvocationConfig {
  env: NodeJS.ProcessEnv;
  /** Persist refreshed credentials and remove the per-invocation config dir. */
  release: () => void;
}

/**
 * Every claude invocation gets its OWN CLAUDE_CONFIG_DIR: the CLI rewrites its
 * config (.claude.json) on startup, and concurrent processes sharing one config
 * dir corrupt each other's writes ("configuration file not found ... a backup
 * exists", empty-stderr exit 1). The dir is seeded from the shared credentials
 * file; on release, a token the CLI refreshed is copied back (atomic rename,
 * last-writer-wins) so OAuth refresh survives across invocations, then the dir
 * is deleted.
 */
function createInvocationConfig(): InvocationConfig {
  installCurrentProviderCredentialSnapshot('claude-code');
  const env = minimalAgentEnvironment(CLAUDE_ENV_KEYS);
  delete env.CLAUDECODE;

  const shared = sharedCredentialsPath();
  if (!shared) return { env, release: () => {} };

  let dir: string;
  let seeded: string | null = null;
  try {
    dir = mkdtempSync(join(/* turbopackIgnore: true */ tmpdir(), 'claude-cfg-'));
    try {
      copyFileSync(/* turbopackIgnore: true */ shared, join(dir, '.credentials.json'));
      seeded = readFileSync(/* turbopackIgnore: true */ join(dir, '.credentials.json'), 'utf8');
    } catch {
      // No shared credentials file yet (e.g. an empty CLAUDE_HOME volume).
    }
  } catch (err) {
    logger.warn('claude-code: failed to create per-invocation config dir', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { env, release: () => {} };
  }

  if (!seeded) {
    // An isolated config dir with no credentials in it authenticates as nobody
    // ("Not logged in · Please run /login"). Leave the ambient config alone and
    // let the CLI use whatever login the host already has.
    rmSync(/* turbopackIgnore: true */ dir, { recursive: true, force: true });
    return { env, release: () => {} };
  }

  env.CLAUDE_CONFIG_DIR = dir;
  // OAuth subscription credentials exist — do not let a platform Anthropic API
  // key leak into the CLI, or billing silently routes to API credits and an
  // expired OAuth session surfaces as "Credit balance is too low".
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;

  const release = () => {
    const failures: unknown[] = [];
    let temporaryCredentials: string | undefined;
    let temporaryDirectory: string | undefined;
    try {
      const current = readFileSync(
        /* turbopackIgnore: true */ join(dir, '.credentials.json'),
        'utf8'
      );
      if (current !== seeded && supersedesCredentials('claude-code', shared, current)) {
        temporaryDirectory = mkdtempSync(
          join(/* turbopackIgnore: true */ dirname(shared), '.claude-refresh-')
        );
        temporaryCredentials = join(temporaryDirectory, '.credentials.json');
        writeFileSync(/* turbopackIgnore: true */ temporaryCredentials, current, { mode: 0o660 });
        renameSync(/* turbopackIgnore: true */ temporaryCredentials, shared);
        temporaryCredentials = undefined;
        logger.info('claude-code: persisted refreshed OAuth credentials');
      }
    } catch (error) {
      failures.push(error);
    }
    if (temporaryCredentials) {
      try {
        rmSync(/* turbopackIgnore: true */ temporaryCredentials, { force: true });
      } catch (error) {
        failures.push(error);
      }
    }
    if (temporaryDirectory) {
      try {
        rmSync(/* turbopackIgnore: true */ temporaryDirectory, { recursive: true, force: true });
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      rmSync(/* turbopackIgnore: true */ dir, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
    if (failures.length)
      throw new AggregateError(failures, 'Claude credentials could not be persisted or cleaned up');
  };

  return { env, release };
}

interface ClaudeCodeResponse extends TokenUsage {
  content: string;
}

interface ClaudeCodeOptions {
  signal?: AbortSignal;
  onUsage?: (usage: TokenUsage) => void;
  model?: string;
  timeoutMs?: number;
  useWebSearch?: boolean;
  effort?: AgentEffortLevel;
  images?: ImageContentPart[];
}

const CLAUDE_ENV_KEYS = [
  'CLAUDE_HOME',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
];

function buildArgs(
  model: string,
  systemPrompt: string,
  outputFormat: 'text' | 'stream-json',
  opts?: ClaudeCodeOptions
): string[] {
  const tools = opts?.useWebSearch ? 'WebSearch,WebFetch' : '';
  const args = [
    '-p',
    '--safe-mode',
    '--disable-slash-commands',
    '--no-session-persistence',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--tools',
    tools,
    '--permission-mode',
    'dontAsk',
    '--model',
    model,
    '--output-format',
    outputFormat,
  ];
  if (opts?.effort) args.push('--effort', opts.effort);
  if (systemPrompt) args.push('--system-prompt', systemPrompt);
  if (opts?.useWebSearch) {
    args.push('--allowedTools', 'WebSearch,WebFetch');
  }
  if (outputFormat === 'stream-json') {
    args.push('--verbose', '--include-partial-messages');
  }
  if (opts?.images?.length) args.push('--input-format', 'stream-json');
  return args;
}

function claudeStdin(prompt: string, images: ImageContentPart[] = []): string {
  if (images.length === 0) return prompt;
  const content = images.map((image) => {
    const match = image.url.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) {
      throw new Error('Claude Code images must be base64 data URLs (PNG, JPEG, GIF, or WebP).');
    }
    return {
      type: 'image',
      source: { type: 'base64', media_type: match[1], data: match[2] },
    };
  });
  const message = {
    type: 'user',
    message: { role: 'user', content: [...content, { type: 'text', text: prompt }] },
  };
  return `${JSON.stringify(message)}\n`;
}

function resolveSelection(opts?: ClaudeCodeOptions): { model: string; effort?: AgentEffortLevel } {
  const selected = opts?.model || process.env.CLAUDE_CODE_MODEL || CLAUDE_CODE_DEFAULT_MODEL;
  const parsed = parseAgentModelId(selected, 'claude-code');
  const model = parsed?.model || CLAUDE_CODE_DEFAULT_MODEL;
  const effort =
    opts?.effort ??
    parsed?.effort ??
    parseAgentModelId(`claude-code:${model}#effort=${process.env.CLAUDE_CODE_EFFORT ?? ''}`)
      ?.effort ??
    undefined;
  return effort ? { model, effort } : { model };
}

/**
 * Spawn `claude -p` and return the full response.
 * Prompt is piped via stdin to avoid OS argument length limits.
 */
export async function executeClaudeCode(
  systemPrompt: string,
  prompt: string,
  opts?: ClaudeCodeOptions
): Promise<ClaudeCodeResponse> {
  let content = '';
  let usage: TokenUsage = { inputTokens: null, outputTokens: null };
  for await (const text of streamClaudeCode(systemPrompt, prompt, {
    ...opts,
    onUsage(value) {
      usage = { ...value };
      opts?.onUsage?.({ ...value });
    },
  }))
    content += text;
  return { content: opts?.images?.length ? content : content.trim(), ...usage };
}

/** The shared iterator aborts a pending read before waiting for owned cleanup. */
export function streamClaudeCode(
  systemPrompt: string,
  prompt: string,
  opts?: ClaudeCodeOptions
): AsyncGenerator<string> {
  return interruptibleStream(
    (signal) => streamClaudeRaw(systemPrompt, prompt, { ...opts, signal }),
    {
      signal: opts?.signal,
      isCleanupError: isClaudeCleanupError,
    }
  );
}

class ClaudeCleanupError extends Error {}

export function isClaudeCleanupError(error: unknown): boolean {
  return (
    error instanceof ClaudeCleanupError ||
    (error instanceof ProcessExecutionError && error.code === 'cleanup_failed')
  );
}

function releaseInvocation(
  invocation: InvocationConfig,
  primary?: { error: unknown },
  usage?: TokenUsage
) {
  try {
    invocation.release();
  } catch (error) {
    const cleanup = new ClaudeCleanupError('claude-code: credential cleanup failed', {
      cause: error,
    });
    const failure = primary
      ? new AggregateError([primary.error, cleanup], 'Claude execution and cleanup failed', {
          cause: error,
        })
      : cleanup;
    if (usage) throw new GenerationUsageError(failure.message, usage, { cause: failure });
    throw failure;
  }
}

async function* streamClaudeRaw(
  systemPrompt: string,
  prompt: string,
  opts: ClaudeCodeOptions
): AsyncGenerator<string> {
  opts.signal?.throwIfAborted();
  const selection = resolveSelection(opts);
  const args = buildArgs(selection.model, systemPrompt, 'stream-json', {
    ...opts,
    effort: selection.effort,
  });
  const stdin = claudeStdin(prompt, opts.images);
  const { command, args: spawnArgs } = buildAgentInvocation('claude', args, getClaudeSshHost(), {
    remoteEnvKeys: CLAUDE_ENV_KEYS,
  });
  const invocation = createInvocationConfig();
  const decoder = new ClaudeOutputDecoder({ maximumLineChars: Number.MAX_SAFE_INTEGER });
  let usage: TokenUsage | undefined;
  let stderr = '';
  let stdout = '';
  let failure = '';
  let terminalFailure = false;
  let produced = false;
  let finished = false;
  let primary: { error: unknown } | undefined;
  function* observe(events: Iterable<CliOutputEvent>): Generator<string> {
    for (const event of events) {
      if (event.type === 'usage') {
        usage = { ...event.usage };
        opts.onUsage?.({ ...usage });
      }
      if (event.type === 'failure') {
        terminalFailure = true;
        failure = event.message;
      }
      if (event.type === 'text') {
        produced = true;
        yield event.text;
      }
    }
  }
  const diagnostic = () =>
    failure ||
    stderr.trim() ||
    stdout
      .split('\n')
      .filter((line) =>
        /^(?:error:\s*)?(?:not logged in|oauth|failed to authenticate|401|unauthorized|usage limit)/i.test(
          line.trim()
        )
      )
      .join('\n') ||
    '(no output)';
  try {
    for await (const chunk of new ProcessRunner().stream({
      command,
      args: spawnArgs,
      environment: invocation.env,
      input: stdin,
      signal: opts.signal,
      timeoutMs: opts.timeoutMs || 600000,
      maxOutputBytes: Number.MAX_SAFE_INTEGER,
    })) {
      if (chunk.channel === 'stderr') {
        stderr = (stderr + chunk.text).slice(-4000);
        continue;
      }
      stdout = (stdout + chunk.text).slice(0, 4000);
      yield* observe(decoder.push(chunk.text));
    }
    finished = true;
    // Supported older CLI versions may finish after assistant messages.
    yield* observe(decoder.finish(false));
    if (terminalFailure) throw new Error(`claude-code: ${diagnostic()}`);
    if (!produced)
      throw new Error(`claude-code: no output produced (empty response). ${diagnostic()}`);
  } catch (error) {
    if (!finished) {
      try {
        for (const event of decoder.finish(false)) {
          if (event.type === 'failure') {
            terminalFailure = true;
            failure = event.message;
          }
          if (event.type === 'usage') {
            usage = { ...event.usage };
            opts.onUsage?.({ ...usage });
          }
        }
      } catch {
        /* Preserve the execution failure. */
      }
    }
    let reported = error;
    if (error instanceof CliProtocolError && diagnostic() !== '(no output)')
      reported = new Error(`claude-code: ${diagnostic()}`, { cause: error });
    if (error instanceof ProcessExecutionError && error.code === 'exit_failed')
      reported = new Error(`claude-code: exited with code ${error.exitCode}: ${diagnostic()}`, {
        cause: error,
      });
    if (error instanceof ProcessExecutionError && error.code === 'start_failed')
      reported = new Error("claude-code: failed to spawn. Is the 'claude' CLI installed?", {
        cause: error,
      });
    if (usage)
      reported = new GenerationUsageError(
        reported instanceof Error ? reported.message : 'Claude execution failed',
        usage,
        { cause: reported }
      );
    primary = { error: reported };
    throw reported;
  } finally {
    releaseInvocation(invocation, primary, usage);
  }
}
