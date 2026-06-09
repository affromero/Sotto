import { auth } from '@/lib/auth';
import { ClassShell } from '@/components/learn/ClassShell';

export const dynamic = 'force-dynamic';

interface ClassPageProps {
  params: Promise<{ classId: string }>;
}

export async function generateMetadata({ params }: ClassPageProps) {
  const { classId: _id } = await params;
  return { title: 'Class' };
}

export default async function ClassPage({ params }: ClassPageProps) {
  const session = await auth();
  if (!session?.user?.id) return null;

  const { classId } = await params;

  return <ClassShell classId={classId} />;
}
