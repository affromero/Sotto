import { BRAND } from '@sotto/shared';

/** Feature catalog: slug → description for demo script generation */
const FEATURE_CATALOG: Record<string, string> = {
  'creation-flow':
    'Chat with AI to create a podcast. Describe your topic, pick a tone and depth, and Sotto generates a full 2-voice conversational podcast with sound effects and citations.',
  interrupt:
    'Interrupt mid-playback to ask questions. AI answers in context, and your Q&A can be baked back into the podcast as a new version.',
  import:
    'Import any human-made podcast. Sotto transcribes it and turns it into a private, searchable listening workspace.',
  'private-rss':
    'Create private RSS feed URLs for podcast apps without exposing podcasts to public listings.',
  byok: 'Bring Your Own Keys — use your own API keys for LLM and TTS providers. All features become unlimited and free. No subscription required.',
  'script-review':
    'Review AI-generated scripts before audio generation. Edit turns, approve, or regenerate with feedback. Full control over content.',
  'video-generation':
    'Turn any podcast into a video with AI-generated visuals, transitions, and avatars. Each segment gets matched with relevant imagery.',
  'multi-speaker':
    'Up to 4 speakers per podcast. Custom speaker names and descriptions — not just Host and Expert.',
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
    '- Mastery-gated CEFR courses across grammar, reading, listening, and speaking',
    '- Adaptive listening lessons generated from your topics and agent context',
    '- Pronunciation feedback with speaking exercises',
    '- Personal vocabulary memory graph with spaced-repetition review',
    '- Connect Claude Code, Codex, or another local agent via MCP',
    '- 8+ TTS voice providers for audio lessons',
    '- Interrupt mid-playback to ask questions',
    '- Bring Your Own Keys (BYOK) for unlimited free usage',
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
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Curated list of real CSS selectors in the Sotto app.
 * Used by the AI walkthrough prompt so generated scripts target real elements.
 */
export function getAppSelectorReference(): string {
  return [
    '## Navigation & Layout',
    '- `nav` — main navigation bar',
    '- `a[href="/"]` — home/logo link (landing page only)',
    '- `button[aria-label="User menu"]` — user avatar dropdown (dashboard TopBar only)',
    '- NOTE: /podcast/[id] pages have NO top nav — do not target nav selectors on those pages',
    '',
    '## Player & Playback',
    '- `.playerControls` — mini player controls area',
    '- `button[aria-label="Play"]` — play button',
    '- `button[aria-label="Pause"]` — pause button',
    '- `button[aria-label="Ask a question"]` — interrupt/Q&A button',
    '- `input[aria-label="Your question"]` — Q&A input field',
    '',
    '## Podcast Detail',
    '- `button[aria-label="Share podcast"]` — share button',
    '- `[data-testid="script-section"]` — script review area',
    '- `button:has-text("Approve Script")` — script approval button',
    '',
    '## Voice Comparison',
    '- the player voice/provider selector — switch the active TTS provider',
    '',
    '## Settings & BYOK',
    '- `a[href="/settings"]` — settings link',
    '- `input[aria-label="API Key"]` — BYOK key input',
    '- `button:has-text("Save Key")` — save API key button',
  ].join('\n');
}

/**
 * Generate the voice comparison section for the walkthrough prompt.
 * When providers are selected, instructs the AI to weave provider switching
 * into the podcast creation flow — replaying the same segments with each provider.
 */
export function getVoiceComparisonInstructions(providerNames: string[]): string {
  if (providerNames.length === 0) {
    return 'No voice comparison requested. Skip this section.';
  }

  return [
    `The demo must include a **voice comparison** section as part of the podcast creation flow.`,
    `After the podcast is generated, the recording switches between TTS providers to showcase voice quality differences.`,
    '',
    `Providers to compare: **${providerNames.join(', ')}**`,
    '',
    'How to implement this in the walkthrough:',
    '1. After the podcast is fully generated and playing, pause playback.',
    '2. For each provider: open the voice/provider selector in the player UI, switch to that provider, then play a short segment (5–8 seconds).',
    '3. Keep transitions quick — the viewer should hear the difference immediately, not wait for loading.',
    '4. Use the `intercept` action to mock instant audio regeneration for each provider switch.',
    '5. The narration should name each provider as it plays: "ElevenLabs. OpenAI TTS. Cartesia."',
    '6. Keep narration minimal during the comparison — let the voices speak for themselves.',
    '7. Use `zoom` on the provider name/label in the UI so the viewer can read which provider is active.',
  ].join('\n');
}

/**
 * Documents available API interceptors for the walkthrough prompt.
 * Maps to functions in scripts/recording/lib/interceptors.ts.
 */
export function getInterceptorCatalog(): string {
  return [
    '## interact',
    'Mocks POST /api/v1/podcasts/{id}/interact + GET polling.',
    'Options: `{ podcastId: string, interactionId: string, answer: string, answerDelay?: number }`',
    'Use when: demo shows the interrupt/Q&A feature during playback.',
    '',
    '## scriptApprove',
    'Mocks POST /api/v1/podcasts/{id}/script/approve.',
    'Options: `{ podcastId: string }`',
    'Use when: demo shows script review and approval.',
  ].join('\n');
}
