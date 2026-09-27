import { describe, expect, it } from 'vitest';
import { streamIsolatedClaude } from '@/lib/agents/isolated/isolated-agent';
import { isolatedFixture } from './isolated-fixture';

describe('isolated agent admission', () => {
  it('rejects CLI model aliases before opening a broker', async () => {
    const stream = streamIsolatedClaude({
      execution: isolatedFixture(),
      model: 'sonnet',
      args: [],
      prompt: 'hello',
      timeoutMs: 1000,
    });
    await expect(stream.next()).rejects.toThrow('canonical API model ID');
  });
  it.skipIf(process.platform === 'linux')(
    'rejects unsupported hosts instead of starting a local CLI',
    async () => {
      const stream = streamIsolatedClaude({
        execution: isolatedFixture(),
        model: 'claude-test-model',
        args: [],
        prompt: 'hello',
        timeoutMs: 1000,
      });
      await expect(stream.next()).rejects.toThrow('local Linux Docker host');
    }
  );
});
