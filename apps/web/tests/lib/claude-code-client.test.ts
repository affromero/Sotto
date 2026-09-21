import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  executeClaudeCode,
  streamClaudeCode,
  resetClaudeRuntimeForTests,
  serializeMessages,
  shellQuote,
  buildAgentInvocation,
  getClaudeSshHost,
} from '@/lib/claude-code-client';
import { usageFromGenerationError } from 'thesidedoor-core/ai/usage';

describe('Claude CLI execution', () => {
  let directory: string;
  let originalEnv: NodeJS.ProcessEnv;
  const terminal = {
    type: 'result',
    subtype: 'success',
    usage: {
      input_tokens: 12,
      output_tokens: 5,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
  const assistant = (text: string) => ({
    type: 'assistant',
    message: { content: [{ type: 'text', text }] },
  });
  function executable(body: string, name = 'claude') {
    writeFileSync(join(directory, name), '#!' + process.execPath + '\n' + body, { mode: 0o700 });
  }
  function emit(events: unknown[], before = '') {
    executable(
      before +
        '\nprocess.stdin.resume(); process.stdin.on("end", () => {\n' +
        events
          .map(
            (event) => 'process.stdout.write(' + JSON.stringify(JSON.stringify(event) + '\n') + ');'
          )
          .join('\n') +
        '\n});'
    );
  }
  function seed() {
    const home = join(directory, 'credentials');
    mkdirSync(home);
    process.env.CLAUDE_HOME = home;
    process.env.CLAUDE_CODE_CREDENTIALS_JSON = JSON.stringify({
      claudeAiOauth: { refreshToken: 'seed', refreshTokenExpiresAt: 1000 },
    });
    return home;
  }
  beforeEach(() => {
    originalEnv = process.env;
    directory = mkdtempSync(join(tmpdir(), 'sotto-claude-fixture-'));
    process.env = { NODE_ENV: 'test', PATH: directory, HOME: directory, TMPDIR: directory };
    resetClaudeRuntimeForTests();
  });
  afterEach(() => {
    process.env = originalEnv;
    resetClaudeRuntimeForTests();
    rmSync(directory, { recursive: true, force: true });
  });

  it('keeps a single prompt and labels conversation turns', () => {
    expect(serializeMessages([{ role: 'user', content: 'Hello' }])).toBe('Hello');
    expect(
      serializeMessages([
        { role: 'user', content: 'First' },
        { role: 'assistant', content: 'Reply' },
      ])
    ).toBe('USER: First\n\n---\n\nASSISTANT: Reply');
    expect(
      serializeMessages([
        { role: 'user', content: 'First' },
        { role: 'assistant', content: 'Reply' },
        { role: 'user', content: 'Next' },
      ])
    ).toBe('USER: First\n\n---\n\nASSISTANT: Reply\n\n---\n\nUSER: Next');
  });

  it('sends prompts on stdin and preserves model, effort and tool restrictions', async () => {
    const record = join(directory, 'request.json');
    executable(
      'let input = ""; process.stdin.on("data", b => input += b); process.stdin.on("end", () => {' +
        'require("node:fs").writeFileSync(' +
        JSON.stringify(record) +
        ', JSON.stringify({args:process.argv.slice(2),input}));' +
        'console.log(' +
        JSON.stringify(JSON.stringify(assistant('  Answer  '))) +
        ');' +
        'console.log(' +
        JSON.stringify(JSON.stringify(terminal)) +
        '); });'
    );
    expect(
      await executeClaudeCode('System', 'Private prompt', { model: 'sonnet', effort: 'high' })
    ).toMatchObject({ content: 'Answer', inputTokens: 12, outputTokens: 5 });
    const request = JSON.parse(readFileSync(record, 'utf8'));
    expect(request.input).toBe('Private prompt');
    expect(request.args).toEqual(
      expect.arrayContaining([
        '--model',
        'sonnet',
        '--system-prompt',
        'System',
        '--effort',
        'high',
        '--tools',
        '',
        '--output-format',
        'stream-json',
        '--include-partial-messages',
      ])
    );
    expect(request.args).not.toContain('Private prompt');
  });

  it('reports missing usage as unknown for assistant-only responses', async () => {
    emit([assistant('Answer')]);
    expect(await executeClaudeCode('', 'Prompt')).toEqual({
      content: 'Answer',
      inputTokens: null,
      outputTokens: null,
    });
  });

  it('streams deltas without repeating the assistant summary', async () => {
    emit([
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Hello ' },
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'world' },
        },
      },
      assistant('Hello world'),
      terminal,
    ]);
    const chunks: string[] = [];
    for await (const chunk of streamClaudeCode('', 'Prompt')) chunks.push(chunk);
    expect(chunks.join('')).toBe('Hello world');
  });

  it('ignores unrelated events and decodes split UTF-8 JSON', async () => {
    const bytes = Buffer.from(
      JSON.stringify(assistant('café 🌱')) + '\n' + JSON.stringify(terminal)
    );
    executable(
      'process.stdin.resume(); process.stdin.on("end", async () => {' +
        'console.log(JSON.stringify({type:"system", subtype:"init"}));' +
        'for (const byte of ' +
        JSON.stringify([...bytes]) +
        ') { process.stdout.write(Buffer.from([byte])); await new Promise(resolve => setTimeout(resolve, 1)); }});'
    );
    expect((await executeClaudeCode('', 'Prompt')).content).toBe('café 🌱');
  });

  it('retains usage on a failed terminal result', async () => {
    emit([
      {
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['Quota exhausted'],
        usage: { ...terminal.usage, input_tokens: 0, output_tokens: 1 },
      },
    ]);
    const failure = await executeClaudeCode('', 'Prompt').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('Quota');
    expect(usageFromGenerationError(failure)).toMatchObject({ inputTokens: 0, outputTokens: 1 });
  });

  it('retains terminal failure details without a final newline on unsuccessful exit', async () => {
    const result = {
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      errors: ['Quota exhausted'],
      usage: terminal.usage,
    };
    executable(
      'process.stdin.resume();process.stdin.on("end",()=>{process.stdout.write(' +
        JSON.stringify(JSON.stringify(result)) +
        ');process.exitCode=1;});'
    );
    const failure = await executeClaudeCode('', 'Prompt').catch((error: unknown) => error);
    expect((failure as Error).message).toContain('Quota exhausted');
    expect(usageFromGenerationError(failure)).toMatchObject({ inputTokens: 12, outputTokens: 5 });
  });

  it.each([
    ['process.stderr.write("CLI failed"); process.exit(2);', 'CLI failed'],
    ['process.stdout.write("Not logged in. Please run /login"); process.exit(1);', 'Not logged in'],
    ['process.exit(0);', 'empty response'],
  ])('surfaces CLI failures (%s)', async (body, message) => {
    executable('process.stdin.resume(); process.stdin.on("end", () => {' + body + '});');
    await expect(executeClaudeCode('', 'Prompt')).rejects.toThrow(message);
  });

  it('explains a missing executable', async () => {
    await expect(executeClaudeCode('', 'Prompt')).rejects.toThrow('installed');
  });

  it('isolates concurrent OAuth invocations and excludes API credentials', async () => {
    seed();
    process.env.ANTHROPIC_API_KEY = 'must-not-reach-child';
    process.env.ANTHROPIC_AUTH_TOKEN = 'must-not-reach-child';
    executable(
      'process.stdin.resume(); process.stdin.on("end", () => {' +
        'console.log(JSON.stringify({type:"assistant",message:{content:[{type:"text",text:JSON.stringify({directory:process.env.CLAUDE_CONFIG_DIR,key:process.env.ANTHROPIC_API_KEY,token:process.env.ANTHROPIC_AUTH_TOKEN})}]}})); });'
    );
    const responses = await Promise.all([
      executeClaudeCode('', 'First'),
      executeClaudeCode('', 'Second'),
    ]);
    const records = responses.map((response) => JSON.parse(response.content));
    expect(records[0].directory).not.toBe(records[1].directory);
    for (const record of records) {
      expect(record.key).toBeUndefined();
      expect(record.token).toBeUndefined();
      expect(existsSync(record.directory)).toBe(false);
    }
  });

  it('preserves rotated credentials and persists a newer refresh', async () => {
    const home = seed();
    const rotated = { claudeAiOauth: { refreshToken: 'rotated', refreshTokenExpiresAt: 2000 } };
    writeFileSync(join(home, '.credentials.json'), JSON.stringify(rotated));
    emit([assistant('Answer')]);
    await executeClaudeCode('', 'Prompt');
    expect(JSON.parse(readFileSync(join(home, '.credentials.json'), 'utf8'))).toEqual(rotated);
    const refreshed = { claudeAiOauth: { refreshToken: 'refreshed', refreshTokenExpiresAt: 5000 } };
    emit(
      [assistant('Answer')],
      'require("node:fs").writeFileSync(require("node:path").join(process.env.CLAUDE_CONFIG_DIR, ".credentials.json"), ' +
        JSON.stringify(JSON.stringify(refreshed)) +
        ');'
    );
    await executeClaudeCode('', 'Prompt');
    expect(JSON.parse(readFileSync(join(home, '.credentials.json'), 'utf8'))).toEqual(refreshed);
  });

  it('surfaces credential cleanup failures without losing measured usage', async () => {
    seed();
    emit(
      [assistant('Answer'), terminal],
      'require("node:fs").unlinkSync(require("node:path").join(process.env.CLAUDE_CONFIG_DIR, ".credentials.json"));'
    );
    const failure = await executeClaudeCode('', 'Prompt').catch((error: unknown) => error);
    expect((failure as Error).message).toContain('cleanup');
    expect(usageFromGenerationError(failure)).toMatchObject({ inputTokens: 12, outputTokens: 5 });
  });

  it('quotes remote arguments and trims the SSH host', () => {
    process.env.CLAUDE_CODE_SSH_HOST = '  user@host  ';
    expect(getClaudeSshHost()).toBe('user@host');
    expect(shellQuote("it's private")).toBe("'it'\\''s private'");
    expect(buildAgentInvocation('claude', ['-p'])).toEqual({ command: 'claude', args: ['-p'] });
    const remote = buildAgentInvocation(
      'claude',
      ['--system-prompt', "it's private"],
      getClaudeSshHost()
    );
    expect(remote.command).toBe('ssh');
    expect(remote.args).toContain('user@host');
    expect(remote.args.at(-1)).toContain(shellQuote("it's private"));
  });

  it('sends base64 images as structured stdin and preserves response whitespace', async () => {
    const record = join(directory, 'image-request.json');
    executable(
      'let input = ""; process.stdin.on("data", b => input += b); process.stdin.on("end", () => {' +
        'require("node:fs").writeFileSync(' +
        JSON.stringify(record) +
        ', JSON.stringify({args:process.argv.slice(2),input:JSON.parse(input)}));' +
        'console.log(' +
        JSON.stringify(JSON.stringify(assistant('  Image answer  '))) +
        ');' +
        'console.log(' +
        JSON.stringify(JSON.stringify(terminal)) +
        '); });'
    );
    expect(
      await executeClaudeCode('', 'Describe', {
        images: [{ type: 'image_url', url: 'data:image/png;base64,aGVsbG8=' }],
      })
    ).toMatchObject({ content: '  Image answer  ', inputTokens: 12, outputTokens: 5 });
    const recordValue = JSON.parse(readFileSync(record, 'utf8'));
    expect(recordValue.args).toEqual(
      expect.arrayContaining(['--input-format', 'stream-json', '--tools', ''])
    );
    expect(recordValue.input.message.content).toEqual(
      expect.arrayContaining([
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } },
        { type: 'text', text: 'Describe' },
      ])
    );
  });

  it('rejects remote images before opening the CLI', async () => {
    await expect(
      executeClaudeCode('', 'Describe', {
        images: [{ type: 'image_url', url: 'https://example.com/image.png' }],
      })
    ).rejects.toThrow('base64');
  });

  it('stops a timed out child before returning the failure', async () => {
    const pidPath = join(directory, 'pid');
    executable(
      'require("node:fs").writeFileSync(' +
        JSON.stringify(pidPath) +
        ', String(process.pid)); setInterval(() => {}, 1000);'
    );
    await expect(executeClaudeCode('', 'Prompt', { timeoutMs: 2000 })).rejects.toThrow(
      /timed out|timeout/i
    );
    const pid = Number(readFileSync(pidPath, 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
  }, 10000);

  it.each(['client', 'provider', 'factory', 'llm'])(
    'closes a pending %s stream read and reaps the child',
    async (entry) => {
      const pidPath = join(directory, 'pid');
      executable(
        'require("node:fs").writeFileSync(' +
          JSON.stringify(pidPath) +
          ', String(process.pid));' +
          'console.log(' +
          JSON.stringify(JSON.stringify(assistant('Ready'))) +
          '); setInterval(() => {}, 1000);'
      );
      const stream =
        entry === 'client'
          ? streamClaudeCode('', 'Prompt')
          : entry === 'factory'
            ? (await import('@/lib/providers/ai'))
                .createAIProvider('claude-code')
                .streamResponse('', [{ role: 'user', content: 'Prompt' }])
            : entry === 'provider'
              ? new (
                  await import('@/lib/providers/claude-code')
                ).ClaudeCodeProvider().streamResponse('', [{ role: 'user', content: 'Prompt' }])
              : (await import('@/lib/llm')).streamResponse(
                  '',
                  [{ role: 'user', content: 'Prompt' }],
                  { model: 'claude-code:sonnet', skipModeration: true }
                );
      expect(await stream.next()).toMatchObject({ value: 'Ready' });
      const pending = stream.next().catch((error: unknown) => error);
      expect(await stream.return(undefined)).toMatchObject({ done: true });
      expect(await pending).toBeInstanceOf(Error);
      expect(() => process.kill(Number(readFileSync(pidPath, 'utf8')), 0)).toThrow();
    }
  );

  it('keeps the prompt on stdin when invoking SSH', async () => {
    process.env.CLAUDE_CODE_SSH_HOST = 'fixture-host';
    const record = join(directory, 'ssh-request.json');
    executable(
      'let input = ""; process.stdin.on("data", b => input += b); process.stdin.on("end", () => {' +
        'require("node:fs").writeFileSync(' +
        JSON.stringify(record) +
        ', JSON.stringify({args:process.argv.slice(2),input}));' +
        'console.log(' +
        JSON.stringify(JSON.stringify(assistant('Remote answer'))) +
        '); });',
      'ssh'
    );
    expect((await executeClaudeCode('', 'Private prompt')).content).toBe('Remote answer');
    const request = JSON.parse(readFileSync(record, 'utf8'));
    expect(request.input).toBe('Private prompt');
    expect(request.args).toContain('fixture-host');
    expect(request.args.join(' ')).not.toContain('Private prompt');
  });

  it.each(['client', 'provider', 'factory'])(
    'retains cleanup failure and measured usage when closing a pending %s read',
    async (entry) => {
      seed();
      executable(
        'require("node:fs").unlinkSync(require("node:path").join(process.env.CLAUDE_CONFIG_DIR, ".credentials.json"));' +
          'console.log(' +
          JSON.stringify(JSON.stringify(assistant('Ready'))) +
          ');' +
          'console.log(' +
          JSON.stringify(JSON.stringify(terminal)) +
          '); setInterval(() => {}, 1000);'
      );
      let observed!: () => void;
      const measured = new Promise<void>((resolve) => {
        observed = resolve;
      });
      const stream =
        entry === 'client'
          ? streamClaudeCode('', 'Prompt', { onUsage: () => observed() })
          : entry === 'factory'
            ? (await import('@/lib/providers/ai'))
                .createAIProvider('claude-code')
                .streamResponse('', [{ role: 'user', content: 'Prompt' }], {
                  onUsage: () => observed(),
                })
            : new (await import('@/lib/providers/claude-code')).ClaudeCodeProvider().streamResponse(
                '',
                [{ role: 'user', content: 'Prompt' }],
                { onUsage: () => observed() }
              );
      expect(await stream.next()).toMatchObject({ value: 'Ready' });
      const pending = stream.next().catch((error: unknown) => error);
      await measured;
      const closed = stream.return(undefined).catch((error: unknown) => error);
      const failure = await pending;
      expect(await closed).toBe(failure);
      expect((failure as Error).message).toContain('cleanup');
      expect(usageFromGenerationError(failure)).toMatchObject({ inputTokens: 12, outputTokens: 5 });
    }
  );

  it('protects retained usage from callback mutation', async () => {
    emit([assistant('Answer'), terminal]);
    const response = await executeClaudeCode('', 'Prompt', {
      onUsage: (usage) => {
        usage.inputTokens = 999;
      },
    });
    expect(response.inputTokens).toBe(12);
    emit([
      {
        ...terminal,
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['Quota exhausted'],
      },
    ]);
    const failure = await executeClaudeCode('', 'Prompt', {
      onUsage: (usage) => {
        usage.inputTokens = 999;
      },
    }).catch((error: unknown) => error);
    expect(usageFromGenerationError(failure)?.inputTokens).toBe(12);
  });
});
