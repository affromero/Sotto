import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeCodex = vi.fn();
const executeClaudeCode = vi.fn();

vi.mock('@/lib/codex-client', () => ({
  executeCodex,
  streamCodex: async function* () {
    yield 'stream';
  },
}));
vi.mock('@/lib/claude-code-client', () => ({
  executeClaudeCode,
  streamClaudeCode: async function* () {
    yield 'stream';
  },
}));

describe('CLI agent providers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeCodex.mockResolvedValue({ content: 'ok', inputTokens: 0, outputTokens: 0 });
    executeClaudeCode.mockResolvedValue({ content: 'ok', inputTokens: 0, outputTokens: 0 });
  });

  it('propagates per-turn web access to Codex', async () => {
    const { CodexProvider } = await import('@/lib/providers/codex');
    await new CodexProvider().generateResponse('', [{ role: 'user', content: 'Research this' }], {
      model: 'codex:gpt-5.6-sol',
      useWebSearch: true,
    });

    expect(executeCodex).toHaveBeenCalledWith('', 'Research this', {
      model: 'codex:gpt-5.6-sol',
      useWebSearch: true,
    });
  });

  it('rejects Codex images instead of dropping non-text content', async () => {
    const { CodexProvider } = await import('@/lib/providers/codex');
    await expect(
      new CodexProvider().generateResponse('', [
        {
          role: 'user',
          content: [{ type: 'image_url', url: 'data:image/png;base64,aGVsbG8=' }],
        },
      ])
    ).rejects.toThrow('image input is not supported');
    expect(executeCodex).not.toHaveBeenCalled();
  });

  it('preserves Claude image parts for the base64 stdin transport', async () => {
    const { ClaudeCodeProvider } = await import('@/lib/providers/claude-code');
    const image = { type: 'image_url' as const, url: 'data:image/png;base64,aGVsbG8=' };
    await new ClaudeCodeProvider().generateResponse('', [
      { role: 'user', content: [image, { type: 'text', text: 'Describe it' }] },
    ]);

    expect(executeClaudeCode).toHaveBeenCalledWith(
      '',
      'Describe it',
      expect.objectContaining({ images: [image] })
    );
  });
});
