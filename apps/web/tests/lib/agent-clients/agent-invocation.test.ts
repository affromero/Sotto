import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { buildAgentInvocation, minimalAgentEnvironment, shellQuote } from '@/lib/agent-invocation';

describe('agent invocation', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('passes only base variables and explicitly named provider keys', () => {
    process.env.PATH = '/usr/bin';
    process.env.CODEX_API_KEY = 'codex-secret';
    process.env.DATABASE_URL = 'database-secret';
    process.env.BYOK_ENCRYPTION_KEY = 'encryption-secret';

    const env = minimalAgentEnvironment(['CODEX_API_KEY']);

    expect(env.PATH).toBe('/usr/bin');
    expect(env.CODEX_API_KEY).toBe('codex-secret');
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.BYOK_ENCRYPTION_KEY).toBeUndefined();
  });

  it('quotes direct arguments and scrubs the remote environment', () => {
    const invocation = buildAgentInvocation('codex', ['exec', "it's safe"], 'agent@host', {
      remoteEnvKeys: ['CODEX_HOME', 'CODEX_API_KEY'],
    });

    expect(invocation.command).toBe('ssh');
    expect(invocation.args).toEqual(expect.arrayContaining(['StrictHostKeyChecking=yes', '-T']));
    expect(invocation.args.at(-2)).toBe('agent@host');
    expect(invocation.args.at(-1)).toContain('env -i');
    expect(invocation.args.at(-1)).toContain('CODEX_API_KEY="${CODEX_API_KEY-}"');
    expect(invocation.args.at(-1)).toContain("'codex' 'exec' 'it'\\''s safe'");
  });

  it('rejects invalid remote environment names', () => {
    expect(() =>
      buildAgentInvocation('codex', [], 'agent@host', { remoteEnvKeys: ['BAD-NAME'] })
    ).toThrow('Invalid remote environment key');
  });

  it('escapes embedded quotes', () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });

  it.each([
    { name: 'array', json: '[]' },
    { name: 'null', json: 'null' },
    { name: 'malformed JSON', json: '{' },
    { name: 'oversized JSON', json: 'x'.repeat(1_048_577) },
  ])('rejects $name as a remote schema before invocation', ({ json }) => {
    expect(() =>
      buildAgentInvocation('codex', ['exec', '-'], 'agent@host', {
        remoteOutputSchema: { json, cleanupToken: randomUUID() },
      })
    ).toThrow();
  });

  it.each(['SIGHUP', 'SIGTERM'] as const)(
    'settles the remote child before confirming schema cleanup after %s',
    async (signal) => {
      const directory = mkdtempSync(join(tmpdir(), 'sotto-remote-schema-signal-'));
      writeFileSync(
        join(directory, 'codex'),
        '#!' +
          process.execPath +
          '\n' +
          'const args=process.argv.slice(2);process.stdin.resume();process.stdin.on("end",()=>{' +
          'console.log(JSON.stringify({pid:process.pid,file:args[args.indexOf("--output-schema")+1]}));setInterval(()=>{},1000);});',
        { mode: 0o700 }
      );
      const token = randomUUID();
      const invocation = buildAgentInvocation('codex', ['exec', '-'], 'fixture-host', {
        remoteOutputSchema: { json: '{"type":"object"}', cleanupToken: token },
      });
      const child = spawn('/bin/sh', ['-c', invocation.args.at(-1)!], {
        env: { ...process.env, PATH: directory + ':/usr/bin:/bin', TMPDIR: directory },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      const closed = new Promise((resolve) => child.once('close', resolve));
      const lines = createInterface({ input: child.stdout });
      let state: { pid: number; file: string } | undefined;
      try {
        const ready = new Promise<{ pid: number; file: string }>((resolve, reject) => {
          lines.once('line', (line) => {
            resolve(JSON.parse(line));
          });
          child.once('error', reject);
          child.once('exit', () => {
            if (!state) reject(new Error('Remote child exited before readiness'));
          });
        });
        child.stdin.end('Private prompt');
        state = await ready;
        expect(existsSync(state.file)).toBe(true);
        child.kill(signal);
        await closed;
        expect(() => process.kill(state!.pid, 0)).toThrow();
        expect(existsSync(state.file)).toBe(false);
        expect(stderr.split('\n')).toContain('SOTTO_CODEX_SCHEMA_CLEANED ' + token);
      } finally {
        lines.close();
        if (child.exitCode === null && child.signalCode === null) {
          if (state) {
            try {
              process.kill(state.pid, 'SIGKILL');
            } catch {}
          }
          child.kill('SIGKILL');
        }
        await closed;
        rmSync(directory, { recursive: true, force: true });
      }
    }
  );
});
