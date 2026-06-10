import { redirect } from 'next/navigation';

// The old "my podcasts" dashboard is retired in the language-learning product;
// /learn is the home (course list, next class, practice). This route stays as a
// redirect so any old link lands there.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Learn' };

export default function DashboardPage() {
  redirect('/learn');
}
