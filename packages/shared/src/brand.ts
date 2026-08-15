// Single source of truth for all Sotto brand copy.
// Static config files (manifest.json, package.json) can't import this, so
// update them manually when these values change.

export const BRAND = {
  name: 'Sotto',
  origin: 'Private language rehearsal, taught from the context you choose to share.',
  url: '/',
  twitter: null,

  // Consumer-facing
  tagline: 'Practice a language before the pressure of speaking.',
  subline:
    'Not another AI language chatbot: a self-hosted rehearsal system for CEFR classes, guided speaking, and feedback from your own notes, interests, and goals.',
  cta: 'Practice. Rehearse. Progress.',

  // Pre-composed
  title: 'Sotto: self-hosted AI language learning. Practice before the pressure of speaking.',
  description:
    'Self-hosted language learning for private rehearsal before class, tutoring, or real conversation, not another AI language chatbot. Choose what your agent may read, then study CEFR courses across grammar, reading, listening, speaking, and writing with your keys, data, and stack.',
  longDescription:
    'Sotto is open source language learning for private, low-pressure rehearsal, not another AI language chatbot. Connect Claude, Codex, or a local model, choose what it may read, and build a course around your work, interests, and the situations you want to handle before a live conversation: CEFR grammar, reading, adaptive listening, speaking with pronunciation feedback, writing with inline corrections, and a vocabulary memory graph you own. Run it on your stack, with your keys and your data.',
} as const;

export type Brand = typeof BRAND;
