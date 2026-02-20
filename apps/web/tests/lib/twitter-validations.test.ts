import { describe, it, expect } from 'vitest';
import { twitterSettingsSchema } from '@/lib/validations';

describe('twitterSettingsSchema', () => {
  describe('valid inputs', () => {
    it('accepts valid twitterEnabled boolean', () => {
      const result = twitterSettingsSchema.safeParse({
        twitterEnabled: true,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.twitterEnabled).toBe(true);
      }
    });

    it('accepts twitterEnabled: false', () => {
      const result = twitterSettingsSchema.safeParse({
        twitterEnabled: false,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.twitterEnabled).toBe(false);
      }
    });

    it('accepts voicePreferences array', () => {
      const result = twitterSettingsSchema.safeParse({
        voicePreferences: [
          { speaker: 'HOST', voiceId: 'voice-abc-123' },
          { speaker: 'EXPERT', voiceId: 'voice-xyz-789' },
        ],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.voicePreferences).toHaveLength(2);
        expect(result.data.voicePreferences![0].speaker).toBe('HOST');
        expect(result.data.voicePreferences![0].voiceId).toBe('voice-abc-123');
      }
    });

    it('accepts empty object (all optional)', () => {
      const result = twitterSettingsSchema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.twitterEnabled).toBeUndefined();
        expect(result.data.voicePreferences).toBeUndefined();
      }
    });

    it('accepts all fields together', () => {
      const result = twitterSettingsSchema.safeParse({
        twitterEnabled: true,
        voicePreferences: [
          { speaker: 'HOST', voiceId: 'host-voice-1' },
          { speaker: 'EXPERT', voiceId: 'expert-voice-1' },
        ],
        preferredTtsProvider: 'elevenlabs',
        preferredAiProvider: 'anthropic',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.twitterEnabled).toBe(true);
        expect(result.data.voicePreferences).toHaveLength(2);
      }
    });

    it('accepts empty voicePreferences array', () => {
      const result = twitterSettingsSchema.safeParse({
        voicePreferences: [],
      });

      expect(result.success).toBe(true);
    });

    it('accepts custom speaker names', () => {
      const result = twitterSettingsSchema.safeParse({
        voicePreferences: [
          { speaker: 'Skeptic', voiceId: 'voice-1' },
          { speaker: 'Narrator', voiceId: 'voice-2' },
        ],
      });

      expect(result.success).toBe(true);
    });
  });

  describe('invalid inputs', () => {
    it('rejects invalid twitterEnabled (non-boolean)', () => {
      const result = twitterSettingsSchema.safeParse({
        twitterEnabled: 'yes',
      });

      expect(result.success).toBe(false);
    });

    it('rejects invalid twitterEnabled (number)', () => {
      const result = twitterSettingsSchema.safeParse({
        twitterEnabled: 1,
      });

      expect(result.success).toBe(false);
    });

    it('rejects voicePreferences with missing speaker', () => {
      const result = twitterSettingsSchema.safeParse({
        voicePreferences: [
          { voiceId: 'voice-1' },
        ],
      });

      expect(result.success).toBe(false);
    });

    it('rejects voicePreferences with empty speaker', () => {
      const result = twitterSettingsSchema.safeParse({
        voicePreferences: [
          { speaker: '', voiceId: 'voice-1' },
        ],
      });

      expect(result.success).toBe(false);
    });

    it('rejects voicePreferences with missing voiceId', () => {
      const result = twitterSettingsSchema.safeParse({
        voicePreferences: [
          { speaker: 'HOST' },
        ],
      });

      expect(result.success).toBe(false);
    });

    it('rejects non-array voicePreferences', () => {
      const result = twitterSettingsSchema.safeParse({
        voicePreferences: 'invalid',
      });

      expect(result.success).toBe(false);
    });

    it('rejects voicePreferences with non-object items', () => {
      const result = twitterSettingsSchema.safeParse({
        voicePreferences: ['voice-1', 'voice-2'],
      });

      expect(result.success).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('accepts voicePreferences with special characters in voiceId', () => {
      const result = twitterSettingsSchema.safeParse({
        voicePreferences: [
          { speaker: 'HOST', voiceId: 'voice-with-special-chars_!@#$' },
        ],
      });

      expect(result.success).toBe(true);
    });

    it('accepts long speaker names up to 50 chars', () => {
      const result = twitterSettingsSchema.safeParse({
        voicePreferences: [
          { speaker: 'A'.repeat(50), voiceId: 'voice-1' },
        ],
      });

      expect(result.success).toBe(true);
    });
  });
});
