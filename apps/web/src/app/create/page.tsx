import { redirect } from 'next/navigation';

// The episode-authoring flow is retired in the language-learning product. Learners
// generate classes from /learn (placement, mastery-gated classes, practice). This
// route stays as a redirect so any old link lands on the learning home.
export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default function CreatePage() {
  redirect('/learn');
}
