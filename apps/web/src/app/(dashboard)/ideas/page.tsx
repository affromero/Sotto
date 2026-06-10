import { redirect } from 'next/navigation';

// The podcast idea library is retired in the language-learning product; learners
// work from /learn (courses, practice, memory). This route redirects there.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Learn' };

export default function LibraryPage() {
  redirect('/learn');
}
