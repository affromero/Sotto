import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isolatedFixture } from './isolated-fixture';

const executeCodex = vi.fn();
const executeClaudeCode = vi.fn();

vi.mock('@/lib/codex-client', () => ({
  isCodexCleanupError: () => false,
  executeCodex,
  streamCodex: async function* () {
    yield 'stream';
  },
}));
vi.mock('@/lib/claude-code-client', () => ({
  isClaudeCleanupError: () => false,
  executeClaudeCode,
  streamClaudeCode: async function* () {
    yield 'stream';
  },
}));

describe('CLI agent providers', () => {
  it('preserves an explicit isolation requirement at the Codex process boundary', async () => {
    const { CodexProvider } = await import('@/lib/providers/codex');
    const isolated = isolatedFixture();
    executeCodex.mockRejectedValueOnce(new Error('Isolated Codex execution is not supported'));
    await expect(
      new CodexProvider().generateResponse('', [{ role: 'user', content: 'Prepare practice' }], {
        isolated,
      })
    ).rejects.toThrow('Isolated Codex execution is not supported');
    expect(executeCodex).toHaveBeenCalledWith(
      '',
      'Prepare practice',
      expect.objectContaining({ isolated })
    );
  });
  it('keeps isolated authority rejection visible to the Claude caller', async () => {
    const { ClaudeCodeProvider } = await import('@/lib/providers/claude-code');
    const isolated = isolatedFixture();
    executeClaudeCode.mockRejectedValueOnce(new Error('broker authority revoked'));
    await expect(
      new ClaudeCodeProvider().generateResponse(
        '',
        [{ role: 'user', content: 'Prepare practice' }],
        { model: 'claude-code:claude-test-model', isolated }
      )
    ).rejects.toThrow('broker authority revoked');
    expect(executeClaudeCode).toHaveBeenCalledWith(
      '',
      'Prepare practice',
      expect.objectContaining({ isolated })
    );
  });
  beforeEach(() => {
    vi.clearAllMocks();
    executeCodex.mockResolvedValue({
      content: 'ok',
      inputTokens: 20,
      outputTokens: 7,
      model: 'codex:captured#effort=high',
    });
    executeClaudeCode.mockResolvedValue({ content: 'ok', inputTokens: 0, outputTokens: 0 });
  });

  it('propagates per-turn web access to Codex', async () => {
    const { CodexProvider } = await import('@/lib/providers/codex');
    const result = await new CodexProvider().generateResponse(
      '',
      [{ role: 'user', content: 'Research this' }],
      {
        model: 'codex:gpt-5.6-sol',
        useWebSearch: true,
      }
    );

    expect(executeCodex).toHaveBeenCalledWith('', 'Research this', {
      model: 'codex:gpt-5.6-sol',
      useWebSearch: true,
    });
    expect(result).toMatchObject({
      inputTokens: 20,
      outputTokens: 7,
      model: 'codex:captured#effort=high',
    });
  });

  it('preserves images and exercise text at the Codex process boundary', async () => {
    const { CodexProvider } = await import('@/lib/providers/codex');
    const image = { type: 'image_url' as const, url: 'data:image/png;base64,aGVsbG8=' };
    executeCodex.mockImplementationOnce(
      async (system: string, prompt: string, options: { images: unknown }) => ({
        content: JSON.stringify({ system, prompt, images: options.images }),
        inputTokens: 20,
        outputTokens: 7,
        model: 'codex:captured#effort=high',
      })
    );
    const result = await new CodexProvider().generateResponse('Read the marks', [
      { role: 'user', content: [image, { type: 'text', text: 'Interpret this exercise' }] },
    ]);
    expect(JSON.parse(result.content)).toEqual({
      system: 'Read the marks',
      prompt: 'Interpret this exercise',
      images: [image],
    });
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
