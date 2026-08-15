import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAgentStatus = vi.fn();
const discoverCodexModels = vi.fn();

vi.mock('@/lib/agent-availability', () => ({ getAgentStatus }));
vi.mock('@/lib/agent-models/codex-app-server', () => ({ discoverCodexModels }));

describe('agent model offering readiness', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not launch Codex App Server when the CLI is unavailable', async () => {
    getAgentStatus.mockResolvedValue({
      readiness: 'not_installed',
      version: null,
      detail: 'command not found',
    });
    const { getAgentModelOffering } = await import('@/lib/agent-models');

    await expect(getAgentModelOffering('codex')).resolves.toMatchObject({
      source: 'curated',
      error: 'Codex is not installed.',
    });
    expect(discoverCodexModels).not.toHaveBeenCalled();
  });
});
