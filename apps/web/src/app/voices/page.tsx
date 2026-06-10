import { redirect } from 'next/navigation';

// The shared voice marketplace is retired in the language-learning product. Voice
// selection for TTS lives in Settings; this route redirects to the learning home.
export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default function VoicesPage() {
  redirect('/learn');
}
