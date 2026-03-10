import { BRAND } from '@sotto/shared';

/** Feature catalog: slug → description for demo script generation */
const FEATURE_CATALOG: Record<string, string> = {
  'creation-flow': 'Chat with AI to create a podcast. Describe your topic, pick a tone and depth, and Sotto generates a full 2-voice conversational podcast with sound effects and citations.',
  'interrupt': 'Interrupt mid-playback to ask questions. AI answers in context, and your Q&A can be baked back into the podcast as a new version.',
  'fork': 'Fork any podcast — like GitHub for audio. Take someone else\'s podcast, remix it with your own angle, tone, or focus areas. The original is always credited.',
  'voice-comparison': 'Compare 8+ TTS providers side-by-side on the same script. ElevenLabs, OpenAI, Cartesia, Hume, Fal, Replicate, MiniMax — hear the difference instantly.',
  'import': 'Import any human-made podcast. Sotto transcribes it, adds social features (comments, Q&A, forking), and puts it on the feed alongside AI-generated content.',
  'social-feed': 'A public feed of podcasts — AI and human, side by side. Search, filter by topic, discover new voices, follow creators, and build collections.',
  'byok': 'Bring Your Own Keys — use your own API keys for LLM and TTS providers. All features become unlimited and free. No subscription required.',
  'voice-cloning': 'Clone your voice and use it in podcasts. Other creators can request to use your voice, and you set the price. A voice marketplace.',
  'script-review': 'Review AI-generated scripts before audio generation. Edit turns, approve, or regenerate with feedback. Full control over content.',
  'video-generation': 'Turn any podcast into a video with AI-generated visuals, transitions, and avatars. Each segment gets matched with relevant imagery.',
  'collections': 'Curate podcast playlists. Save podcasts to collections, share them publicly, and let others follow your curation.',
  'multi-speaker': 'Up to 4 speakers per podcast. Custom speaker names and descriptions — not just Host and Expert.',
};

/**
 * Assemble product context from BRAND constant for demo script prompts.
 */
export function getDemoProductContext(): string {
  return [
    `Product: ${BRAND.name}`,
    `Origin: ${BRAND.origin}`,
    `Tagline: ${BRAND.tagline}`,
    `Description: ${BRAND.elevatorPitch}`,
    `URL: ${BRAND.url}`,
    '',
    'Core capabilities:',
    '- AI podcast generation from natural language chat',
    '- 8+ TTS voice providers with side-by-side comparison',
    '- Interrupt mid-playback to ask questions',
    '- Fork and remix any podcast',
    '- Import human-made podcasts with social features',
    '- Public social feed with discovery',
    '- Bring Your Own Keys (BYOK) for unlimited free usage',
    '- Voice cloning marketplace',
    '- Video generation with AI visuals',
  ].join('\n');
}

/**
 * Get focused feature descriptions for specific feature slugs.
 * Returns all features if no slugs provided.
 */
export function getDemoFeatureDescriptions(slugs?: string[]): string {
  const targetSlugs = slugs?.length ? slugs : Object.keys(FEATURE_CATALOG);
  const descriptions = targetSlugs
    .filter((slug) => FEATURE_CATALOG[slug])
    .map((slug) => `- **${slug}**: ${FEATURE_CATALOG[slug]}`);

  if (descriptions.length === 0) {
    return Object.entries(FEATURE_CATALOG)
      .map(([slug, desc]) => `- **${slug}**: ${desc}`)
      .join('\n');
  }

  return descriptions.join('\n');
}

/** Get available feature slugs for UI display */
export function getDemoFeatureSlugs(): string[] {
  return Object.keys(FEATURE_CATALOG);
}

/** Get feature label from slug */
export function getDemoFeatureLabel(slug: string): string {
  return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
