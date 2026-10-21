import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { PlayOwnerReview } from '@/components/play/safety/PlayOwnerReview';

export const metadata: Metadata = { title: 'Review game reports' };

export default async function PlayReportReviewPage() {
  const session = await auth();
  if (!session?.isOwner) redirect('/play/safety');
  return <PlayOwnerReview />;
}
