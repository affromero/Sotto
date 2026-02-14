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

    it('accepts nullable preferredHostVoiceId', () => {
      const result = twitterSettingsSchema.safeParse({
        preferredHostVoiceId: null,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.preferredHostVoiceId).toBeNull();
      }
    });

    it('accepts string preferredHostVoiceId', () => {
      const result = twitterSettingsSchema.safeParse({
        preferredHostVoiceId: 'voice-abc-123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.preferredHostVoiceId).toBe('voice-abc-123');
      }
    });

    it('accepts nullable preferredExpertVoiceId', () => {
      const result = twitterSettingsSchema.safeParse({
        preferredExpertVoiceId: null,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.preferredExpertVoiceId).toBeNull();
      }
    });

    it('accepts string preferredExpertVoiceId', () => {
      const result = twitterSettingsSchema.safeParse({
        preferredExpertVoiceId: 'voice-xyz-789',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.preferredExpertVoiceId).toBe('voice-xyz-789');
      }
    });

    it('accepts empty object (all optional)', () => {
      const result = twitterSettingsSchema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.twitterEnabled).toBeUndefined();
        expect(result.data.preferredHostVoiceId).toBeUndefined();
        expect(result.data.preferredExpertVoiceId).toBeUndefined();
      }
    });

    it('accepts all fields together', () => {
      const result = twitterSettingsSchema.safeParse({
        twitterEnabled: true,
        preferredHostVoiceId: 'host-voice-1',
        preferredExpertVoiceId: 'expert-voice-1',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.twitterEnabled).toBe(true);
        expect(result.data.preferredHostVoiceId).toBe('host-voice-1');
        expect(result.data.preferredExpertVoiceId).toBe('expert-voice-1');
      }
    });

    it('accepts partial fields', () => {
      const result = twitterSettingsSchema.safeParse({
        twitterEnabled: false,
        preferredHostVoiceId: 'voice-1',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.twitterEnabled).toBe(false);
        expect(result.data.preferredHostVoiceId).toBe('voice-1');
        expect(result.data.preferredExpertVoiceId).toBeUndefined();
      }
    });

    it('accepts only voice preferences without twitterEnabled', () => {
      const result = twitterSettingsSchema.safeParse({
        preferredHostVoiceId: 'voice-a',
        preferredExpertVoiceId: 'voice-b',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.preferredHostVoiceId).toBe('voice-a');
        expect(result.data.preferredExpertVoiceId).toBe('voice-b');
      }
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

    it('rejects invalid preferredHostVoiceId (number)', () => {
      const result = twitterSettingsSchema.safeParse({
        preferredHostVoiceId: 123,
      });

      expect(result.success).toBe(false);
    });

    it('rejects invalid preferredHostVoiceId (boolean)', () => {
      const result = twitterSettingsSchema.safeParse({
        preferredHostVoiceId: true,
      });

      expect(result.success).toBe(false);
    });

    it('rejects invalid preferredExpertVoiceId (array)', () => {
      const result = twitterSettingsSchema.safeParse({
        preferredExpertVoiceId: ['voice-1'],
      });

      expect(result.success).toBe(false);
    });

    it('rejects invalid preferredExpertVoiceId (object)', () => {
      const result = twitterSettingsSchema.safeParse({
        preferredExpertVoiceId: { id: 'voice-1' },
      });

      expect(result.success).toBe(false);
    });

    it('rejects multiple invalid fields', () => {
      const result = twitterSettingsSchema.safeParse({
        twitterEnabled: 'invalid',
        preferredHostVoiceId: 999,
        preferredExpertVoiceId: false,
      });

      expect(result.success).toBe(false);
    });

  });

  describe('edge cases', () => {
    it('handles undefined voice IDs', () => {
      const result = twitterSettingsSchema.safeParse({
        twitterEnabled: true,
        preferredHostVoiceId: undefined,
        preferredExpertVoiceId: undefined,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.preferredHostVoiceId).toBeUndefined();
        expect(result.data.preferredExpertVoiceId).toBeUndefined();
      }
    });

    it('handles empty string voice IDs', () => {
      const result = twitterSettingsSchema.safeParse({
        preferredHostVoiceId: '',
        preferredExpertVoiceId: '',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.preferredHostVoiceId).toBe('');
        expect(result.data.preferredExpertVoiceId).toBe('');
      }
    });

    it('handles very long voice ID strings', () => {
      const longVoiceId = 'v'.repeat(1000);
      const result = twitterSettingsSchema.safeParse({
        preferredHostVoiceId: longVoiceId,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.preferredHostVoiceId).toBe(longVoiceId);
      }
    });

    it('handles special characters in voice IDs', () => {
      const result = twitterSettingsSchema.safeParse({
        preferredHostVoiceId: 'voice-with-special-chars_!@#$',
        preferredExpertVoiceId: 'voice_123-abc_XYZ',
      });

      expect(result.success).toBe(true);
    });
  });

});
