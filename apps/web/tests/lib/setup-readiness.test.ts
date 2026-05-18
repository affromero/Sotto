import { describe, expect, it } from 'vitest';
import { buildSetupReadiness } from '@/lib/setup-readiness';

describe('buildSetupReadiness', () => {
  it('marks the one-key OpenAI path ready when OpenAI is explicitly selected for generation and TTS', () => {
    const readiness = buildSetupReadiness({
      hasDatabase: true,
      hasQueue: true,
      storageProvider: 'local',
      aiProviders: [],
      ttsProviders: [],
      privateFeedTokenCount: 1,
      selectedAiProvider: 'openai',
      selectedTtsProvider: 'openai',
      env: { OPENAI_API_KEY: 'sk-test' },
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.nextAction).toBeNull();
  });

  it('does not mark another configured AI key ready when an explicit provider is selected', () => {
    const readiness = buildSetupReadiness({
      hasDatabase: true,
      hasQueue: true,
      storageProvider: 'local',
      aiProviders: [{ provider: 'openai', isValid: true }],
      ttsProviders: [{ provider: 'openai', isValid: true }],
      privateFeedTokenCount: 1,
      selectedAiProvider: 'anthropic',
      selectedTtsProvider: 'openai',
      env: {},
    });
    const generation = readiness.capabilities.find((capability) => capability.id === 'generation');

    expect(generation?.status).toBe('action_required');
    expect(generation?.detail).toBe('Add an AI key or choose a local agent.');
    expect(readiness.nextAction?.id).toBe('generation');
  });

  it('requires a private RSS token even when infrastructure and providers are ready', () => {
    const readiness = buildSetupReadiness({
      hasDatabase: true,
      hasQueue: true,
      storageProvider: 'local',
      aiProviders: [{ provider: 'anthropic', isValid: true }],
      ttsProviders: [{ provider: 'elevenlabs', isValid: true }],
      privateFeedTokenCount: 0,
      selectedAiProvider: 'anthropic',
      selectedTtsProvider: 'elevenlabs',
      env: {},
    });
    const privateRss = readiness.capabilities.find((capability) => capability.id === 'private-rss');

    expect(readiness.ready).toBe(false);
    expect(privateRss?.status).toBe('action_required');
    expect(readiness.nextAction?.id).toBe('private-rss');
  });

  it('treats Claude Code as a local generation provider when its CLI is available', () => {
    const readiness = buildSetupReadiness({
      hasDatabase: true,
      hasQueue: true,
      storageProvider: 'local',
      aiProviders: [],
      ttsProviders: [{ provider: 'openai', isValid: true }],
      privateFeedTokenCount: 1,
      selectedAiProvider: 'claude-code:sonnet',
      selectedTtsProvider: 'openai',
      claudeCodeAvailable: true,
      env: {},
    });
    const generation = readiness.capabilities.find((capability) => capability.id === 'generation');

    expect(generation?.status).toBe('ready');
    expect(readiness.ready).toBe(true);
  });

  it('requires the Claude Code CLI when Claude Code is selected', () => {
    const readiness = buildSetupReadiness({
      hasDatabase: true,
      hasQueue: true,
      storageProvider: 'local',
      aiProviders: [],
      ttsProviders: [{ provider: 'openai', isValid: true }],
      privateFeedTokenCount: 1,
      selectedAiProvider: 'claude-code:sonnet',
      selectedTtsProvider: 'openai',
      claudeCodeAvailable: false,
      env: {},
    });
    const generation = readiness.capabilities.find((capability) => capability.id === 'generation');

    expect(generation?.status).toBe('action_required');
    expect(generation?.detail).toBe("Install and authenticate the 'claude' CLI for Claude Code.");
    expect(readiness.nextAction?.id).toBe('generation');
  });

  it('marks unknown storage providers as action required', () => {
    const readiness = buildSetupReadiness({
      hasDatabase: true,
      hasQueue: true,
      storageProvider: 'mystery',
      aiProviders: [{ provider: 'anthropic', isValid: true }],
      ttsProviders: [{ provider: 'elevenlabs', isValid: true }],
      privateFeedTokenCount: 1,
      selectedAiProvider: 'anthropic',
      selectedTtsProvider: 'elevenlabs',
      env: {},
    });
    const storage = readiness.capabilities.find((capability) => capability.id === 'storage');

    expect(readiness.ready).toBe(false);
    expect(storage?.status).toBe('action_required');
    expect(storage?.detail).toBe('Unknown storage provider: mystery');
  });
});
