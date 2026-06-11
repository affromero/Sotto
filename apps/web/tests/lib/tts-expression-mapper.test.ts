import { describe, it, expect } from 'vitest';
import { mapDirectionToExpression, getSupportedDirections, convertInlineAudioTags } from '@/lib/tts-expression-mapper';

describe('tts-expression-mapper', () => {
  describe('ElevenLabs', () => {
    it('maps energetic to [excited] tag with Creative stability', () => {
      const result = mapDirectionToExpression('energetic', 'HOST', 'elevenlabs');
      expect(result.elevenlabs?.audioTagPrefix).toBe('[excited] ');
      expect(result.elevenlabs?.stability).toBe(0.0);
    });

    it('maps serious to Natural stability with no tag', () => {
      const result = mapDirectionToExpression('serious', 'EXPERT', 'elevenlabs');
      expect(result.elevenlabs?.audioTagPrefix).toBeUndefined();
      expect(result.elevenlabs?.stability).toBe(0.5);
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

    it('includes speed for energetic direction', () => {
      const result = mapDirectionToExpression('energetic', 'HOST', 'elevenlabs');
      expect(result.elevenlabs?.speed).toBe(1.15);
    });

    it('includes slower speed for thoughtful direction', () => {
      const result = mapDirectionToExpression('thoughtful', 'HOST', 'elevenlabs');
      expect(result.elevenlabs?.speed).toBe(0.85);
    });

    it('includes fastest speed for urgent direction', () => {
      const result = mapDirectionToExpression('urgent', 'HOST', 'elevenlabs');
      expect(result.elevenlabs?.speed).toBe(1.2);
    });

    it('omits speed for confident direction (default pace)', () => {
      const result = mapDirectionToExpression('confident', 'HOST', 'elevenlabs');
      expect(result.elevenlabs?.speed).toBeUndefined();
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

    it('includes speed for energetic direction', () => {
      const result = mapDirectionToExpression('energetic', 'HOST', 'cartesia');
      expect(result.cartesia?.speed).toBe(1.1);
    });

    it('includes slow speed for calm direction', () => {
      const result = mapDirectionToExpression('calm', 'HOST', 'cartesia');
      expect(result.cartesia?.speed).toBe(0.8);
    });

    it('returns speed without emotion for whispering direction', () => {
      const result = mapDirectionToExpression('whispering', 'HOST', 'cartesia');
      expect(result.cartesia?.emotion).toBeUndefined();
      expect(result.cartesia?.speed).toBe(0.7);
    });

    it('includes volume for energetic direction', () => {
      const result = mapDirectionToExpression('energetic', 'HOST', 'cartesia');
      expect(result.cartesia?.volume).toBe(1.3);
    });

    it('includes quiet volume for whispering direction', () => {
      const result = mapDirectionToExpression('whispering', 'HOST', 'cartesia');
      expect(result.cartesia?.volume).toBe(0.6);
    });

    it('includes quiet volume for sad direction', () => {
      const result = mapDirectionToExpression('sad', 'HOST', 'cartesia');
      expect(result.cartesia?.volume).toBe(0.75);
    });

    it('omits volume for playful direction (default)', () => {
      const result = mapDirectionToExpression('playful', 'HOST', 'cartesia');
      expect(result.cartesia?.volume).toBeUndefined();
    });
  });

  describe('Hume', () => {
    it('maps energetic to description', () => {
      const result = mapDirectionToExpression('energetic', 'HOST', 'hume');
      expect(result.hume?.description).toBe('energetic, enthusiastic, high-energy delivery');
    });

    it('falls back to speaker baseline when no direction', () => {
      const result = mapDirectionToExpression(undefined, 'HOST', 'hume');
      expect(result.hume?.description).toBe('warm, engaging narrator');
    });

    it('uses EXPERT baseline', () => {
      const result = mapDirectionToExpression(undefined, 'EXPERT', 'hume');
      expect(result.hume?.description).toBe('knowledgeable, articulate expert');
    });

    it('uses default baseline for unknown speaker', () => {
      const result = mapDirectionToExpression(undefined, undefined, 'hume');
      expect(result.hume?.description).toBe('natural, conversational narrator');
    });

    it('passes unknown direction as-is', () => {
      const result = mapDirectionToExpression('bewildered', 'HOST', 'hume');
      expect(result.hume?.description).toBe('bewildered');
    });

    it('includes speed for energetic direction', () => {
      const result = mapDirectionToExpression('energetic', 'HOST', 'hume');
      expect(result.hume?.speed).toBe(1.3);
    });

    it('includes slow speed for calm direction', () => {
      const result = mapDirectionToExpression('calm', 'HOST', 'hume');
      expect(result.hume?.speed).toBe(0.8);
    });

    it('omits speed for baseline fallback', () => {
      const result = mapDirectionToExpression(undefined, 'HOST', 'hume');
      expect(result.hume?.speed).toBeUndefined();
    });

    it('includes long trailing silence for dramatic direction', () => {
      const result = mapDirectionToExpression('dramatic', 'HOST', 'hume');
      expect(result.hume?.trailingSilence).toBe(0.8);
    });

    it('includes short trailing silence for urgent direction', () => {
      const result = mapDirectionToExpression('urgent', 'HOST', 'hume');
      expect(result.hume?.trailingSilence).toBe(0.1);
    });

    it('omits trailing silence for confident (uses default 0.3)', () => {
      const result = mapDirectionToExpression('confident', 'HOST', 'hume');
      expect(result.hume?.trailingSilence).toBeUndefined();
    });
  });

  describe('OpenAI', () => {
    it('maps energetic to instructions', () => {
      const result = mapDirectionToExpression('energetic', 'HOST', 'openai');
      expect(result.openai?.instructions).toContain('high energy');
    });

    it('falls back to speaker baseline when no direction', () => {
      const result = mapDirectionToExpression(undefined, 'HOST', 'openai');
      expect(result.openai?.instructions).toContain('narrator');
    });

    it('generates generic instruction for unknown direction', () => {
      const result = mapDirectionToExpression('bewildered', 'HOST', 'openai');
      expect(result.openai?.instructions).toBe('Speak with a bewildered tone.');
    });
  });

  describe('Replicate (Inworld)', () => {
    it('maps energetic to [happy] emotion tag', () => {
      const result = mapDirectionToExpression('energetic', 'HOST', 'replicate');
      expect(result.replicate?.emotionTag).toBe('[happy]');
    });

    it('maps sad to [sad] emotion tag', () => {
      const result = mapDirectionToExpression('sad', 'HOST', 'replicate');
      expect(result.replicate?.emotionTag).toBe('[sad]');
    });

    it('maps surprised to [surprised] emotion tag', () => {
      const result = mapDirectionToExpression('surprised', 'HOST', 'replicate');
      expect(result.replicate?.emotionTag).toBe('[surprised]');
    });

    it('maps laughing to [laughing] emotion tag', () => {
      const result = mapDirectionToExpression('laughing', 'HOST', 'replicate');
      expect(result.replicate?.emotionTag).toBe('[laughing]');
    });

    it('maps whispering to [whispering] emotion tag', () => {
      const result = mapDirectionToExpression('whispering', 'HOST', 'replicate');
      expect(result.replicate?.emotionTag).toBe('[whispering]');
    });

    it('returns empty for directions without Inworld mapping', () => {
      const result = mapDirectionToExpression('thoughtful', 'HOST', 'replicate');
      expect(result.replicate).toBeUndefined();
    });

    it('returns empty for no direction', () => {
      const result = mapDirectionToExpression(undefined, 'HOST', 'replicate');
      expect(result.replicate).toBeUndefined();
    });
  });

  describe('providers without expression support', () => {
    it('returns empty params for fal', () => {
      const result = mapDirectionToExpression('energetic', 'HOST', 'fal');
      expect(result).toEqual({});
    });

    it('returns empty params for mistral', () => {
      const result = mapDirectionToExpression('energetic', 'HOST', 'mistral');
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

  describe('convertInlineAudioTags', () => {
    it('passes all tags through for ElevenLabs', () => {
      expect(convertInlineAudioTags('[laughs] Hello [pause] world', 'elevenlabs'))
        .toBe('[laughs] Hello [pause] world');
    });

    it('keeps [pause] and [long pause] for Hume, strips rest', () => {
      expect(convertInlineAudioTags('[laughs] Hello [pause] world [long pause] end', 'hume'))
        .toBe(' Hello [pause] world [long pause] end');
    });

    it('converts laugh variants to [laughter] for Cartesia', () => {
      expect(convertInlineAudioTags('[laughs] Hello', 'cartesia'))
        .toBe('[laughter] Hello');
    });

    it('converts pauses to SSML breaks for Cartesia', () => {
      expect(convertInlineAudioTags('[pause] Hello [long pause] end', 'cartesia'))
        .toBe('<break time="0.5s"/> Hello <break time="1.5s"/> end');
    });

    it('converts inline emotion tags to SSML for Cartesia', () => {
      expect(convertInlineAudioTags('[emotion:excited]Hello[/emotion]', 'cartesia'))
        .toBe('<emotion value="excited">Hello</emotion>');
    });

    it('converts inline speed tags to SSML for Cartesia', () => {
      expect(convertInlineAudioTags('[speed:1.3]Fast talk[/speed]', 'cartesia'))
        .toBe('<speed ratio="1.3">Fast talk</speed>');
    });

    it('strips emotion/speed tags for OpenAI', () => {
      expect(convertInlineAudioTags('[emotion:excited]Hello[/emotion]', 'openai'))
        .toBe('Hello');
    });

    it('converts pauses to punctuation for OpenAI', () => {
      expect(convertInlineAudioTags('[long pause] Hello [pause] world', 'openai'))
        .toBe('...  Hello ,  world');
    });
  });
});
