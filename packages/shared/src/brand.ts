// Single source of truth for all Sotto brand copy.
// Static config files (manifest.json, package.json) can't import this, so
// update them manually when these values change.

export const BRAND = {
  name: 'Sotto',
  origin: 'Private language learning, taught from the context you choose to share.',
  url: '/',
  twitter: null,

  // Consumer-facing
  tagline: 'Learn a language, taught in your own context.',
  subline:
    'Courses from your notes, work, and interests, running on your own stack with the agents and keys you already use.',
  cta: 'Place. Practice. Progress.',

  // Pre-composed
  title: 'Sotto. Learn a language, taught in your own context.',
  description:
    'Language learning you run yourself. Connect Claude or Codex, choose what they may read, then study CEFR courses across grammar, reading, listening, speaking, and writing with your keys, data, and stack.',
  longDescription:
    'Sotto is open source language learning that teaches from your context. Connect Claude or Codex, choose what they may read, and build a course around your work and interests: CEFR grammar, reading, adaptive listening, speaking with pronunciation feedback, writing with inline corrections, and a vocabulary memory graph you own. Run it on your stack, with your keys and your data.',
} as const;

export type Brand = typeof BRAND;
