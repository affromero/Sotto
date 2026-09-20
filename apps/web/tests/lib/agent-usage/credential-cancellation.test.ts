// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { execFileText, fetchWithTimeout, readJson } from '@/lib/agent-usage/utils';
import { getClaudeUsageProvider } from '@/lib/agent-usage/providers/claude-code';
import { getCodexUsageProvider } from '@/lib/agent-usage/providers/codex';

describe('usage credential read cancellation', () => {
  it('retains caller cancellation through the usage HTTP deadline', async () => {
    const controller = new AbortController();
    const failure = new Error('HTTP canceled');
    const implementation: typeof fetch = async (_input, init) =>
      new Promise((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
      });
    const pending = fetchWithTimeout(
      'https://usage.invalid/',
      { signal: controller.signal },
      10_000,
      implementation
    );
    const rejection = expect(pending).rejects.toBe(failure);
    controller.abort(failure);
    await rejection;
  });
  it.each([getClaudeUsageProvider, getCodexUsageProvider])(
    'rejects a canceled account lookup before reading local credentials',
    async (provider) => {
      const controller = new AbortController();
      const failure = new Error('Account lookup canceled');
      controller.abort(failure);
      await expect(
        provider({
          userId: 'fixture-recipient',
          signal: controller.signal,
          authorize: async () => {
            throw new Error('Canceled lookup must not authorize');
          },
        })
      ).rejects.toBe(failure);
    }
  );

  it('preserves JSON decoding and missing-file behavior while rejecting canceled reads', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'usage-credentials-'));
    try {
      const pathname = join(directory, 'fixture.json');
      await writeFile(pathname, JSON.stringify({ account: 'synthetic' }));
      expect(await readJson(pathname)).toEqual({ account: 'synthetic' });
      expect(await readJson(join(directory, 'absent'))).toBeNull();
      await writeFile(pathname, '{');
      expect(await readJson(pathname)).toBeNull();
      const controller = new AbortController();
      const failure = new Error('Read canceled');
      controller.abort(failure);
      await expect(readJson(pathname, controller.signal)).rejects.toBe(failure);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('interrupts an active credential subprocess and preserves the cancellation reason', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'usage-process-'));
    const controller = new AbortController();
    const failure = new Error('Subprocess canceled');
    const ready = join(directory, 'ready');
    const result = execFileText(
      process.execPath,
      [
        '-e',
        'process.on("SIGTERM", () => {}); require("node:fs").writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)',
        ready,
      ],
      10_000,
      controller.signal
    );
    const rejection = expect(result).rejects.toBe(failure);
    try {
      await expect
        .poll(async () => Number(await readFile(ready, 'utf8')), { timeout: 5000 })
        .toBeGreaterThan(0);
      const pid = Number(await readFile(ready, 'utf8'));
      controller.abort(failure);
      await rejection;
      expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }));
    } finally {
      controller.abort(failure);
      await rejection;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves command output and ordinary command failure behavior', async () => {
    expect(
      await execFileText(process.execPath, ['-e', 'process.stdout.write(" fixture ")'], 5000)
    ).toBe('fixture');
    expect(await execFileText(process.execPath, ['-e', 'process.exit(1)'], 5000)).toBeNull();
  });
});
