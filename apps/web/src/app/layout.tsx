import type { Metadata, Viewport } from 'next';
import { BRAND } from '@sotto/shared';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { AudioPlayerProvider } from '@/components/providers/AudioPlayerProvider';
import { GlobalMiniPlayer } from '@/components/player/GlobalMiniPlayer';
import { ToastProvider } from '@/components/providers/ToastProvider';
import { NotificationProvider } from '@/components/providers/NotificationProvider';
import { CommandPaletteLoader } from '@/components/ui/CommandPaletteLoader';
import { THEME_INIT_SCRIPT } from '@/lib/theme-script';
import { getAppBaseUrl } from '@/lib/urls';
import '@fontsource/newsreader/400.css';
import '@fontsource/newsreader/400-italic.css';
import '@fontsource/newsreader/500.css';
import '@fontsource/newsreader/500-italic.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@/styles/globals.css';

const appBaseUrl = getAppBaseUrl();

export const metadata: Metadata = {
  metadataBase: new URL(appBaseUrl),
  title: {
    default: `${BRAND.name}: ${BRAND.cta}`,
    template: `%s | ${BRAND.name}`,
  },
  description: BRAND.description,
  keywords: [
    'language learning',
    'CEFR',
    'self hosted',
    'open source',
    'BYOK',
    'grammar',
    'speaking',
    'pronunciation',
    'private',
  ],
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
  icons: {
    icon: [
      { url: '/brand/sotto-mark.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: '16x16 32x32 64x64', type: 'image/x-icon' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
    shortcut: ['/favicon.ico'],
  },
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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>
      <body>
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
      </body>
    </html>
  );
}
