import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { executeCodex, streamCodex } from '@/lib/codex-client';
import { CodexProvider } from '@/lib/providers/codex';
import { usageFromGenerationError } from 'thesidedoor-core/ai/usage';
import { isolatedFixture } from './isolated-fixture';
import { isDurableQueueCleanupFailure } from '@/lib/sidedoor/jobs/core/durable-queue';

describe('Codex CLI execution', () => {
  it('fails closed when isolation is requested for an unsupported protocol', async () => {
    await expect(executeCodex('System', 'Prompt', { isolated: isolatedFixture() })).rejects.toThrow(
      'Isolated Codex execution is not supported'
    );
  });
  let directory: string;
  let originalEnv: NodeJS.ProcessEnv;
  const done = {
    type: 'turn.completed',
    usage: { input_tokens: 20, cached_input_tokens: 5, output_tokens: 7 },
  };
  const answer = (text: string, id = 'answer') => ({
    type: 'item.completed',
    item: { id, type: 'agent_message', text },
  });
  function executable(body: string, name = 'codex') {
    writeFileSync(
      join(directory, name),
      '#!' +
        process.execPath +
        '\n' +
        'const fs=require("node:fs"); const args=process.argv.slice(2); const output=args.includes("-o") ? args[args.indexOf("-o")+1] : undefined;\n' +
        'let input="";process.stdin.on("data",b=>input+=b);process.stdin.on("end",()=>{\n' +
        body +
        '\n});',
      { mode: 0o700 }
    );
  }
  const event = (value: unknown) => 'console.log(' + JSON.stringify(JSON.stringify(value)) + ');';
  beforeEach(() => {
    originalEnv = process.env;
    directory = mkdtempSync(join(tmpdir(), 'sotto-codex-fixture-'));
    process.env = { NODE_ENV: 'test', PATH: directory, HOME: directory, TMPDIR: directory };
  });
  afterEach(() => {
    process.env = originalEnv;
    rmSync(directory, { recursive: true, force: true });
  });

  it('preserves explicit model, effort, sandbox, search and credential restrictions', async () => {
    process.env.CODEX_API_KEY = 'fixture-key';
    process.env.DATABASE_URL = 'must-not-reach-cli';
    executable(
      'fs.writeFileSync(output,JSON.stringify({args,input,key:process.env.CODEX_API_KEY,database:process.env.DATABASE_URL}));' +
        event(done)
    );
    const response = await executeCodex('System', 'Prompt', { model: 'codex:chosen#effort=xhigh' });
    const request = JSON.parse(response.content);
    expect(request.args).toEqual(
      expect.arrayContaining([
        'exec',
        '--json',
        '--ephemeral',
        '--ignore-user-config',
        '--ignore-rules',
        '-s',
        'read-only',
        '-m',
        'chosen',
        'model_reasoning_effort="xhigh"',
        'features.shell_snapshot=false',
        'mcp_servers={}',
        'web_search="disabled"',
        '--skip-git-repo-check',
      ])
    );
    expect(request.input).toBe('System\n\nPrompt');
    expect(request.key).toBe('fixture-key');
    expect(request.database).toBeUndefined();
    expect(response).toMatchObject({
      inputTokens: 20,
      outputTokens: 7,
      model: 'codex:chosen#effort=xhigh',
    });
    expect(existsSync(request.args[request.args.indexOf('-o') + 1])).toBe(false);
  });

  it('returns the final file instead of intermediate messages', async () => {
    executable(
      event(answer('Intermediate')) + 'fs.writeFileSync(output,"  Final answer  ");' + event(done)
    );
    expect((await executeCodex('', 'Prompt')).content).toBe('Final answer');
  });

  it.each([false, true])(
    'uses decoded messages when the final file is missing or empty (empty %s)',
    async (empty) => {
      executable(
        (empty ? 'fs.writeFileSync(output,"");' : '') +
          event(answer('Decoded answer')) +
          event(done)
      );
      expect((await executeCodex('', 'Prompt')).content).toBe('Decoded answer');
    }
  );

  it('does not conceal invalid final-file I/O with an intermediate answer', async () => {
    executable('fs.mkdirSync(output);' + event(answer('Intermediate')) + event(done));
    const failure = await executeCodex('', 'Prompt').catch((error: unknown) => error);
    expect((failure as Error).message).toMatch(/directory|EISDIR/i);
    expect(usageFromGenerationError(failure)).toMatchObject({ inputTokens: 20, outputTokens: 7 });
  });

  it('captures environment model selection before execution and reports the same identity', async () => {
    process.env.CODEX_MODEL = 'chosen';
    process.env.CODEX_MODEL_REASONING_EFFORT = 'high';
    executable('fs.writeFileSync(output,JSON.stringify(args));' + event(done));
    const response = await new CodexProvider().generateResponse(
      '',
      [{ role: 'user', content: 'Prompt' }],
      {
        model: 'codex',
        onUsage() {
          process.env.CODEX_MODEL = 'different';
          process.env.CODEX_MODEL_REASONING_EFFORT = 'low';
        },
      }
    );
    expect(JSON.parse(response.content)).toEqual(
      expect.arrayContaining(['chosen', 'model_reasoning_effort="high"'])
    );
    expect(response.model).toBe('codex:chosen#effort=high');
  });

  it('enables web search only on explicit request', async () => {
    executable('fs.writeFileSync(output,JSON.stringify(args));' + event(done));
    expect(
      JSON.parse((await executeCodex('', 'Prompt', { useWebSearch: true })).content)
    ).toContain('web_search="live"');
  });

  const jsonSchema = {
    name: 'answer',
    schema: {
      type: 'object',
      properties: { answer: { type: 'string', description: "It's $(echo untrusted) text." } },
      required: ['answer'],
      additionalProperties: false,
    },
  };

  function schemaExecutable() {
    executable(
      'const file=args[args.indexOf("--output-schema")+1];' +
        'const info={schema:JSON.parse(fs.readFileSync(file,"utf8")),file,' +
        'fileMode:fs.statSync(file).mode&511,directoryMode:fs.statSync(require("node:path").dirname(file)).mode&511,' +
        'input,args,key:process.env.CODEX_API_KEY,database:process.env.DATABASE_URL};' +
        'if(output)fs.writeFileSync(output,JSON.stringify(info));else console.log(JSON.stringify({type:"item.completed",item:{id:"answer",type:"agent_message",text:JSON.stringify(info)}}));' +
        event(done)
    );
  }

  it.each([false, true])(
    'supplies the exact private output schema and cleans it up (SSH %s)',
    async (remote) => {
      process.env.PATH = directory + ':/usr/bin:/bin';
      process.env.CODEX_API_KEY = 'fixture-key';
      process.env.DATABASE_URL = 'must-not-reach-cli';
      if (remote) {
        process.env.CODEX_SSH_HOST = 'fixture-host';
        executable(
          'const child=require("node:child_process").spawn("/bin/sh",["-c",args.at(-1)],{stdio:["pipe","inherit","inherit"]});' +
            'child.stdin.end(input);child.on("exit",code=>{process.exitCode=code});',
          'ssh'
        );
      }
      schemaExecutable();
      const response = await new CodexProvider().generateResponse(
        'System',
        [{ role: 'user', content: 'Private prompt' }],
        {
          model: 'codex:chosen#effort=high',
          jsonSchema,
        }
      );
      const request = JSON.parse(response.content);
      expect(request.schema).toEqual(jsonSchema.schema);
      expect(request.fileMode).toBe(0o600);
      expect(request.directoryMode).toBe(0o700);
      expect(request.input).toContain('Private prompt');
      expect(request.args.join(' ')).not.toContain('Private prompt');
      expect(request.key).toBe('fixture-key');
      expect(request.database).toBeUndefined();
      expect(response.model).toBe('codex:chosen#effort=high');
      expect(existsSync(request.file)).toBe(false);
      expect(existsSync(join(request.file, '..'))).toBe(false);
    }
  );

  it('supplies a schema during streaming and removes it after completion', async () => {
    schemaExecutable();
    const chunks: string[] = [];
    for await (const chunk of new CodexProvider().streamResponse(
      '',
      [{ role: 'user', content: 'Prompt' }],
      { jsonSchema }
    ))
      chunks.push(chunk);
    const response = JSON.parse(chunks.join(''));
    expect(response.schema).toEqual(jsonSchema.schema);
    expect(existsSync(response.file)).toBe(false);
  });

  it('preserves schema rejection and measured usage without another invocation', async () => {
    const record = join(directory, 'schema-rejection');
    executable(
      'fs.writeFileSync(' +
        JSON.stringify(record) +
        ',args[args.indexOf("--output-schema")+1],{flag:"wx"});' +
        event(done) +
        'process.stderr.write("Unsupported output schema");process.exitCode=7;'
    );
    const failure = await executeCodex('', 'Prompt', { jsonSchema }).catch(
      (error: unknown) => error
    );
    expect((failure as Error).message).toContain('Unsupported output schema');
    expect(usageFromGenerationError(failure)).toMatchObject({ inputTokens: 20, outputTokens: 7 });
    expect(existsSync(readFileSync(record, 'utf8'))).toBe(false);
  });

  it('reports uncertain remote cleanup even when the lost transport supplied a completed answer', async () => {
    process.env.CODEX_SSH_HOST = 'fixture-host';
    executable(event(answer('Answer')) + event(done), 'ssh');
    const failure = await executeCodex('', 'Prompt', { jsonSchema }).catch(
      (error: unknown) => error
    );
    expect((failure as Error).message).toContain(
      'Remote Codex output schema cleanup could not be confirmed'
    );
    expect(usageFromGenerationError(failure)).toMatchObject({ inputTokens: 20, outputTokens: 7 });
    expect(isDurableQueueCleanupFailure(failure)).toBe(true);
  });

  it('does not retain a remote cleanup fence when SSH could not start', async () => {
    process.env.CODEX_SSH_HOST = 'fixture-host';
    const failure = await executeCodex('', 'Prompt', { jsonSchema }).catch(
      (error: unknown) => error
    );
    expect((failure as Error).message).toContain('failed to spawn');
    expect(isDurableQueueCleanupFailure(failure)).toBe(false);
  });

  it('reaps a cancelled schema stream before deleting its private schema', async () => {
    const record = join(directory, 'cancelled-schema');
    executable(
      'fs.writeFileSync(' +
        JSON.stringify(record) +
        ',JSON.stringify({pid:process.pid,file:args[args.indexOf("--output-schema")+1]}));' +
        event(answer('Ready')) +
        'setInterval(()=>{},1000);'
    );
    const stream = new CodexProvider().streamResponse('', [{ role: 'user', content: 'Prompt' }], {
      jsonSchema,
    });
    expect(await stream.next()).toMatchObject({ value: 'Ready' });
    const state = JSON.parse(readFileSync(record, 'utf8'));
    expect(existsSync(state.file)).toBe(true);
    const pending = stream.next().catch((error: unknown) => error);
    await stream.return(undefined);
    expect(await pending).toBeInstanceOf(Error);
    expect(() => process.kill(state.pid, 0)).toThrow();
    expect(existsSync(state.file)).toBe(false);
  });

  it('retains a cleanup fence when a cancelled SSH stream cannot confirm remote settlement', async () => {
    process.env.CODEX_SSH_HOST = 'fixture-host';
    const record = join(directory, 'cancelled-remote-schema');
    executable(
      'fs.writeFileSync(' +
        JSON.stringify(record) +
        ',JSON.stringify({pid:process.pid}));' +
        event(answer('Ready')) +
        'setInterval(()=>{},1000);',
      'ssh'
    );
    const stream = new CodexProvider().streamResponse('', [{ role: 'user', content: 'Prompt' }], {
      jsonSchema,
    });
    expect(await stream.next()).toMatchObject({ value: 'Ready' });
    const state = JSON.parse(readFileSync(record, 'utf8'));
    const pending = stream.next();
    const results = await Promise.allSettled([pending, stream.return(undefined)]);
    const failures = results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason);
    expect(failures.some(isDurableQueueCleanupFailure)).toBe(true);
    expect(() => process.kill(state.pid, 0)).toThrow();
  });

  it('collects remote JSON messages without sending a local output path or prompt in argv', async () => {
    process.env.CODEX_SSH_HOST = 'fixture-host';
    const record = join(directory, 'remote');
    executable(
      'fs.writeFileSync(' +
        JSON.stringify(record) +
        ',JSON.stringify({args,input}));' +
        event(answer('First', 'first')) +
        event(answer('Second', 'second')) +
        event(done),
      'ssh'
    );
    expect((await executeCodex('System', 'Private prompt')).content).toBe('FirstSecond');
    const request = JSON.parse(readFileSync(record, 'utf8'));
    expect(request.args).toContain('fixture-host');
    expect(request.args.join(' ')).not.toContain("'-o'");
    expect(request.args.join(' ')).not.toContain('Private prompt');
    expect(request.input).toBe('System\n\nPrivate prompt');
  });

  it('streams decoded assistant messages and protects measured usage from callback mutation', async () => {
    executable(
      event(answer('First', 'first')) +
        event({
          type: 'item.completed',
          item: { id: 'reasoning', type: 'reasoning', text: 'Private reasoning' },
        }) +
        event(answer('Second', 'second')) +
        event(done)
    );
    const chunks: string[] = [];
    let inputTokens: number | null = null;
    for await (const text of streamCodex('', 'Prompt', {
      onUsage(usage) {
        inputTokens = usage.inputTokens;
        usage.inputTokens = 999;
      },
    }))
      chunks.push(text);
    expect(chunks.join('')).toBe('FirstSecond');
    expect(inputTokens).toBe(20);
    executable('fs.writeFileSync(output,"Answer");' + event(done));
    expect(
      (
        await executeCodex('', 'Prompt', {
          onUsage(usage) {
            usage.inputTokens = 999;
          },
        })
      ).inputTokens
    ).toBe(20);
  });

  it('preserves measured usage when the process exits unsuccessfully', async () => {
    executable(
      'process.stdout.write(' + JSON.stringify(JSON.stringify(done)) + ');process.exitCode=7;'
    );
    const failure = await executeCodex('', 'Prompt').catch((error: unknown) => error);
    expect((failure as Error).message).toContain('code 7');
    expect(usageFromGenerationError(failure)).toMatchObject({ inputTokens: 20, outputTokens: 7 });
  });

  it.each([
    [
      event({
        type: 'turn.failed',
        error: { message: 'Usage limit reached, try again in 2 hours.' },
      }),
      'Switch to another AI model',
    ],
    ['process.stderr.write("401 unauthorized");process.exitCode=1;', 'Re-connect Codex'],
    ['process.stdout.write("Not logged in");process.exitCode=1;', 'Re-connect Codex'],
    [
      'process.stdout.write(' +
        JSON.stringify(
          JSON.stringify({ type: 'turn.failed', error: { message: 'Quota exhausted' } })
        ) +
        ');process.exitCode=1;',
      'Switch to another AI model',
    ],
    [event(answer('Unconfirmed')), 'completion'],
    ['process.stdout.write("unstructured answer");', 'JSON'],
    [event(done), 'empty response'],
  ])('rejects unusable output with actionable diagnostics (%s)', async (body, message) => {
    executable(body);
    await expect(executeCodex('', 'Prompt')).rejects.toThrow(message);
  });

  it('reports unknown token fields without inventing zero', async () => {
    executable('fs.writeFileSync(output,"Answer");' + event({ type: 'turn.completed', usage: {} }));
    expect(await executeCodex('', 'Prompt')).toMatchObject({
      inputTokens: null,
      outputTokens: null,
    });
  });

  it.each(['client', 'provider', 'factory', 'llm'])(
    'closes a pending %s stream read and reaps the child',
    async (entry) => {
      const pidFile = join(directory, 'pid');
      executable(
        'fs.writeFileSync(' +
          JSON.stringify(pidFile) +
          ',String(process.pid));' +
          event(answer('Ready')) +
          'setInterval(()=>{},1000);'
      );
      const stream =
        entry === 'client'
          ? streamCodex('', 'Prompt')
          : entry === 'factory'
            ? (await import('@/lib/providers/ai'))
                .createAIProvider('codex')
                .streamResponse('', [{ role: 'user', content: 'Prompt' }])
            : entry === 'provider'
              ? new CodexProvider().streamResponse('', [{ role: 'user', content: 'Prompt' }])
              : (await import('@/lib/llm')).streamResponse(
                  '',
                  [{ role: 'user', content: 'Prompt' }],
                  { model: 'codex', skipModeration: true }
                );
      expect(await stream.next()).toMatchObject({ value: 'Ready' });
      const pending = stream.next().catch((error: unknown) => error);
      expect(await stream.return(undefined)).toMatchObject({ done: true });
      expect(await pending).toBeInstanceOf(Error);
      expect(() => process.kill(Number(readFileSync(pidFile, 'utf8')), 0)).toThrow();
    }
  );

  it('reaps a timed out child before returning failure', async () => {
    const pidFile = join(directory, 'pid');
    executable(
      'fs.writeFileSync(' +
        JSON.stringify(pidFile) +
        ',String(process.pid));setInterval(()=>{},1000);'
    );
    await expect(executeCodex('', 'Prompt', { timeoutMs: 2000 })).rejects.toThrow(
      /timed out|timeout/i
    );
    expect(() => process.kill(Number(readFileSync(pidFile, 'utf8')), 0)).toThrow();
  }, 10000);

  it('reports a missing CLI installation', async () => {
    await expect(executeCodex('', 'Prompt')).rejects.toThrow('installed');
  });
});
