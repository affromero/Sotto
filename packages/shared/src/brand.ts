// Single source of truth for all Sotto brand copy.
// Static config files (manifest.json, package.json) can't import this —
// update them manually when these values change.

export const BRAND = {
  name: 'Sotto',
  origin: 'From Italian "sotto voce" — spoken softly, kept private',
  url: '/',
  twitter: null,

  // Consumer-facing
  tagline: 'Learn a language, taught in your own context.',
  subline: 'Open-source, self-hostable courses built from the context of your work and interests — through the agent and keys you already own.',
  cta: 'Place. Practice. Progress.',

  // Investor-facing
  pitchTagline: 'Context-aware, self-hostable language learning.',

  // Pre-composed
  title: 'Sotto — Learn a language, taught in your own context.',
  description:
    'Open-source, self-hostable language learning, taught in your own context. Connect your own Claude or Codex and choose what it may read, then take mastery-gated CEFR courses across grammar, reading, listening, speaking, and writing — with your keys, your data, and the whole stack.',
  elevatorPitch:
    'Sotto is open-source language-learning infrastructure that teaches in your context. Connect your own Claude or Codex and choose what it may read, and it builds a language course around your work and interests: mastery-gated CEFR grammar, reading, an adaptive listening podcast, speaking with pronunciation feedback, and writing with inline corrections, plus a personal vocabulary memory graph you own. Self-host it on your stack, with your keys and your data.',
} as const;

export type Brand = typeof BRAND;
