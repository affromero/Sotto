import { describe, it, expect } from 'vitest';
import { classifyError, isKeyInvalidationError, userMessage } from '@/lib/byok-errors';

describe('classifyError', () => {
  // Fetch-based TTS providers: "ElevenLabs API error (401): ..."
  it('classifies fetch-based 401 as auth_invalid', () => {
    expect(classifyError('ElevenLabs API error (401): Unauthorized')).toBe('auth_invalid');
  });

  it('classifies fetch-based 403 as auth_invalid', () => {
    expect(classifyError('Cartesia API error (403): Forbidden')).toBe('auth_invalid');
  });

  it('classifies fetch-based 402 as insufficient_credits', () => {
    expect(classifyError('ElevenLabs API error (402): Payment Required')).toBe('insufficient_credits');
  });

  it('classifies fetch-based 429 as rate_limited', () => {
    expect(classifyError('PlayHT API error (429): Too Many Requests')).toBe('rate_limited');
  });

  it('classifies fetch-based 500 as provider_error', () => {
    expect(classifyError('Hume API error (500): Internal Server Error')).toBe('provider_error');
  });

  it('classifies fetch-based 503 as provider_error', () => {
    expect(classifyError('ElevenLabs API error (503): Service Unavailable')).toBe('provider_error');
  });

  // OpenAI SDK: "401 Unauthorized"
  it('classifies OpenAI SDK 401 as auth_invalid', () => {
    expect(classifyError('401 Unauthorized')).toBe('auth_invalid');
  });

  it('classifies OpenAI SDK 429 as rate_limited', () => {
    expect(classifyError('429 Rate limit exceeded')).toBe('rate_limited');
  });

  it('classifies OpenAI SDK 500 as provider_error', () => {
    expect(classifyError('500 Internal Server Error')).toBe('provider_error');
  });

  // Anthropic SDK substrings
  it('classifies authentication_error as auth_invalid', () => {
    expect(classifyError('Error: authentication_error - Invalid API key')).toBe('auth_invalid');
  });

  it('classifies invalid_api_key as auth_invalid', () => {
    expect(classifyError('invalid_api_key: The provided API key is not valid')).toBe('auth_invalid');
  });

  it('classifies rate_limit_error as rate_limited', () => {
    expect(classifyError('rate_limit_error: Too many requests')).toBe('rate_limited');
  });

  it('classifies insufficient credits message as insufficient_credits', () => {
    expect(classifyError('Your account has insufficient credits')).toBe('insufficient_credits');
  });

  it('classifies quota exceeded as insufficient_credits', () => {
    expect(classifyError('Quota exceeded for this billing period')).toBe('insufficient_credits');
  });

  it('classifies balance message as insufficient_credits', () => {
    expect(classifyError('Account balance too low')).toBe('insufficient_credits');
  });

  // Unknown
  it('returns unknown for empty string', () => {
    expect(classifyError('')).toBe('unknown');
  });

  it('returns unknown for unrecognized errors', () => {
    expect(classifyError('Some random network error')).toBe('unknown');
  });

  it('returns unknown for generic timeout', () => {
    expect(classifyError('Request timed out after 30000ms')).toBe('unknown');
  });
});

describe('isKeyInvalidationError', () => {
  it('returns true for auth_invalid', () => {
    expect(isKeyInvalidationError('auth_invalid')).toBe(true);
  });

  it('returns true for insufficient_credits', () => {
    expect(isKeyInvalidationError('insufficient_credits')).toBe(true);
  });

  it('returns false for rate_limited', () => {
    expect(isKeyInvalidationError('rate_limited')).toBe(false);
  });

  it('returns false for provider_error', () => {
    expect(isKeyInvalidationError('provider_error')).toBe(false);
  });

  it('returns false for unknown', () => {
    expect(isKeyInvalidationError('unknown')).toBe(false);
  });
});

describe('userMessage', () => {
  it('returns key invalid message for auth_invalid', () => {
    const msg = userMessage('auth_invalid', 'ElevenLabs');
    expect(msg).toContain('ElevenLabs');
    expect(msg).toContain('invalid');
  });

  it('returns credits message for insufficient_credits', () => {
    const msg = userMessage('insufficient_credits', 'OpenAI');
    expect(msg).toContain('OpenAI');
    expect(msg).toContain('insufficient credits');
  });

  it('returns rate limit message for rate_limited', () => {
    const msg = userMessage('rate_limited', 'Anthropic');
    expect(msg).toContain('Anthropic');
    expect(msg).toContain('Rate limited');
  });

  it('returns provider issues message for provider_error', () => {
    const msg = userMessage('provider_error', 'Cartesia');
    expect(msg).toContain('Cartesia');
    expect(msg).toContain('issues');
  });

  it('returns generic message for unknown', () => {
    const msg = userMessage('unknown', 'whatever');
    expect(msg).toBe('Generation failed. Please try again.');
  });
});
