// Single source of truth for all Sotto brand copy.
// Static config files (manifest.json, package.json) can't import this —
// update them manually when these values change.

export const BRAND = {
  name: 'Sotto',
  origin: 'From Italian "sotto voce" — speaking in a soft, intimate voice',
  url: '/',
  twitter: null,

  // Consumer-facing
  tagline: 'Private audio briefings from your own stack.',
  subline: 'Create podcasts with your agents, your keys, and your private RSS feed.',
  cta: 'Create. Listen. Keep private.',

  // Investor-facing
  pitchTagline: 'Open-source private podcast infrastructure.',

  // Pre-composed
  title: 'Sotto — Private audio briefings from your own stack.',
  description: 'Create private podcasts with your agents, your keys, and your private RSS feed.',
  elevatorPitch:
    'Open-source private podcast infrastructure. Connect your AI tools and TTS provider, generate audio briefings, and keep distribution private through self-hosted or managed infrastructure.',
} as const;

export type Brand = typeof BRAND;
