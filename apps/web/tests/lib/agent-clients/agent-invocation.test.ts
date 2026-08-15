import { afterEach, describe, expect, it } from 'vitest';
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
});
