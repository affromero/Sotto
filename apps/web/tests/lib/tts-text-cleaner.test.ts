import { describe, it, expect } from 'vitest';
import { cleanTextForTts } from '@/lib/tts-text-cleaner';

describe('tts-text-cleaner', () => {
  describe('common cleaning (all providers)', () => {
    it('removes SFX markers', () => {
      expect(cleanTextForTts('[SFX: upbeat music, 3s] Hello there'))
        .toBe('[laughs] Hello there'.replace('[laughs] ', ''));
      // Simpler:
      expect(cleanTextForTts('[SFX: upbeat music, 3s] Hello there'))
        .toBe('Hello there');
    });

    it('removes citation markers', () => {
      expect(cleanTextForTts('According to a study [1], this works [2, 3].'))
        .toBe('According to a study, this works.');
    });

    it('converts parenthetical directions to bracket audio tags', () => {
      // Without a provider, audio tags get stripped → net effect is removal
      expect(cleanTextForTts('(laughing) That is so funny'))
        .toBe('That is so funny');
      expect(cleanTextForTts('(whispering) Secret stuff'))
        .toBe('Secret stuff');
    });

    it('converts parenthetical pause directions to bracket tags', () => {
      // Without a provider, converted tags get stripped
      expect(cleanTextForTts('And then (short pause) it happened'))
        .toBe('And then it happened');
      expect(cleanTextForTts('Wow (long pause) that is heavy'))
        .toBe('Wow that is heavy');
      expect(cleanTextForTts('Wait (beat) okay'))
        .toBe('Wait okay');
      expect(cleanTextForTts('So (dramatic pause) here we go'))
        .toBe('So here we go');
    });

    it('preserves non-direction parentheticals', () => {
      expect(cleanTextForTts('The study (published in Nature) found'))
        .toBe('The study (published in Nature) found');
    });

    it('collapses multiple spaces', () => {
      expect(cleanTextForTts('Hello   there   friend'))
        .toBe('Hello there friend');
    });
  });

  describe('ElevenLabs — preserves all audio tags', () => {
    it('keeps basic audio tags', () => {
      const text = 'Wait, really? [laughs] That is incredible.';
      expect(cleanTextForTts(text, { providerId: 'elevenlabs' }))
        .toBe('Wait, really? [laughs] That is incredible.');
    });

    it('keeps emotion tags', () => {
      const text = '[excited] This is amazing! [sarcastic] Sure it is.';
      expect(cleanTextForTts(text, { providerId: 'elevenlabs' }))
        .toBe('[excited] This is amazing! [sarcastic] Sure it is.');
    });

    it('keeps pacing tags', () => {
      const text = 'And then [dramatic pause] it happened.';
      expect(cleanTextForTts(text, { providerId: 'elevenlabs' }))
        .toBe('And then [dramatic pause] it happened.');
    });

    it('keeps expanded vocal tags', () => {
      const text = '[snorts] [crying] [trembling] Really?';
      expect(cleanTextForTts(text, { providerId: 'elevenlabs' }))
        .toBe('[snorts] [crying] [trembling] Really?');
    });

    it('converts parenthetical directions to native audio tags', () => {
      expect(cleanTextForTts('(laughing) That is funny', { providerId: 'elevenlabs' }))
        .toBe('[laughs] That is funny');
      expect(cleanTextForTts('(short pause) And then', { providerId: 'elevenlabs' }))
        .toBe('[short pause] And then');
      expect(cleanTextForTts('(excitedly) Wow!', { providerId: 'elevenlabs' }))
        .toBe('[excited] Wow!');
    });
  });

  describe('Cartesia — converts to SSML and [laughter]', () => {
    it('converts laughs to [laughter]', () => {
      expect(cleanTextForTts('[laughs] That is funny', { providerId: 'cartesia' }))
        .toBe('[laughter] That is funny');
    });

    it('converts chuckles to [laughter]', () => {
      expect(cleanTextForTts('[chuckles] Nice', { providerId: 'cartesia' }))
        .toBe('[laughter] Nice');
    });

    it('converts pause to SSML break', () => {
      expect(cleanTextForTts('And then [pause] it happened', { providerId: 'cartesia' }))
        .toBe('And then <break time="1s"/> it happened');
    });

    it('converts long pause to 2s SSML break', () => {
      expect(cleanTextForTts('Wow [long pause] That is heavy', { providerId: 'cartesia' }))
        .toBe('Wow <break time="2s"/> That is heavy');
    });

    it('strips unsupported tags', () => {
      expect(cleanTextForTts('[whispers] Secret [excited] Yay', { providerId: 'cartesia' }))
        .toBe('Secret Yay');
    });

    it('converts parenthetical directions through to Cartesia format', () => {
      // (laughing) → [laughs] → [laughter]
      expect(cleanTextForTts('(laughing) Ha!', { providerId: 'cartesia' }))
        .toBe('[laughter] Ha!');
      // (short pause) → [short pause] → <break time="500ms"/>
      expect(cleanTextForTts('And (short pause) then', { providerId: 'cartesia' }))
        .toBe('And <break time="500ms"/> then');
    });
  });

  describe('Hume — keeps native pause markers', () => {
    it('keeps [pause]', () => {
      expect(cleanTextForTts('And then [pause] it clicked', { providerId: 'hume' }))
        .toBe('And then [pause] it clicked');
    });

    it('keeps [long pause]', () => {
      expect(cleanTextForTts('Wow [long pause] That changed everything', { providerId: 'hume' }))
        .toBe('Wow [long pause] That changed everything');
    });

    it('strips non-native tags', () => {
      expect(cleanTextForTts('[laughs] [excited] Hello [pause] there', { providerId: 'hume' }))
        .toBe('Hello [pause] there');
    });

    it('converts parenthetical pause to native Hume tag', () => {
      // (short pause) → [short pause] → stripped (not in Hume native set)
      expect(cleanTextForTts('Wait (short pause) okay', { providerId: 'hume' }))
        .toBe('Wait okay');
      // (pause) → [pause] → kept (native)
      expect(cleanTextForTts('And (pause) then', { providerId: 'hume' }))
        .toBe('And [pause] then');
    });
  });

  describe('OpenAI and others — strips all audio tags', () => {
    it('strips all tags for openai', () => {
      expect(cleanTextForTts('[laughs] [excited] Hello [pause] world', { providerId: 'openai' }))
        .toBe('Hello world');
    });

    it('strips all tags for fal', () => {
      expect(cleanTextForTts('[sighs] Whatever [dramatic pause] fine', { providerId: 'fal' }))
        .toBe('Whatever fine');
    });

    it('strips all tags when no provider specified', () => {
      expect(cleanTextForTts('[whispers] Secret [gasps] Oh no'))
        .toBe('Secret Oh no');
    });

    it('strips converted parenthetical directions too', () => {
      expect(cleanTextForTts('(laughing) Ha! (short pause) Okay', { providerId: 'openai' }))
        .toBe('Ha! Okay');
    });
  });
});
