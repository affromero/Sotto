import type { Metadata, Viewport } from 'next';
import { Newsreader, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import { BRAND } from '@sotto/shared';
import { SessionProvider } from '@/components/providers/SessionProvider';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { AudioPlayerProvider } from '@/components/providers/AudioPlayerProvider';
import { GlobalMiniPlayer } from '@/components/player/GlobalMiniPlayer';
import { ToastProvider } from '@/components/providers/ToastProvider';
import { NotificationProvider } from '@/components/providers/NotificationProvider';
import { CommandPaletteLoader } from '@/components/ui/CommandPaletteLoader';
import { ImpersonationBanner } from '@/components/layout/ImpersonationBanner';
import { THEME_INIT_SCRIPT } from '@/lib/theme-script';
import { getAppBaseUrl } from '@/lib/urls';
import '@/styles/globals.css';

const newsreader = Newsreader({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  weight: ['400', '500'],
  variable: '--font-heading',
  display: 'swap',
});

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-body',
  display: 'swap',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

const appBaseUrl = getAppBaseUrl();

export const metadata: Metadata = {
  metadataBase: new URL(appBaseUrl),
  title: {
    default: `${BRAND.name}: ${BRAND.cta}`,
    template: `%s | ${BRAND.name}`,
  },
  description: BRAND.description,
  keywords: ['language learning', 'CEFR', 'self-hosted', 'open-source', 'BYOK', 'grammar', 'speaking', 'pronunciation', 'private'],
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: BRAND.title,
    description: BRAND.subline,
    type: 'website',
    locale: 'en_US',
    siteName: BRAND.name,
    url: appBaseUrl,
  },
  twitter: {
    card: 'summary_large_image',
    title: BRAND.title,
    description: BRAND.description,
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'Sotto',
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  themeColor: '#3F4FB0',
  viewportFit: 'cover',
  maximumScale: 1,
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${ibmPlexSans.variable} ${ibmPlexMono.variable}`}
      suppressHydrationWarning
    >
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
                <AudioPlayerProvider>
                  {children}
                  <GlobalMiniPlayer />
                  <CommandPaletteLoader />
                </AudioPlayerProvider>
              </NotificationProvider>
            </ToastProvider>
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
