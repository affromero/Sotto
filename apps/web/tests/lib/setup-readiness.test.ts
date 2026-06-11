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
      selectedAiProvider: 'openai',
      selectedTtsProvider: 'openai',
      selectedSttProvider: 'openai',
      env: { OPENAI_API_KEY: 'sk-test' },
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.nextAction).toBeNull();
  });

  it('marks agent ingestion ready without requiring STT', () => {
    const readiness = buildSetupReadiness({
      hasDatabase: true,
      hasQueue: true,
      storageProvider: 'local',
      aiProviders: [{ provider: 'openai', isValid: true }],
      ttsProviders: [{ provider: 'openai', isValid: true }],
      sttProviders: [],
      selectedAiProvider: 'openai',
      selectedTtsProvider: 'openai',
      env: {},
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.nextAction).toBeNull();
    expect(readiness.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'agent-ingestion',
          status: 'ready',
        }),
        expect.objectContaining({
          id: 'stt',
          status: 'optional',
          required: false,
        }),
      ])
    );
  });

  it('does not mark another configured AI key ready when an explicit provider is selected', () => {
    const readiness = buildSetupReadiness({
      hasDatabase: true,
      hasQueue: true,
      storageProvider: 'local',
      aiProviders: [{ provider: 'openai', isValid: true }],
      ttsProviders: [{ provider: 'openai', isValid: true }],
      sttProviders: [{ provider: 'openai', isValid: true }],
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

  it('treats Claude Code as a local generation provider when its CLI is available', () => {
    const readiness = buildSetupReadiness({
      hasDatabase: true,
      hasQueue: true,
      storageProvider: 'local',
      aiProviders: [],
      ttsProviders: [{ provider: 'openai', isValid: true }],
      sttProviders: [{ provider: 'openai', isValid: true }],
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

  it('does not require STT before marking transcript-based onboarding ready', () => {
    const readiness = buildSetupReadiness({
      hasDatabase: true,
      hasQueue: true,
      storageProvider: 'local',
      aiProviders: [{ provider: 'openai', isValid: true }],
      ttsProviders: [{ provider: 'openai', isValid: true }],
      sttProviders: [{ provider: 'openai', isValid: true }],
      selectedAiProvider: 'openai',
      selectedTtsProvider: 'openai',
      env: {},
    });
    const stt = readiness.capabilities.find((capability) => capability.id === 'stt');

    expect(readiness.ready).toBe(true);
    expect(stt?.status).toBe('optional');
    expect(stt?.detail).toBe(
      'Transcript ingestion works without STT. Add STT only for speaking-practice scoring or raw audio imports.'
    );
    expect(stt?.required).toBe(false);
    expect(readiness.nextAction).toBeNull();
  });

  it('flags a selected STT provider key without blocking transcript-only onboarding', () => {
    const readiness = buildSetupReadiness({
      hasDatabase: true,
      hasQueue: true,
      storageProvider: 'local',
      aiProviders: [{ provider: 'openai', isValid: true }],
      ttsProviders: [{ provider: 'openai', isValid: true }],
      sttProviders: [{ provider: 'openai', isValid: true }],
      selectedAiProvider: 'openai',
      selectedTtsProvider: 'openai',
      selectedSttProvider: 'deepgram',
      env: {},
    });
    const stt = readiness.capabilities.find((capability) => capability.id === 'stt');

    expect(readiness.ready).toBe(true);
    expect(stt?.status).toBe('action_required');
    expect(stt?.detail).toBe('Add the deepgram STT key.');
    expect(stt?.required).toBe(false);
    expect(readiness.nextAction).toBeNull();
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
