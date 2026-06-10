import { redirect } from 'next/navigation';

// Per-podcast creator analytics is retired in the language-learning product;
// admins see server-wide cost + usage analytics under /admin. This route
// redirects to the learning home.
export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default function PodcastAnalyticsPage() {
  redirect('/learn');
}
