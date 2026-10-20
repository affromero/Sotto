import Link from 'next/link';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { VocabularyStudio } from '@/components/learn/vocabulary/VocabularyStudio';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Vocabulary' };

export default async function VocabularyPage({
  searchParams,
}: {
  searchParams: Promise<{ course?: string; session?: string }>;
}) {
  const userId = (await auth())?.user?.id;
  if (!userId) return null;
  const params = await searchParams;
  const course = await prisma.course.findFirst({
    where: { userId, ...(params.course ? { id: params.course } : {}) },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      targetLang: true,
      vocabularySupport: true,
      curriculum: { select: { title: true } },
    },
  });
  if (!course)
    return (
      <main>
        <h1>No course found</h1>
        <Link href="/learn">Back to courses</Link>
      </main>
    );
  return (
    <main>
      <VocabularyStudio
        key={course.id}
        courseId={course.id}
        courseName={course.curriculum.title || course.targetLang}
        support={course.vocabularySupport}
        sessionId={params.session}
      />
    </main>
  );
}
