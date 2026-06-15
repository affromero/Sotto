import { auth } from '@/lib/auth';
import { ClassShell } from '@/components/learn/ClassShell';

export const dynamic = 'force-dynamic';

interface ClassPageProps {
  params: Promise<{ classId: string }>;
  searchParams?: Promise<{ section?: string }>;
}

export async function generateMetadata({ params }: ClassPageProps) {
  const { classId: _id } = await params;
  return { title: 'Class' };
}

export default async function ClassPage({ params, searchParams }: ClassPageProps) {
  const session = await auth();
  if (!session?.user?.id) return null;

  const { classId } = await params;
  const query = await searchParams;

  return <ClassShell classId={classId} initialSectionId={query?.section} />;
}
