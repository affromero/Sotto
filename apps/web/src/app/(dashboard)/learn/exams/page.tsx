import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { listCourseExams } from '@/lib/mock-exam-service';
import { ExamHub } from '@/components/learn/ExamHub';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Practice exam' };

interface PageProps {
  searchParams: Promise<{ course?: string }>;
}

export default async function ExamsPage({ searchParams }: PageProps) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  const { course: courseId } = await searchParams;

  const course = await prisma.course.findFirst({
    where: courseId ? { id: courseId, userId } : { userId },
    orderBy: courseId ? undefined : { createdAt: 'desc' },
    select: { id: true },
  });
  if (!course) redirect('/learn');

  const view = await listCourseExams(course.id, userId);
  if (!view) redirect('/learn');

  return <ExamHub courseId={course.id} available={view.available} history={view.history} />;
}
