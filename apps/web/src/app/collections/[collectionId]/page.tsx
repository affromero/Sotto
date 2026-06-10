import { redirect } from 'next/navigation';

// Podcast collections are retired in the language-learning product. This route
// redirects to the learning home.
export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default function CollectionPage() {
  redirect('/learn');
}
