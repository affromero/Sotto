import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { ProcessRunner, ProcessExecutionError } from 'thesidedoor-core/runtime/process';
import { interruptibleStream } from 'thesidedoor-core/runtime/stream';
import {
  CodexOutputDecoder,
  CliProtocolError,
  type CliOutputEvent,
} from 'thesidedoor-core/runtime/cli';
import { GenerationUsageError } from 'thesidedoor-core/ai/usage';
import type { TokenUsage } from 'thesidedoor-core/ai';
import { join } from 'path';
import { tmpdir } from 'os';
import { getCodexSshHost, isCodexAvailable } from './agent-availability';
import { buildAgentInvocation, minimalAgentEnvironment } from './agent-invocation';
import { formatAgentModelId, parseAgentModelId, type AgentEffortLevel } from './agent-models/id';
import { installCurrentProviderCredentialSnapshot } from './agent-credentials';

/**
 * Run the selected Codex CLI with the existing read-only execution policy.
 * Local execution prefers its final-answer file. Remote execution collects
 * decoded assistant messages, which can include intermediate messages.
 */

const SANDBOX = ['-s', 'read-only'];
const NO_MCP = ['-c', 'mcp_servers={}'];
const CODEX_ENV_KEYS = ['CODEX_HOME', 'CODEX_API_KEY'];

export { getCodexSshHost, isCodexAvailable };

interface CodexResponse extends TokenUsage {
  content: string;
  model: string;
}

interface CodexOptions {
  signal?: AbortSignal;
  onUsage?: (usage: TokenUsage & { model: string }) => void;
  model?: string;
  timeoutMs?: number;
  effort?: AgentEffortLevel;
  useWebSearch?: boolean;
}

export function codexEnvironment(): NodeJS.ProcessEnv {
  installCurrentProviderCredentialSnapshot('codex');
  return minimalAgentEnvironment(CODEX_ENV_KEYS);
}

/** Resolve the model override, stripping the `codex:` routing prefix. The bare
 * provider id "codex" and an empty value both mean "use Codex's configured default". */
function resolveSelection(opts?: CodexOptions): { model: string; effort?: AgentEffortLevel } {
  const selected =
    (opts?.model && opts.model !== 'codex' ? opts.model : process.env.CODEX_MODEL) ?? '';
  const parsed = parseAgentModelId(selected, 'codex');
  const model = parsed?.model ?? '';
  const effort =
    opts?.effort ??
    parsed?.effort ??
    parseAgentModelId(
      `codex${model ? `:${model}` : ''}#effort=${
        process.env.CODEX_MODEL_REASONING_EFFORT ?? process.env.CODEX_EFFORT ?? ''
      }`
    )?.effort ??
    undefined;
  return effort ? { model, effort } : { model };
}

function codexArgs(
  opts?: CodexOptions,
  outFile?: string,
  selection = resolveSelection(opts)
): {
  args: string[];
  model: string;
  effort?: AgentEffortLevel;
} {
  const { model, effort } = selection;
  const args = [
    'exec',
    '--json',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    ...NO_MCP,
    '-c',
    `web_search=${JSON.stringify(opts?.useWebSearch ? 'live' : 'disabled')}`,
    // Shell snapshots capture the interactive shell environment — useless for
    // stdin-driven exec calls, and snapshot validation crashes codex on
    // busybox /bin/sh inside the alpine containers (exit 1 before any work).
    '-c',
    'features.shell_snapshot=false',
    ...SANDBOX,
    '--skip-git-repo-check',
  ];
  if (outFile) args.push('-o', outFile);
  if (model) args.push('-m', model);
  if (effort) args.push('-c', `model_reasoning_effort="${effort}"`);
  args.push('-');
  return effort ? { args, model, effort } : { args, model };
}

/**
 * Turn a raw codex CLI failure into a message the UI can act on. Route
 * handlers surface `error.message` directly to the learner, so rate limits and
 * auth problems must say what to do (switch model / re-auth), not just dump
 * stderr.
 */
function classifyCodexFailure(code: number | null, stderr: string): string {
  if (/rate.?limit|usage.?limit|too many requests|quota|429/i.test(stderr)) {
    const reset = stderr.match(/try again (?:at|in) ([^.\n]+)/i)?.[1];
    return (
      'The Codex AI provider has hit its usage limit' +
      (reset ? ` (available again ${reset.trim()})` : '') +
      '. Switch to another AI model in Settings, or try again later.'
    );
  }
  if (/unauthorized|authentication|not logged in|401/i.test(stderr)) {
    return 'The Codex AI provider is not authenticated. Re-connect Codex or switch to another AI model in Settings.';
  }
  // Real errors come last in stderr — the head is a version/session banner.
  return `codex: exited with code ${code}: ${stderr.slice(-500)}`;
}

type Selection = ReturnType<typeof resolveSelection>;

function modelIdentity(selection: Selection): string {
  return formatAgentModelId('codex', selection.model || null, selection.effort);
}

class CodexCleanupError extends Error {}

export function isCodexCleanupError(error: unknown): boolean {
  return (
    error instanceof CodexCleanupError ||
    (error instanceof ProcessExecutionError && error.code === 'cleanup_failed')
  );
}

async function releaseOutput(
  directory: string | undefined,
  primary: { error: unknown } | undefined,
  usage: TokenUsage
) {
  if (!directory) return;
  try {
    await rm(directory, { recursive: true, force: true });
  } catch (error) {
    const cleanup = new CodexCleanupError('Codex temporary output cleanup failed', {
      cause: error,
    });
    const failure = primary
      ? new AggregateError([primary.error, cleanup], 'Codex execution and cleanup failed', {
          cause: error,
        })
      : cleanup;
    throw new GenerationUsageError(failure.message, usage, { cause: failure });
  }
}

/** Return the final local answer, or decoded assistant messages over SSH. */
export async function executeCodex(
  systemPrompt: string,
  prompt: string,
  opts?: CodexOptions
): Promise<CodexResponse> {
  opts?.signal?.throwIfAborted();
  const selection = resolveSelection(opts);
  const host = getCodexSshHost();
  let directory: string | undefined;
  let usage: TokenUsage = { inputTokens: null, outputTokens: null };
  let primary: { error: unknown } | undefined;
  try {
    if (!host) directory = await mkdtemp(join(tmpdir(), 'sotto-codex-'));
    const output = directory ? join(directory, 'answer.txt') : undefined;
    let content = '';
    for await (const text of runCodex(
      systemPrompt,
      prompt,
      {
        ...opts,
        onUsage(value) {
          usage = { ...value };
          opts?.onUsage?.({ ...value });
        },
      },
      selection,
      host,
      output
    ))
      content += text;
    if (output) {
      try {
        const final = (await readFile(output, 'utf8')).trim();
        if (final) content = final;
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
    }
    opts?.signal?.throwIfAborted();
    if (!content.trim()) throw new Error('codex: no output produced (empty response)');
    return { ...usage, content: content.trim(), model: modelIdentity(selection) };
  } catch (error) {
    const failure =
      error instanceof GenerationUsageError
        ? error
        : new GenerationUsageError(
            error instanceof Error ? error.message : 'Codex execution failed',
            usage,
            { cause: error }
          );
    primary = { error: failure };
    throw failure;
  } finally {
    await releaseOutput(directory, primary, usage);
  }
}

/** Stream decoded assistant messages with measured usage and settled cancellation. */
export function streamCodex(
  systemPrompt: string,
  prompt: string,
  opts?: CodexOptions
): AsyncGenerator<string> {
  return interruptibleStream(
    (signal) =>
      runCodex(
        systemPrompt,
        prompt,
        { ...opts, signal },
        resolveSelection(opts),
        getCodexSshHost()
      ),
    {
      signal: opts?.signal,
      isCleanupError: isCodexCleanupError,
    }
  );
}

async function* runCodex(
  systemPrompt: string,
  prompt: string,
  opts: CodexOptions,
  selection: Selection,
  host?: string,
  output?: string
): AsyncGenerator<string> {
  opts.signal?.throwIfAborted();
  const { args } = codexArgs(opts, output, selection);
  const invocation = buildAgentInvocation('codex', args, host, { remoteEnvKeys: CODEX_ENV_KEYS });
  const environment = codexEnvironment();
  const decoder = new CodexOutputDecoder(Number.MAX_SAFE_INTEGER);
  let usage: TokenUsage | undefined;
  let stderr = '';
  let stdout = '';
  let failure = '';
  let terminalFailure = false;
  let finished = false;
  let produced = false;
  function* observe(events: Iterable<CliOutputEvent>): Generator<string> {
    for (const event of events) {
      if (event.type === 'usage') {
        usage = { ...event.usage };
        opts.onUsage?.({ ...usage, model: modelIdentity(selection) });
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
      ...invocation,
      environment,
      signal: opts.signal,
      timeoutMs: opts.timeoutMs || 600000,
      input: systemPrompt ? systemPrompt + '\n\n' + prompt : prompt,
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
    yield* observe(decoder.finish());
    if (terminalFailure) throw new Error(classifyCodexFailure(1, diagnostic()));
    if (!produced && !output) throw new Error('codex: no output produced (empty response)');
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
            opts.onUsage?.({ ...usage, model: modelIdentity(selection) });
          }
        }
      } catch {
        /* Preserve the execution failure. */
      }
    }
    let reported = error;
    if (error instanceof ProcessExecutionError && error.code === 'exit_failed')
      reported = new Error(classifyCodexFailure(error.exitCode, diagnostic()), { cause: error });
    if (error instanceof ProcessExecutionError && error.code === 'start_failed')
      reported = new Error("codex: failed to spawn. Is the 'codex' CLI installed?", {
        cause: error,
      });
    if (error instanceof CliProtocolError && diagnostic() !== '(no output)')
      reported = new Error(classifyCodexFailure(1, diagnostic()), { cause: error });
    if (usage)
      throw new GenerationUsageError(
        reported instanceof Error ? reported.message : 'Codex execution failed',
        usage,
        { cause: reported }
      );
    throw reported;
  }
}
