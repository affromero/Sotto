import type { Metadata } from 'next';
import { DM_Serif_Display, Inter } from 'next/font/google';
import { EventProvider } from '@/components/providers/EventProvider';
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
    default: 'Sotto — Podcasts That Listen Back',
    template: '%s | Sotto',
  },
  description:
    'Generate AI podcasts from any topic, interrupt to ask questions, and share knowledge with the world.',
  keywords: ['podcast', 'AI', 'interactive', 'learning', 'education', 'voice'],
  openGraph: {
    title: 'Sotto — Podcasts That Listen Back',
    description: 'Generate AI podcasts, interrupt to ask questions, share with the world.',
    type: 'website',
    locale: 'en_US',
    siteName: 'Sotto',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sotto — Podcasts That Listen Back',
    description: 'Generate AI podcasts, interrupt to ask questions, share with the world.',
  },
  manifest: '/manifest.json',
  themeColor: '#D97706',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSerifDisplay.variable} ${inter.variable}`}>
      <body>
        <EventProvider>{children}</EventProvider>
      </body>
    </html>
  );
}
