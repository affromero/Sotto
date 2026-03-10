import { describe, it, expect } from 'vitest';
import { buildMusicPrompt } from '@/lib/music-prompt-builder';

function makeContext(overrides: Partial<Parameters<typeof buildMusicPrompt>[0]> = {}) {
  return {
    title: 'Test Podcast',
    topic: 'How AI is changing education',
    durationSeconds: 600,
    tags: ['technology'],
    ...overrides,
  };
}

describe('buildMusicPrompt', () => {
  describe('basic prompt generation', () => {
    it('includes the topic in the prompt', () => {
      const prompt = buildMusicPrompt(makeContext());
      expect(prompt).toContain('How AI is changing education');
    });

    it('starts with instrumental background music description', () => {
      const prompt = buildMusicPrompt(makeContext());
      expect(prompt).toMatch(/^Instrumental background music for a conversational podcast\./);
    });

    it('includes non-intrusive mixing guidance', () => {
      const prompt = buildMusicPrompt(makeContext());
      expect(prompt).toContain('non-intrusive');
      expect(prompt).toContain('underneath two people talking');
    });

    it('includes even dynamics guidance', () => {
      const prompt = buildMusicPrompt(makeContext());
      expect(prompt).toContain('no sudden loud sections or dramatic drops');
    });
  });

  describe('tag-to-genre mapping', () => {
    const tagGenrePairs: [string, string][] = [
      ['tech', 'ambient electronic'],
      ['technology', 'ambient electronic'],
      ['science', 'ambient electronic'],
      ['ai', 'ambient electronic'],
      ['programming', 'lo-fi electronic'],
      ['history', 'orchestral'],
      ['politics', 'cinematic orchestral'],
      ['news', 'modern cinematic'],
      ['comedy', 'light jazz'],
      ['humor', 'light jazz'],
      ['business', 'corporate ambient'],
      ['finance', 'corporate ambient'],
      ['health', 'acoustic ambient'],
      ['wellness', 'acoustic ambient'],
      ['sports', 'upbeat electronic'],
      ['music', 'acoustic'],
      ['culture', 'world fusion'],
      ['education', 'soft piano'],
      ['philosophy', 'minimalist piano'],
      ['psychology', 'atmospheric ambient'],
      ['nature', 'organic ambient'],
      ['travel', 'world music'],
      ['food', 'bossa nova'],
      ['gaming', 'chiptune ambient'],
      ['true_crime', 'dark cinematic'],
      ['crime', 'dark cinematic'],
      ['horror', 'dark ambient'],
      ['fiction', 'cinematic'],
      ['storytelling', 'cinematic orchestral'],
    ];

    it.each(tagGenrePairs)('maps "%s" tag to "%s" genre', (tag, genre) => {
      const prompt = buildMusicPrompt(makeContext({ tags: [tag] }));
      expect(prompt).toContain(`Genre: ${genre}.`);
    });

    it('uses the first matching tag when multiple are provided', () => {
      const prompt = buildMusicPrompt(makeContext({ tags: ['history', 'tech'] }));
      expect(prompt).toContain('Genre: orchestral.');
    });

    it('skips unrecognized tags and uses the first recognized one', () => {
      const prompt = buildMusicPrompt(makeContext({ tags: ['unknown', 'comedy'] }));
      expect(prompt).toContain('Genre: light jazz.');
    });
  });

  describe('tone mapping', () => {
    const tonePairs: [string, string][] = [
      ['casual', 'relaxed and warm'],
      ['professional', 'polished and clean'],
      ['serious', 'contemplative and measured'],
      ['humorous', 'light and playful'],
      ['educational', 'gentle and unobtrusive'],
      ['dramatic', 'dynamic with subtle tension'],
      ['inspirational', 'uplifting and hopeful'],
      ['conversational', 'warm and inviting'],
    ];

    it.each(tonePairs)('maps "%s" tone to "%s" style', (tone, style) => {
      const prompt = buildMusicPrompt(makeContext({ tone }));
      expect(prompt).toContain(`Style: ${style}.`);
    });

    it('falls back to "warm and unobtrusive" for unknown tone', () => {
      const prompt = buildMusicPrompt(makeContext({ tone: 'aggressive' }));
      expect(prompt).toContain('Style: warm and unobtrusive.');
    });

    it('falls back to "warm and unobtrusive" when tone is undefined', () => {
      const prompt = buildMusicPrompt(makeContext({ tone: undefined }));
      expect(prompt).toContain('Style: warm and unobtrusive.');
    });

    it('handles case-insensitive tone input', () => {
      const prompt = buildMusicPrompt(makeContext({ tone: 'Casual' }));
      expect(prompt).toContain('Style: relaxed and warm.');
    });
  });

  describe('multiple tags', () => {
    it('selects the genre of the first recognized tag', () => {
      const prompt = buildMusicPrompt(makeContext({ tags: ['food', 'science', 'history'] }));
      expect(prompt).toContain('Genre: bossa nova.');
    });

    it('falls back to ambient when no tags are recognized', () => {
      const prompt = buildMusicPrompt(makeContext({ tags: ['nope', 'zilch'] }));
      expect(prompt).toContain('Genre: ambient.');
    });
  });

  describe('edge cases', () => {
    it('uses fallback genre "ambient" when tags is empty', () => {
      const prompt = buildMusicPrompt(makeContext({ tags: [] }));
      expect(prompt).toContain('Genre: ambient.');
    });

    it('uses fallback style when tone is not provided', () => {
      const { tone: _, ...contextWithoutTone } = makeContext();
      const prompt = buildMusicPrompt(contextWithoutTone as Parameters<typeof buildMusicPrompt>[0]);
      expect(prompt).toContain('Style: warm and unobtrusive.');
    });

    it('normalizes tags by stripping non-alpha characters', () => {
      const prompt = buildMusicPrompt(makeContext({ tags: ['  Tech! '] }));
      expect(prompt).toContain('Genre: ambient electronic.');
    });

    it('normalizes tags to lowercase', () => {
      const prompt = buildMusicPrompt(makeContext({ tags: ['HISTORY'] }));
      expect(prompt).toContain('Genre: orchestral.');
    });
  });

  describe('duration handling', () => {
    it('includes duration in minutes rounded up', () => {
      const prompt = buildMusicPrompt(makeContext({ durationSeconds: 600 }));
      expect(prompt).toContain('Target duration: approximately 10 minutes.');
    });

    it('rounds up partial minutes', () => {
      const prompt = buildMusicPrompt(makeContext({ durationSeconds: 61 }));
      expect(prompt).toContain('Target duration: approximately 2 minutes.');
    });

    it('handles exactly one minute', () => {
      const prompt = buildMusicPrompt(makeContext({ durationSeconds: 60 }));
      expect(prompt).toContain('Target duration: approximately 1 minutes.');
    });

    it('omits duration when durationSeconds is 0', () => {
      const prompt = buildMusicPrompt(makeContext({ durationSeconds: 0 }));
      expect(prompt).not.toContain('Target duration');
    });

    it('omits duration when durationSeconds is negative', () => {
      const prompt = buildMusicPrompt(makeContext({ durationSeconds: -10 }));
      expect(prompt).not.toContain('Target duration');
    });
  });

  describe('language handling', () => {
    it('does not crash when language is provided', () => {
      const prompt = buildMusicPrompt(makeContext({ language: 'es' }));
      expect(prompt).toBeTruthy();
    });

    it('generates a valid prompt regardless of language', () => {
      const prompt = buildMusicPrompt(makeContext({ language: 'ja' }));
      expect(prompt).toContain('Instrumental');
      expect(prompt).toContain('Genre:');
    });
  });

  describe('prompt structure', () => {
    it('always contains "instrumental" (provider-agnostic)', () => {
      const prompt = buildMusicPrompt(makeContext());
      expect(prompt.toLowerCase()).toContain('instrumental');
    });

    it('does not reference any specific music provider', () => {
      const prompt = buildMusicPrompt(makeContext());
      const providers = ['suno', 'udio', 'mubert', 'soundraw', 'openai'];
      for (const provider of providers) {
        expect(prompt.toLowerCase()).not.toContain(provider);
      }
    });

    it('returns a single string with no newlines', () => {
      const prompt = buildMusicPrompt(makeContext());
      expect(prompt).not.toContain('\n');
    });

    it('contains Genre and Style labels', () => {
      const prompt = buildMusicPrompt(makeContext());
      expect(prompt).toMatch(/Genre: .+\./);
      expect(prompt).toMatch(/Style: .+\./);
    });
  });
});
