import type { Metadata } from 'next';
import { DM_Serif_Display, Inter } from 'next/font/google';
import { SessionProvider } from '@/components/providers/SessionProvider';
import { EventProvider } from '@/components/providers/EventProvider';
import { PageViewTracker } from '@/components/providers/PageViewTracker';
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
    <html lang="en" className={`${dmSerifDisplay.variable} ${inter.variable}`}>
      <body>
        <SessionProvider>
          <EventProvider>
            <PageViewTracker />
            {children}
          </EventProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
