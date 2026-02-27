import { describe, it, expect } from 'vitest';
import { mapDirectionToExpression, getSupportedDirections } from '@/lib/tts-expression-mapper';

describe('tts-expression-mapper', () => {
  describe('ElevenLabs', () => {
    it('maps energetic to [excited] tag with Creative stability', () => {
      const result = mapDirectionToExpression('energetic', 'HOST', 'elevenlabs');
      expect(result.elevenlabs?.audioTagPrefix).toBe('[excited] ');
      expect(result.elevenlabs?.stability).toBe(0.0);
    });

    it('maps serious to Robust stability with no tag', () => {
      const result = mapDirectionToExpression('serious', 'EXPERT', 'elevenlabs');
      expect(result.elevenlabs?.audioTagPrefix).toBeUndefined();
      expect(result.elevenlabs?.stability).toBe(1.0);
    });

    it('maps sarcastic to [sarcastic] tag', () => {
      const result = mapDirectionToExpression('sarcastic', 'HOST', 'elevenlabs');
      expect(result.elevenlabs?.audioTagPrefix).toBe('[sarcastic] ');
    });

    it('falls back to raw audio tag for unknown direction', () => {
      const result = mapDirectionToExpression('mysterious', 'HOST', 'elevenlabs');
      expect(result.elevenlabs?.audioTagPrefix).toBe('[mysterious] ');
    });

    it('returns empty for no direction', () => {
      const result = mapDirectionToExpression(undefined, 'HOST', 'elevenlabs');
      expect(result.elevenlabs).toBeUndefined();
    });
  });

  describe('Cartesia', () => {
    it('maps energetic to excited emotion', () => {
      const result = mapDirectionToExpression('energetic', 'HOST', 'cartesia');
      expect(result.cartesia?.emotion).toBe('excited');
    });

    it('maps calm to calm emotion', () => {
      const result = mapDirectionToExpression('calm', 'HOST', 'cartesia');
      expect(result.cartesia?.emotion).toBe('calm');
    });

    it('passes unknown direction as-is for Cartesia to try', () => {
      const result = mapDirectionToExpression('melancholic', 'HOST', 'cartesia');
      expect(result.cartesia?.emotion).toBe('melancholic');
    });

    it('returns empty for no direction', () => {
      const result = mapDirectionToExpression(undefined, 'HOST', 'cartesia');
      expect(result.cartesia).toBeUndefined();
    });
  });

  describe('Hume', () => {
    it('maps energetic to description', () => {
      const result = mapDirectionToExpression('energetic', 'HOST', 'hume');
      expect(result.hume?.description).toBe('energetic, enthusiastic, high-energy delivery');
    });

    it('falls back to speaker baseline when no direction', () => {
      const result = mapDirectionToExpression(undefined, 'HOST', 'hume');
      expect(result.hume?.description).toBe('warm, engaging podcast host');
    });

    it('uses EXPERT baseline', () => {
      const result = mapDirectionToExpression(undefined, 'EXPERT', 'hume');
      expect(result.hume?.description).toBe('knowledgeable, articulate expert');
    });

    it('uses default baseline for unknown speaker', () => {
      const result = mapDirectionToExpression(undefined, undefined, 'hume');
      expect(result.hume?.description).toBe('natural, conversational podcast speaker');
    });

    it('passes unknown direction as-is', () => {
      const result = mapDirectionToExpression('bewildered', 'HOST', 'hume');
      expect(result.hume?.description).toBe('bewildered');
    });
  });

  describe('OpenAI', () => {
    it('maps energetic to instructions', () => {
      const result = mapDirectionToExpression('energetic', 'HOST', 'openai');
      expect(result.openai?.instructions).toContain('high energy');
    });

    it('falls back to speaker baseline when no direction', () => {
      const result = mapDirectionToExpression(undefined, 'HOST', 'openai');
      expect(result.openai?.instructions).toContain('podcast host');
    });

    it('generates generic instruction for unknown direction', () => {
      const result = mapDirectionToExpression('bewildered', 'HOST', 'openai');
      expect(result.openai?.instructions).toBe('Speak with a bewildered tone.');
    });
  });

  describe('providers without expression support', () => {
    it('returns empty params for fal', () => {
      const result = mapDirectionToExpression('energetic', 'HOST', 'fal');
      expect(result).toEqual({});
    });

    it('returns empty params for kittentts', () => {
      const result = mapDirectionToExpression('energetic', 'HOST', 'kittentts');
      expect(result).toEqual({});
    });
  });

  describe('case insensitivity', () => {
    it('handles uppercase direction', () => {
      const result = mapDirectionToExpression('ENERGETIC', 'HOST', 'elevenlabs');
      expect(result.elevenlabs?.audioTagPrefix).toBe('[excited] ');
    });

    it('handles mixed case direction', () => {
      const result = mapDirectionToExpression('Thoughtful', 'HOST', 'cartesia');
      expect(result.cartesia?.emotion).toBe('contemplative');
    });
  });

  describe('getSupportedDirections', () => {
    it('returns an array of direction strings', () => {
      const directions = getSupportedDirections();
      expect(directions.length).toBeGreaterThan(15);
      expect(directions).toContain('energetic');
      expect(directions).toContain('sarcastic');
      expect(directions).toContain('calm');
    });
  });
});
