import { auth } from '@/lib/auth';
import { ClassRunner } from '@/components/learn/ClassRunner';
import styles from './page.module.css';

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

  return (
    <main className={styles.root}>
      <ClassRunner classId={classId} />
    </main>
  );
}
