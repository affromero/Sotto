import { prisma } from '@/lib/prisma';
import { DuplicateReview } from './DuplicateReview';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Duplicate Review — Admin' };

export default async function DuplicatesPage() {
  const pendingCount = await prisma.duplicateMatch.count({ where: { status: 'PENDING' } });

  return <DuplicateReview initialPendingCount={pendingCount} />;
}
