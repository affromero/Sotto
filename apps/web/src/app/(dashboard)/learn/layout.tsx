import type { ReactNode } from 'react';
import { Newsreader, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';

// The learning surface (class + practice) uses the Sotto design system fonts —
// Newsreader + IBM Plex — exposed as CSS vars. Components opt into the look via
// the `.surface` class in `sottoLearn.module.css`; pages that haven't been
// converted yet are unaffected (they don't reference these vars).
const newsreader = Newsreader({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  weight: ['400', '500'],
  variable: '--font-newsreader',
  display: 'swap',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-ibm-plex-mono',
  display: 'swap',
});

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-ibm-plex-sans',
  display: 'swap',
});

export default function LearnLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${newsreader.variable} ${ibmPlexMono.variable} ${ibmPlexSans.variable}`}>
      {children}
    </div>
  );
}
