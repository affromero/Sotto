import { describe, it, expect } from 'vitest';
import { getAllAiProviderClientMeta } from '@/lib/providers/ai-registry';
import { getAllTtsProviderClientMeta } from '@/lib/providers/tts-registry';

describe('AI Provider Client DTO', () => {
  const meta = getAllAiProviderClientMeta();

  it('returns 6 providers and excludes claude-code', () => {
    expect(meta).toHaveLength(6);
    expect(meta.map((m) => m.id)).not.toContain('claude-code');
  });

  it('all providers have non-empty authFields and getApiKeyUrl', () => {
    for (const provider of meta) {
      expect(provider.authFields.length).toBeGreaterThan(0);
      expect(provider.getApiKeyUrl).toBeTruthy();
    }
  });

  it('LLM providers have non-empty models, STT-only providers have empty models', () => {
    const llmProviders = meta.filter((m) => ['anthropic', 'openai', 'google'].includes(m.id));
    const sttOnlyProviders = meta.filter((m) => ['together', 'deepgram', 'assemblyai'].includes(m.id));

    for (const provider of llmProviders) {
      expect(provider.models.length).toBeGreaterThan(0);
    }
    for (const provider of sttOnlyProviders) {
      expect(provider.models).toHaveLength(0);
    }
  });

  it('all providers have a badge and a non-empty description', () => {
    for (const provider of meta) {
      expect(['optional', 'free']).toContain(provider.badge);
      expect(provider.description.length).toBeGreaterThan(0);
    }
  });

  it('DTOs are JSON-serializable', () => {
    const roundtripped = JSON.parse(JSON.stringify(meta));
    expect(roundtripped).toEqual(meta);
  });
});

describe('TTS Provider Client DTO', () => {
  const meta = getAllTtsProviderClientMeta();

  it('returns 7 providers and excludes kittentts', () => {
    expect(meta).toHaveLength(7);
    expect(meta.map((m) => m.id)).not.toContain('kittentts');
  });

  it('all providers have non-empty authFields and getApiKeyUrl', () => {
    for (const provider of meta) {
      expect(provider.authFields.length).toBeGreaterThan(0);
      expect(provider.getApiKeyUrl).toBeTruthy();
    }
  });

  it('exactly one provider is recommended and it is elevenlabs', () => {
    const recommended = meta.filter((m) => m.recommended);
    expect(recommended).toHaveLength(1);
    expect(recommended[0].id).toBe('elevenlabs');
  });

  it('DTOs are JSON-serializable', () => {
    const roundtripped = JSON.parse(JSON.stringify(meta));
    expect(roundtripped).toEqual(meta);
  });
});
