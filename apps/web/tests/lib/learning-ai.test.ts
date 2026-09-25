/**
 * Unit tests for src/lib/learning-ai.ts — the AI resolver shared by every
 * language-learning generator (placement, classes, listening, speaking,
 * curriculum). Verifies behavior across the two supported paths:
 *  - BYOK: the learner's stored key wins, model comes from the registry.
 *  - Local agent: no key + shared provider config → no-key claude-code path.
 *  - Local server: no key + shared local config → keyless "local:<model>" path.
 *  - Neither available → a clear, actionable error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetAiKey = vi.fn();
vi.mock('@/lib/byok', () => ({
  getAiKey: (...args: unknown[]) => mockGetAiKey(...args),
}));

const mockGetAiProviderMeta = vi.fn();
const mockGetProviderForModel = vi.fn();
vi.mock('@/lib/providers/ai-registry', () => ({
  getAiProviderMeta: (...args: unknown[]) => mockGetAiProviderMeta(...args),
  getProviderForModel: (...args: unknown[]) => mockGetProviderForModel(...args),
  providerRequiresAiKey: (provider: string) =>
    !['claude-code', 'codex', 'local'].includes(provider),
}));

vi.mock('@/lib/prisma', () => ({ prismaUnfiltered: {} }));
vi.mock('@/lib/providers/ai', () => ({ aiProviderRules: () => [] }));

const mockGetSiteConfig = vi.fn();
vi.mock('@/lib/site-config', () => ({
  getSiteConfig: (...args: unknown[]) => mockGetSiteConfig(...args),
}));

const mockGetAutoModelConfig = vi.fn();
vi.mock('@/lib/auto-model-config', () => ({
  getAutoModelConfig: (...args: unknown[]) => mockGetAutoModelConfig(...args),
  resolveDisabledSystemAiProviders: (config: { disabledSystemProviders?: string[] }) =>
    new Set(config.disabledSystemProviders ?? []),
}));

vi.mock('@/lib/sidedoor/access/state/transaction', () => ({
  sottoTransaction: (_database: unknown, operation: (database: object) => unknown) =>
    operation({ user: { findUnique: () => mockGetLearnerPreference() } }),
}));

const mockGetLearnerPreference = vi.fn();
const mockGetModerationCredential = vi.fn();
const mockAuthenticatedFetch = vi.fn();

vi.mock('@/lib/sidedoor/credentials/runtime/provider-execution', () => ({
  createSottoProviderTransport: async () => ({ authenticatedFetch: mockAuthenticatedFetch }),
}));

vi.mock('@/lib/sidedoor/credentials/runtime/credential-execution', () => ({
  captureSottoExecutionCredential: () => mockGetModerationCredential(),
  capturePreferredSottoExecutionCredential: async () => {
    const selected = await mockGetAiKey();
    if (!selected) return null;
    return {
      provider: selected.provider,
      recipient: { userId: 'user-1' },
      binding: { endpoint: selected.endpoint },
      selected: { credential: { values: { apiKey: selected.apiKey } } },
    };
  },
  sottoExecutionCredentialFields: (credential: {
    selected: { credential: { values: { apiKey: string } } };
  }) => ({ apiKey: credential.selected.credential.values.apiKey, extraData: {} }),
}));

import { capturedLearningAiOptions, resolveCapturedLearningAi } from '@/lib/learning-ai';
import { blockedProviderExecution } from '../helpers/runtime/provider-execution';

async function resolveLearningAi(userId: string) {
  const resolved = await resolveCapturedLearningAi(userId, {
    ...blockedProviderExecution(userId),
    authorize: async () => ({ userId }),
  });
  return { provider: resolved.provider, model: resolved.model, apiKey: resolved.apiKey };
}

// Default: configured AI provider differs from the BYOK provider, so the BYOK
// branch falls back to the provider's registry default model. Individual tests
// override this to exercise the configured-model path.
function stubAutoConfig(
  aiProvider = 'anthropic',
  aiModel = 'claude-sonnet-4-6',
  disabledSystemProviders: string[] = []
) {
  mockGetAutoModelConfig.mockResolvedValue({
    model: { aiProvider, aiModel },
    disabledSystemProviders,
  });
}

function stubInfra(
  aiProvider: string | null = null,
  aiModel: string | null = null,
  aiBaseUrl: string | null = null
) {
  mockGetSiteConfig.mockResolvedValue({ aiProvider, aiModel, aiBaseUrl });
}

describe('resolveLearningAi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubAutoConfig();
    stubInfra();
    mockGetLearnerPreference.mockResolvedValue(null);
    mockGetModerationCredential.mockResolvedValue(null);
    mockGetProviderForModel.mockImplementation((id: string) =>
      id?.startsWith('claude-code:')
        ? 'claude-code'
        : id?.startsWith('codex')
          ? 'codex'
          : id?.startsWith('claude')
            ? 'anthropic'
            : id?.startsWith('gpt')
              ? 'openai'
              : null
    );
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

  it('uses the owner-configured model when it matches the BYOK provider', async () => {
    mockGetAiKey.mockResolvedValue({ provider: 'anthropic', apiKey: 'sk-ant-123' });
    // Configured default for anthropic is a non-default model the owner picked.
    stubAutoConfig('anthropic', 'claude-opus-4-6');
    mockGetAiProviderMeta.mockReturnValue({ defaultModel: 'claude-haiku-4-5-20251001' });

    const resolved = await resolveLearningAi('user-1');

    // The configured model wins over the registry default.
    expect(resolved).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      apiKey: 'sk-ant-123',
    });
  });

  it('falls back to the registry default when the configured model belongs to another provider', async () => {
    mockGetAiKey.mockResolvedValue({ provider: 'anthropic', apiKey: 'sk-ant-123' });
    // Owner configured an OpenAI model as the default; it must not leak to anthropic.
    stubAutoConfig('openai', 'gpt-5');
    mockGetAiProviderMeta.mockReturnValue({ defaultModel: 'claude-haiku-4-5-20251001' });

    const resolved = await resolveLearningAi('user-1');

    expect(resolved.model).toBe('claude-haiku-4-5-20251001');
  });

  it('throws when the BYOK provider has no default model configured', async () => {
    mockGetAiKey.mockResolvedValue({ provider: 'openai', apiKey: 'sk-user-123' });
    mockGetAiProviderMeta.mockReturnValue({ defaultModel: undefined });

    await expect(resolveLearningAi('user-1')).rejects.toThrow(/default AI model/i);
  });

  it('falls back to the keyless claude-code agent when no BYOK key and AI_PROVIDER=claude-code', async () => {
    mockGetAiKey.mockResolvedValue(null);
    stubInfra('claude-code');
    mockGetAiProviderMeta.mockReturnValue({ defaultModel: 'claude-sonnet-4-6' });

    const resolved = await resolveLearningAi('user-1');

    expect(resolved).toEqual({ provider: 'claude-code', model: 'claude-sonnet-4-6' });
    expect(resolved.apiKey).toBeUndefined();
    expect(mockGetAiProviderMeta).toHaveBeenCalledWith('claude-code');
  });

  it('uses the owner-configured claude-code model (wizard CLI picker) when set', async () => {
    mockGetAiKey.mockResolvedValue(null);
    stubInfra('claude-code');
    stubAutoConfig('claude-code', 'opus');
    mockGetProviderForModel.mockImplementation((id: string) =>
      id === 'opus' ? 'claude-code' : null
    );
    mockGetAiProviderMeta.mockReturnValue({ defaultModel: 'sonnet' });

    const resolved = await resolveLearningAi('user-1');

    // The configured claude-code model wins over the registry default.
    expect(resolved).toEqual({ provider: 'claude-code', model: 'claude-code:opus' });
  });

  it('uses the owner-configured codex model and effort when AI_PROVIDER=codex', async () => {
    mockGetAiKey.mockResolvedValue(null);
    stubInfra('codex');
    stubAutoConfig('codex', 'codex:gpt-5.5#effort=xhigh');

    const resolved = await resolveLearningAi('user-1');

    expect(resolved).toEqual({ provider: 'codex', model: 'codex:gpt-5.5#effort=xhigh' });
    expect(resolved.apiKey).toBeUndefined();
  });

  it('uses explicitly selected Codex even when an OpenAI key is saved', async () => {
    mockGetAiKey.mockResolvedValue({ provider: 'openai', apiKey: 'sk-user-123' });
    mockGetLearnerPreference.mockResolvedValue({
      preferredAiProvider: 'codex',
      preferredAiModel: 'codex:gpt-5.5#effort=xhigh',
    });
    stubInfra('codex');
    stubAutoConfig('codex', 'codex:gpt-5.5#effort=xhigh');

    const resolved = await resolveLearningAi('user-1');

    expect(resolved).toEqual({
      provider: 'codex',
      model: 'codex:gpt-5.5#effort=xhigh',
      apiKey: undefined,
    });
    expect(mockGetAiKey).not.toHaveBeenCalled();
  });

  it('sends the captured OpenAI key with moderation requests', async () => {
    mockGetModerationCredential.mockResolvedValue({
      selected: { credential: { values: { apiKey: 'sk-moderation' } } },
    });
    mockAuthenticatedFetch.mockResolvedValue(new Response('{}'));

    const options = await capturedLearningAiOptions({
      provider: 'codex',
      model: 'codex',
      execution: { userId: 'user-1', authorize: async () => ({ userId: 'user-1' }) },
    });
    await options.moderation?.fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
    });

    const init = mockAuthenticatedFetch.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer sk-moderation');
  });

  it('honors the owner-selected keyless provider over the infra AI_PROVIDER', async () => {
    // Regression: switching to claude-code in Settings writes AutoModelConfig,
    // but the onboarding-era infra AI_PROVIDER=codex kept winning, so the
    // change silently did nothing and codex was still invoked.
    mockGetAiKey.mockResolvedValue(null);
    stubInfra('codex');
    stubAutoConfig('claude-code', 'claude-code:sonnet');
    mockGetProviderForModel.mockImplementation((id: string) =>
      id === 'claude-code:sonnet' ? 'claude-code' : null
    );
    mockGetAiProviderMeta.mockReturnValue({ defaultModel: 'sonnet' });

    const resolved = await resolveLearningAi('user-1');

    expect(resolved).toEqual({ provider: 'claude-code', model: 'claude-code:sonnet' });
  });

  it('uses the shared Codex model when Codex is selected without an owner model', async () => {
    mockGetAiKey.mockResolvedValue(null);
    stubInfra('codex', 'gpt-5.5');

    const resolved = await resolveLearningAi('user-1');

    expect(resolved).toEqual({ provider: 'codex', model: 'codex:gpt-5.5' });
  });

  it('does not use claude-code when the admin disabled it', async () => {
    mockGetAiKey.mockResolvedValue(null);
    stubInfra('claude-code');
    stubAutoConfig('anthropic', 'claude-sonnet-4-6', ['claude-code']);

    await expect(resolveLearningAi('user-1')).rejects.toThrow(/Claude Code is disabled/);
  });

  it('falls back to a keyless local server when no BYOK key and AI_PROVIDER=local', async () => {
    mockGetAiKey.mockResolvedValue(null);
    stubInfra('local', 'qwen3', 'http://localhost:11434/v1');

    const resolved = await resolveLearningAi('user-1');

    // Model carries the "local:" prefix so the llm.ts router/createAIProvider
    // dispatch to the local provider without the registry guardrail.
    expect(resolved).toEqual({ provider: 'local', model: 'local:qwen3' });
    expect(resolved.apiKey).toBeUndefined();
    // The local path resolves the model from shared configuration, not the registry.
    expect(mockGetAiProviderMeta).not.toHaveBeenCalled();
  });

  it('throws when the shared local model is missing', async () => {
    mockGetAiKey.mockResolvedValue(null);
    stubInfra('local', null, 'http://localhost:11434/v1');

    await expect(resolveLearningAi('user-1')).rejects.toThrow(/local model/i);
  });

  it('throws when the shared local endpoint is missing', async () => {
    mockGetAiKey.mockResolvedValue(null);
    stubInfra('local', 'qwen3');

    await expect(resolveLearningAi('user-1')).rejects.toThrow(/local AI endpoint/i);
  });

  it('throws an actionable error when no BYOK key and no local agent configured', async () => {
    mockGetAiKey.mockResolvedValue(null);
    stubInfra('openai');

    await expect(resolveLearningAi('user-1')).rejects.toThrow(/select a local CLI|add an API key/i);
  });
});
