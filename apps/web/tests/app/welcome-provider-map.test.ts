/**
 * providerMap: the welcome wizard's display IDs -> real backend registry/infra
 * IDs, plus per-key store routing. Guards the translation the persistence layer
 * depends on (whisper->local, assembly->assemblyai, claude/codex->anthropic/
 * openai or keyless claude-code, ElevenLabs STT key -> BYOK store).
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LOCAL_STT_BASE_URL,
  DEFAULT_LOCAL_TTS_BASE_URL,
  resolveAi,
  resolveTts,
  resolveStt,
} from '@/app/welcome/providerMap';

describe('resolveAi', () => {
  it('maps claude + key to a BYOK anthropic key (AI-key store)', () => {
    const r = resolveAi('claude', 'key', 'sk-ant-xxx', '');
    expect(r.keyPost).toEqual({ endpoint: 'ai-keys', provider: 'anthropic', apiKey: 'sk-ant-xxx' });
    expect(r.preferredAiProvider).toBe('anthropic');
    expect(r.infra).toEqual({});
  });

  it('maps codex + key to a BYOK openai key', () => {
    const r = resolveAi('codex', 'key', 'sk-xxx', '');
    expect(r.keyPost).toEqual({ endpoint: 'ai-keys', provider: 'openai', apiKey: 'sk-xxx' });
    expect(r.preferredAiProvider).toBe('openai');
  });

  it('maps google + key to a BYOK google key (unlocks live translation)', () => {
    const r = resolveAi('google', 'key', 'AIza-xxx', '');
    expect(r.keyPost).toEqual({ endpoint: 'ai-keys', provider: 'google', apiKey: 'AIza-xxx' });
    expect(r.preferredAiProvider).toBe('google');
  });

  it('maps the CLI method to the keyless claude-code backend (no key, infra set)', () => {
    const r = resolveAi('claude', 'cli', '', '');
    expect(r.keyPost).toBeNull();
    expect(r.infra).toEqual({ aiProvider: 'claude-code' });
    expect(r.preferredAiProvider).toBe('claude-code');
  });

  it('maps a local/custom URL to the local provider with base URL + model', () => {
    const r = resolveAi('local', 'url', 'http://localhost:11434/v1', 'qwen3');
    expect(r.keyPost).toBeNull();
    expect(r.infra).toEqual({
      aiProvider: 'local',
      aiBaseUrl: 'http://localhost:11434/v1',
      aiModel: 'qwen3',
    });
    expect(r.preferredAiModel).toBe('local:qwen3');
  });

  it('omits the model from local infra when none was captured', () => {
    const r = resolveAi('custom', 'url', 'https://host/v1', '');
    expect(r.infra).toEqual({ aiProvider: 'local', aiBaseUrl: 'https://host/v1' });
    expect(r.infra.aiModel).toBeUndefined();
    expect(r.preferredAiModel).toBeNull();
  });

  it('resolves to nothing when no method/value is provided', () => {
    const r = resolveAi('claude', null, '', '');
    expect(r.keyPost).toBeNull();
    expect(r.infra).toEqual({});
    expect(r.preferredAiProvider).toBeNull();
  });
});

describe('resolveTts', () => {
  it('maps kokoro to the keyless local provider (infra + base URL, no key)', () => {
    const r = resolveTts('kokoro', '', 'http://localhost:8000');
    expect(r.keyPost).toBeNull();
    expect(r.infra).toEqual({ ttsProvider: 'kokoro', ttsBaseUrl: 'http://localhost:8000' });
    expect(r.preferredTtsProvider).toBe('kokoro');
  });

  it('maps local to the generic keyless sidecar provider', () => {
    const r = resolveTts('local', '', 'http://localhost:8000');
    expect(r.keyPost).toBeNull();
    expect(r.infra).toEqual({ ttsProvider: 'local', ttsBaseUrl: 'http://localhost:8000' });
    expect(r.preferredTtsProvider).toBe('local');
  });

  it('uses the local TTS default when the welcome field is blank', () => {
    const r = resolveTts('local', '', '');
    expect(r.infra).toEqual({ ttsProvider: 'local', ttsBaseUrl: DEFAULT_LOCAL_TTS_BASE_URL });
  });

  it('routes a cloud TTS key to the BYOK store and sets it as the provider', () => {
    const r = resolveTts('elevenlabs', 'xi-key', '');
    expect(r.keyPost).toEqual({ endpoint: 'byok', provider: 'elevenlabs', apiKey: 'xi-key' });
    expect(r.preferredTtsProvider).toBe('elevenlabs');
    expect(r.infra).toEqual({ ttsProvider: 'elevenlabs' });
  });

  it('omits the key post when no cloud TTS key was entered', () => {
    const r = resolveTts('cartesia', '', '');
    expect(r.keyPost).toBeNull();
    expect(r.preferredTtsProvider).toBe('cartesia');
  });
});

describe('resolveStt', () => {
  it('maps whisper to the keyless local STT server (infra + base URL)', () => {
    const r = resolveStt('whisper', '', 'http://localhost:8000/v1');
    expect(r.keyPost).toBeNull();
    expect(r.infra).toEqual({ sttProvider: 'local', sttBaseUrl: 'http://localhost:8000/v1' });
  });

  it('maps the local STT sidecar option to the keyless local STT server', () => {
    const r = resolveStt('local', '', 'http://localhost:8001/v1');
    expect(r.keyPost).toBeNull();
    expect(r.infra).toEqual({ sttProvider: 'local', sttBaseUrl: 'http://localhost:8001/v1' });
  });

  it('uses the local STT default when the welcome field is blank', () => {
    const r = resolveStt('local', '', '');
    expect(r.infra).toEqual({ sttProvider: 'local', sttBaseUrl: DEFAULT_LOCAL_STT_BASE_URL });
  });

  it('remaps the assembly label to the assemblyai provider (AI-key store)', () => {
    const r = resolveStt('assembly', 'aai_key', '');
    expect(r.keyPost).toEqual({ endpoint: 'ai-keys', provider: 'assemblyai', apiKey: 'aai_key' });
    expect(r.infra).toEqual({ sttProvider: 'assemblyai' });
  });

  it('routes an ElevenLabs STT key to the BYOK store (not the AI-key store)', () => {
    const r = resolveStt('elevenlabs', 'xi-key', '');
    expect(r.keyPost).toEqual({ endpoint: 'byok', provider: 'elevenlabs', apiKey: 'xi-key' });
    expect(r.infra).toEqual({ sttProvider: 'elevenlabs' });
  });

  it('routes deepgram/openai STT keys to the AI-key store', () => {
    expect(resolveStt('deepgram', 'dg_k', '').keyPost).toEqual({
      endpoint: 'ai-keys',
      provider: 'deepgram',
      apiKey: 'dg_k',
    });
    expect(resolveStt('openai', 'sk-k', '').keyPost).toEqual({
      endpoint: 'ai-keys',
      provider: 'openai',
      apiKey: 'sk-k',
    });
  });
});
