import type { Metadata, Viewport } from 'next';
import { DM_Serif_Display, Inter } from 'next/font/google';
import { BRAND } from '@sotto/shared';
import { SessionProvider } from '@/components/providers/SessionProvider';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { EventProvider } from '@/components/providers/EventProvider';
import { AudioPlayerProvider } from '@/components/providers/AudioPlayerProvider';
import { PageViewTracker } from '@/components/providers/PageViewTracker';
import { GlobalMiniPlayer } from '@/components/player/GlobalMiniPlayer';
import { ToastProvider } from '@/components/providers/ToastProvider';
import { NotificationProvider } from '@/components/providers/NotificationProvider';
import { CommandPaletteLoader } from '@/components/ui/CommandPaletteLoader';
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
  metadataBase: new URL(BRAND.url),
  title: {
    default: `${BRAND.name} — ${BRAND.cta}`,
    template: `%s | ${BRAND.name}`,
  },
  description: BRAND.description,
  keywords: ['podcast', 'AI', 'private', 'briefing', 'BYOK', 'import', 'interactive', 'learning'],
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: BRAND.title,
    description: BRAND.subline,
    type: 'website',
    locale: 'en_US',
    siteName: BRAND.name,
    url: BRAND.url,
  },
  twitter: {
    card: 'summary_large_image',
    site: BRAND.twitter,
    title: BRAND.title,
    description: BRAND.description,
  },
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#D97706',
  viewportFit: 'cover',
  maximumScale: 1,
  interactiveWidget: 'resizes-content',
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
                  <CommandPaletteLoader />
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
