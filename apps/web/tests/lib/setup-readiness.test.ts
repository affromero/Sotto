import { describe, expect, it } from 'vitest';
import { buildSetupReadiness, buildSttProviderStatuses } from '@/lib/setup-readiness';

describe('buildSetupReadiness', () => {
  it('marks the one-key OpenAI path ready when OpenAI is explicitly selected for generation, TTS, and STT', () => {
    const readiness = buildSetupReadiness({
      hasDatabase: true,
      hasQueue: true,
      storageProvider: 'local',
      aiProviders: [],
      ttsProviders: [],
      sttProviders: [],
      privateFeedTokenCount: 1,
      selectedAiProvider: 'openai',
      selectedTtsProvider: 'openai',
      selectedSttProvider: 'openai',
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
      sttProviders: [{ provider: 'openai', isValid: true }],
      privateFeedTokenCount: 1,
      selectedAiProvider: 'anthropic',
      selectedTtsProvider: 'openai',
      selectedSttProvider: 'openai',
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
      sttProviders: [{ provider: 'elevenlabs', isValid: true }],
      privateFeedTokenCount: 0,
      selectedAiProvider: 'anthropic',
      selectedTtsProvider: 'elevenlabs',
      selectedSttProvider: 'elevenlabs',
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
      sttProviders: [{ provider: 'openai', isValid: true }],
      privateFeedTokenCount: 1,
      selectedAiProvider: 'claude-code:sonnet',
      selectedTtsProvider: 'openai',
      selectedSttProvider: 'openai',
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
      sttProviders: [{ provider: 'openai', isValid: true }],
      privateFeedTokenCount: 1,
      selectedAiProvider: 'claude-code:sonnet',
      selectedTtsProvider: 'openai',
      selectedSttProvider: 'openai',
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
      sttProviders: [{ provider: 'elevenlabs', isValid: true }],
      privateFeedTokenCount: 1,
      selectedAiProvider: 'anthropic',
      selectedTtsProvider: 'elevenlabs',
      selectedSttProvider: 'elevenlabs',
      env: {},
    });
    const storage = readiness.capabilities.find((capability) => capability.id === 'storage');

    expect(readiness.ready).toBe(false);
    expect(storage?.status).toBe('action_required');
    expect(storage?.detail).toBe('Unknown storage provider: mystery');
  });

  it('requires an explicit STT provider before marking transcription ready', () => {
    const readiness = buildSetupReadiness({
      hasDatabase: true,
      hasQueue: true,
      storageProvider: 'local',
      aiProviders: [{ provider: 'openai', isValid: true }],
      ttsProviders: [{ provider: 'openai', isValid: true }],
      sttProviders: [{ provider: 'openai', isValid: true }],
      privateFeedTokenCount: 1,
      selectedAiProvider: 'openai',
      selectedTtsProvider: 'openai',
      env: {},
    });
    const stt = readiness.capabilities.find((capability) => capability.id === 'stt');

    expect(readiness.ready).toBe(false);
    expect(stt?.status).toBe('action_required');
    expect(stt?.detail).toBe('Set STT_PROVIDER to the transcription provider you want to use.');
    expect(readiness.nextAction?.id).toBe('stt');
  });

  it('requires the selected STT provider key instead of accepting another configured STT key', () => {
    const readiness = buildSetupReadiness({
      hasDatabase: true,
      hasQueue: true,
      storageProvider: 'local',
      aiProviders: [{ provider: 'openai', isValid: true }],
      ttsProviders: [{ provider: 'openai', isValid: true }],
      sttProviders: [{ provider: 'openai', isValid: true }],
      privateFeedTokenCount: 1,
      selectedAiProvider: 'openai',
      selectedTtsProvider: 'openai',
      selectedSttProvider: 'deepgram',
      env: {},
    });
    const stt = readiness.capabilities.find((capability) => capability.id === 'stt');

    expect(readiness.ready).toBe(false);
    expect(stt?.status).toBe('action_required');
    expect(stt?.detail).toBe('Add the deepgram STT key.');
    expect(readiness.nextAction?.id).toBe('stt');
  });

  it('maps STT readiness to the key store the resolver actually reads', () => {
    const sttProviders = buildSttProviderStatuses(
      [
        { provider: 'openai', isValid: true },
        { provider: 'deepgram', isValid: true },
      ],
      [
        { provider: 'openai', isValid: true },
        { provider: 'elevenlabs', isValid: true },
      ]
    );

    expect(sttProviders).toEqual([
      { provider: 'openai', isValid: true },
      { provider: 'deepgram', isValid: true },
      { provider: 'elevenlabs', isValid: true },
    ]);
  });
});
