import type { Metadata } from 'next';
import { DM_Serif_Display, Inter } from 'next/font/google';
import { SessionProvider } from '@/components/providers/SessionProvider';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { EventProvider } from '@/components/providers/EventProvider';
import { AudioPlayerProvider } from '@/components/providers/AudioPlayerProvider';
import { PageViewTracker } from '@/components/providers/PageViewTracker';
import { GlobalMiniPlayer } from '@/components/player/GlobalMiniPlayer';
import { ToastProvider } from '@/components/providers/ToastProvider';
import { NotificationProvider } from '@/components/providers/NotificationProvider';
import { CommandPalette } from '@/components/ui/CommandPalette';
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
  metadataBase: new URL('https://sotto.fm'),
  title: {
    default: 'Sotto — Create. Fork. Share.',
    template: '%s | Sotto',
  },
  description:
    'Where podcasts get social. AI or human — create, discover, interrupt, fork, and remix.',
  keywords: ['podcast', 'AI', 'social', 'remix', 'fork', 'import', 'interactive', 'learning'],
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'Sotto — Where Podcasts Get Social',
    description:
      'AI or human — create, discover, interrupt, fork, and remix.',
    type: 'website',
    locale: 'en_US',
    siteName: 'Sotto',
    url: 'https://sotto.fm',
  },
  twitter: {
    card: 'summary_large_image',
    site: '@SottoFM',
    title: 'Sotto — Create. Fork. Share.',
    description: 'Where podcasts get social. AI or human — create, discover, interrupt, fork, and remix.',
  },
  manifest: '/manifest.json',
  themeColor: '#D97706',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSerifDisplay.variable} ${inter.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>
      <body>
        <SessionProvider>
          <ImpersonationBanner />
          <ThemeProvider>
            <ToastProvider>
              <NotificationProvider>
              <EventProvider>
                <AudioPlayerProvider>
                  <PageViewTracker />
                  {children}
                  <GlobalMiniPlayer />
                  <CommandPalette />
                </AudioPlayerProvider>
              </EventProvider>
              </NotificationProvider>
            </ToastProvider>
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
