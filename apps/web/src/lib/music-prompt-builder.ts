/**
 * Builds optimized prompts for AI music generation based on podcast metadata.
 * Maps podcast tags/tone to musical genres and styles.
 */

const TAG_GENRE_MAP: Record<string, string> = {
  technology: 'ambient electronic',
  tech: 'ambient electronic',
  science: 'ambient electronic',
  ai: 'ambient electronic',
  programming: 'lo-fi electronic',
  history: 'orchestral',
  politics: 'cinematic orchestral',
  news: 'modern cinematic',
  comedy: 'light jazz',
  humor: 'light jazz',
  business: 'corporate ambient',
  finance: 'corporate ambient',
  health: 'acoustic ambient',
  wellness: 'acoustic ambient',
  sports: 'upbeat electronic',
  music: 'acoustic',
  culture: 'world fusion',
  education: 'soft piano',
  philosophy: 'minimalist piano',
  psychology: 'atmospheric ambient',
  nature: 'organic ambient',
  travel: 'world music',
  food: 'bossa nova',
  gaming: 'chiptune ambient',
  true_crime: 'dark cinematic',
  crime: 'dark cinematic',
  horror: 'dark ambient',
  fiction: 'cinematic',
  storytelling: 'cinematic orchestral',
};

const TONE_STYLE_MAP: Record<string, string> = {
  casual: 'relaxed and warm',
  professional: 'polished and clean',
  serious: 'contemplative and measured',
  humorous: 'light and playful',
  educational: 'gentle and unobtrusive',
  dramatic: 'dynamic with subtle tension',
  inspirational: 'uplifting and hopeful',
  conversational: 'warm and inviting',
  comedic: 'playful and punchy with comic timing',
  satirical: 'wry and sophisticated with ironic undertones',
  storytelling: 'cinematic and narrative-driven',
};

function mapTagsToGenre(tags: string[]): string {
  for (const tag of tags) {
    const normalized = tag.toLowerCase().replace(/[^a-z_]/g, '');
    if (TAG_GENRE_MAP[normalized]) {
      return TAG_GENRE_MAP[normalized];
    }
  }
  return 'ambient';
}

function mapToneToStyle(tone?: string): string {
  if (!tone) return 'warm and unobtrusive';
  const normalized = tone.toLowerCase();
  return TONE_STYLE_MAP[normalized] || 'warm and unobtrusive';
}

export function buildMusicPrompt(context: {
  title: string;
  topic: string;
  durationSeconds: number;
  tags: string[];
  tone?: string;
  depth?: string;
  language?: string;
}): string {
  const genre = mapTagsToGenre(context.tags);
  const style = mapToneToStyle(context.tone);

  const parts = [
    `Instrumental background music for a conversational podcast.`,
    `Genre: ${genre}.`,
    `Style: ${style}.`,
    `The music should be non-intrusive and suitable for playing underneath two people talking.`,
    `Keep the dynamics even — no sudden loud sections or dramatic drops.`,
    `The podcast topic is: ${context.topic}.`,
  ];

  if (context.durationSeconds > 0) {
    const minutes = Math.ceil(context.durationSeconds / 60);
    parts.push(`Target duration: approximately ${minutes} minutes.`);
  }

  return parts.join(' ');
}
