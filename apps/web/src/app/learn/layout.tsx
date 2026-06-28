import type { ReactNode } from 'react';
import { Newsreader, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';

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

export default function LearnFullscreenLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${newsreader.variable} ${ibmPlexMono.variable} ${ibmPlexSans.variable}`}
      style={{ minHeight: '100dvh' }}
    >
      {children}
    </div>
  );
}
