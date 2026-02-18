import type { Metadata } from 'next';
import { DM_Serif_Display, Inter } from 'next/font/google';
import { SessionProvider } from '@/components/providers/SessionProvider';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { EventProvider } from '@/components/providers/EventProvider';
import { AudioPlayerProvider } from '@/components/providers/AudioPlayerProvider';
import { PageViewTracker } from '@/components/providers/PageViewTracker';
import { GlobalMiniPlayer } from '@/components/player/GlobalMiniPlayer';
import { ImpersonationBanner } from '@/components/layout/ImpersonationBanner';
import { THEME_INIT_SCRIPT } from '@/lib/theme-script';
import '@/styles/globals.css';

const dmSerifDisplay = DM_Serif_Display({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-heading',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Sotto — Create. Fork. Share.',
    template: '%s | Sotto',
  },
  description:
    'The open podcast network. Create AI podcasts, import your own, fork and remix, and share knowledge with the world.',
  keywords: ['podcast', 'AI', 'social', 'remix', 'fork', 'import', 'interactive', 'learning'],
  openGraph: {
    title: 'Sotto — The Open Podcast Network',
    description:
      'Podcasts you can remix, question, and share with the world. Create with AI or import your own.',
    type: 'website',
    locale: 'en_US',
    siteName: 'Sotto',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sotto — Create. Fork. Share.',
    description: 'The open podcast network. Create AI podcasts, import your own, fork and remix.',
  },
  manifest: '/manifest.json',
  themeColor: '#D97706',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSerifDisplay.variable} ${inter.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <SessionProvider>
          <ImpersonationBanner />
          <ThemeProvider>
            <EventProvider>
              <AudioPlayerProvider>
                <PageViewTracker />
                {children}
                <GlobalMiniPlayer />
              </AudioPlayerProvider>
            </EventProvider>
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
