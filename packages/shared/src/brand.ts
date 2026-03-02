// Single source of truth for all Sotto brand copy.
// Static config files (manifest.json, package.json) can't import this —
// update them manually when these values change.

export const BRAND = {
  name: 'Sotto',
  origin: 'From Italian "sotto voce" — speaking in a soft, intimate voice',
  url: 'https://sotto.fm',
  twitter: '@SottoFM',

  // Consumer-facing
  tagline: 'Every voice. Every topic. One feed.',
  subline: 'Create AI podcasts, compare voices side-by-side, remix anything.',
  cta: 'Create. Fork. Remix. Share.',

  // Investor-facing
  pitchTagline: 'GitHub for podcasts.',

  // Pre-composed
  title: 'Sotto — Every voice. Every topic. One feed.',
  description:
    'Every voice. Every topic. One feed. Create AI podcasts, compare voices side-by-side, remix anything.',
  elevatorPitch:
    'The social podcast network. Create AI podcasts or import human ones, compare 8+ voice providers side-by-side, fork and remix anything. Bring your own API keys — unlimited and free.',
} as const;

export type Brand = typeof BRAND;
