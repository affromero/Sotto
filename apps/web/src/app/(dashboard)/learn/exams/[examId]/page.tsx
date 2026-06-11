import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getExamForUser } from '@/lib/mock-exam-service';
import { ExamRunner, type ExamData } from '@/components/learn/ExamRunner';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Practice exam' };

interface PageProps {
  params: Promise<{ examId: string }>;
}

export default async function ExamPage({ params }: PageProps) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  const { examId } = await params;

  const exam = await getExamForUser(examId, userId);
  if (!exam) redirect('/learn/exams');

  return <ExamRunner exam={exam as ExamData} />;
}
