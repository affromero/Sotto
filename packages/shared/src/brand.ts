// Single source of truth for all Sotto brand copy.
// Static config files (manifest.json, package.json) can't import this —
// update them manually when these values change.

export const BRAND = {
  name: 'Sotto',
  origin: 'From Italian "sotto voce" — speaking in a soft, intimate voice',
  url: '/',
  twitter: null,

  // Consumer-facing
  tagline: 'Learn a language with a tutor you own.',
  subline: 'Open-source, self-hostable courses powered by your own agents and your own keys.',
  cta: 'Place. Practice. Progress.',

  // Investor-facing
  pitchTagline: 'Open-source language-learning infrastructure.',

  // Pre-composed
  title: 'Sotto — Learn a language with a tutor you own.',
  description:
    'Open-source, self-hostable language learning. Mastery-gated CEFR courses across grammar, reading, listening, and speaking, built on your own AI agents, your keys, and your data.',
  elevatorPitch:
    'Open-source language-learning infrastructure. Take mastery-gated CEFR courses with grammar, reading, an adaptive listening podcast, and speaking with pronunciation feedback. Self-host it on your own stack, connect your own Claude or Codex with your own keys, and grow a personal vocabulary memory graph as you learn.',
} as const;

export type Brand = typeof BRAND;
