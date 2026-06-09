/**
 * Unit tests for src/lib/learning-ai.ts — the AI resolver shared by every
 * language-learning generator (placement, classes, listening, speaking,
 * curriculum). Verifies behavior across the two supported paths:
 *  - BYOK: the learner's stored key wins, model comes from the registry.
 *  - Local agent: no key + AI_PROVIDER=claude-code → no-key claude-code path.
 *  - Neither available → a clear, actionable error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetAiKey = vi.fn();
vi.mock('@/lib/byok', () => ({
  getAiKey: (...args: unknown[]) => mockGetAiKey(...args),
}));

const mockGetAiProviderMeta = vi.fn();
vi.mock('@/lib/providers/ai-registry', () => ({
  getAiProviderMeta: (...args: unknown[]) => mockGetAiProviderMeta(...args),
}));

import { resolveLearningAi } from '@/lib/learning-ai';

describe('resolveLearningAi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('prefers the learner BYOK key and resolves its model from the registry', async () => {
    mockGetAiKey.mockResolvedValue({ provider: 'openai', apiKey: 'sk-user-123' });
    mockGetAiProviderMeta.mockReturnValue({ defaultModel: 'gpt-5' });

    const resolved = await resolveLearningAi('user-1');

    expect(resolved).toEqual({ provider: 'openai', model: 'gpt-5', apiKey: 'sk-user-123' });
    expect(mockGetAiProviderMeta).toHaveBeenCalledWith('openai');
  });

  it('throws when the BYOK provider has no default model configured', async () => {
    mockGetAiKey.mockResolvedValue({ provider: 'openai', apiKey: 'sk-user-123' });
    mockGetAiProviderMeta.mockReturnValue({ defaultModel: undefined });

    await expect(resolveLearningAi('user-1')).rejects.toThrow(/default AI model/i);
  });

  it('falls back to the keyless claude-code agent when no BYOK key and AI_PROVIDER=claude-code', async () => {
    mockGetAiKey.mockResolvedValue(null);
    vi.stubEnv('AI_PROVIDER', 'claude-code');
    mockGetAiProviderMeta.mockReturnValue({ defaultModel: 'claude-sonnet-4-6' });

    const resolved = await resolveLearningAi('user-1');

    expect(resolved).toEqual({ provider: 'claude-code', model: 'claude-sonnet-4-6' });
    expect(resolved.apiKey).toBeUndefined();
    expect(mockGetAiProviderMeta).toHaveBeenCalledWith('claude-code');
  });

  it('throws an actionable error when no BYOK key and no local agent configured', async () => {
    mockGetAiKey.mockResolvedValue(null);
    vi.stubEnv('AI_PROVIDER', 'openai');

    await expect(resolveLearningAi('user-1')).rejects.toThrow(/AI_PROVIDER=claude-code|add an API key/i);
  });
});
