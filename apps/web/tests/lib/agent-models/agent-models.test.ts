import { describe, expect, it } from 'vitest';
import { getAgentModelOptions, normalizeAgentModelId, parseAgentModelId } from '@/lib/agent-models';

describe('agent model selectors', () => {
  it('parses provider, model, and effort from encoded selectors', () => {
    expect(parseAgentModelId('claude-code:claude-fable-5#effort=xhigh')).toEqual({
      provider: 'claude-code',
      model: 'claude-fable-5',
      effort: 'xhigh',
    });
    expect(parseAgentModelId('codex:gpt-5.5#effort=high')).toEqual({
      provider: 'codex',
      model: 'gpt-5.5',
      effort: 'high',
    });
  });

  it('rejects unknown effort values', () => {
    expect(parseAgentModelId('codex:gpt-5.5#effort=extreme')).toBeNull();
  });

  it('normalizes bare configured values into provider-prefixed selectors', () => {
    expect(normalizeAgentModelId('codex', 'gpt-5.5')).toBe('codex:gpt-5.5');
    expect(normalizeAgentModelId('claude-code', 'opus#effort=max')).toBe(
      'claude-code:opus#effort=max'
    );
    expect(normalizeAgentModelId('claude-code', 'claude-code')).toBeNull();
  });

  it('discovers configured Codex models and effort variants from env', () => {
    const models = getAgentModelOptions('codex', {
      env: {
        CODEX_MODELS: 'gpt-5.5,gpt-5.6',
        CODEX_MODEL_REASONING_EFFORTS: 'high,xhigh',
        CODEX_HOME: '/tmp/sotto-missing-codex-home',
      },
    });

    expect(models.map((model) => model.id)).toEqual(
      expect.arrayContaining([
        'codex',
        'codex:gpt-5.5',
        'codex:gpt-5.5#effort=high',
        'codex:gpt-5.6#effort=xhigh',
        'codex:gpt-5.3-codex-spark',
        'codex:gpt-5.5-pro#effort=max',
      ])
    );
    expect(models.find((model) => model.id === 'codex:gpt-5.5-pro')?.displayName).toBe(
      'GPT-5.5 Pro'
    );
  });

  it('discovers configured Claude Code models from env without registry changes', () => {
    const models = getAgentModelOptions('claude-code', {
      env: {
        CLAUDE_CODE_MODELS: 'claude-fable-5',
        CLAUDE_CODE_EFFORTS: 'max',
        CLAUDE_HOME: '/tmp/sotto-missing-claude-home',
      },
    });

    expect(models.map((model) => model.id)).toEqual(
      expect.arrayContaining(['claude-code:claude-fable-5#effort=max'])
    );
  });
});
