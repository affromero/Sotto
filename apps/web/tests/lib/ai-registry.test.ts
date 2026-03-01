import { describe, it, expect } from 'vitest';
import { getCheapestModelForProvider, type AiProviderId } from '@/lib/providers/ai-registry';

describe('getCheapestModelForProvider', () => {
  it('returns fast-tier model for anthropic', () => {
    expect(getCheapestModelForProvider('anthropic')).toBe('claude-haiku-4-5-20251001');
  });

  it('returns fast-tier model for openai', () => {
    expect(getCheapestModelForProvider('openai')).toBe('gpt-5-mini');
  });

  it('returns fast-tier model for groq', () => {
    expect(getCheapestModelForProvider('groq')).toBe('llama-3.1-8b-instant');
  });

  it('returns first model when no fast tier exists (claude-code)', () => {
    expect(getCheapestModelForProvider('claude-code')).toBe('haiku');
  });

  it('returns null for provider with no models', () => {
    expect(getCheapestModelForProvider('deepgram')).toBeNull();
    expect(getCheapestModelForProvider('assemblyai')).toBeNull();
    expect(getCheapestModelForProvider('together')).toBeNull();
  });

  it('returns null for unknown provider', () => {
    expect(getCheapestModelForProvider('nonexistent' as AiProviderId)).toBeNull();
  });
});
