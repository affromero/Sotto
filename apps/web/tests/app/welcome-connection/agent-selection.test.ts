import { describe, expect, it } from 'vitest';
import { resolveAi } from '@/app/welcome/providerMap';
import { planAgentPersistence } from '@/app/welcome/session/agent-save-plan';

describe('model connection persistence plans', () => {
  it.each(['local', 'custom'])('keeps %s secrets outside shared configuration', (card) => {
    const keyed = resolveAi(
      card,
      'url',
      ' https://model.example/edge/v1 ',
      ' seminar ',
      ' private '
    );
    const anonymous = resolveAi(card, 'url', 'https://model.example/edge/v1', 'seminar');
    expect(keyed.infra).toEqual(anonymous.infra);
    expect(keyed.preferredAiModel).toBe('local:seminar');
    expect(keyed.keyPost).toEqual({
      endpoint: 'ai-keys',
      provider: 'local',
      apiKey: 'private',
      baseUrl: 'https://model.example/edge/v1',
    });
    expect(anonymous.keyPost).toBeNull();
    expect(planAgentPersistence('url', true, true)).toEqual({
      allowed: true,
      steps: ['configuration', 'credentials'],
    });
  });

  it('denies a household learner permission to persist a shared endpoint', () => {
    expect(planAgentPersistence('url', false, true)).toMatchObject({ allowed: false });
    expect(planAgentPersistence('key', false, false)).toEqual({
      allowed: true,
      steps: ['credentials'],
    });
  });

  it('saves cloud credentials before changing an owner default and keeps CLI plans keyless', () => {
    const cloud = resolveAi('codex', 'key', 'owner-key', 'chosen-model');
    expect(cloud.keyPost?.provider).toBe('openai');
    expect(cloud.infra).toEqual({});
    const cli = resolveAi('codex', 'cli', 'unrelated-input', 'codex:chosen-model');
    expect(cli.keyPost).toBeNull();
    expect(cli.preferredAiProvider).toBe('codex');
    expect(planAgentPersistence('cli', true, true)).toEqual({
      allowed: true,
      steps: ['credentials', 'configuration'],
    });
    expect(planAgentPersistence('key', true, false)).toEqual({
      allowed: true,
      steps: ['credentials'],
    });
  });
});
