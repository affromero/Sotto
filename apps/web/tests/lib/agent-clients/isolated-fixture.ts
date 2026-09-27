import type { IsolatedClaudeExecution } from '@/lib/agents/isolated/isolated-agent';

export function isolatedFixture(): IsolatedClaudeExecution {
  return {
    image: `example.test/claude@sha256:${'a'.repeat(64)}`,
    cliVersion: '2.1.283',
    executionId: 'test-isolated-execution',
    endpoint: 'https://api.example.test/v1/messages',
    credential: 'synthetic-api-key',
    expiresAt: Date.now() + 60_000,
    maxOutputTokens: 128,
    admit: async () => {},
    authenticatedFetch: fetch,
    recordIdentity: async () => {},
    recordCleanup: async () => {},
  };
}
