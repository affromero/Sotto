import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import EmbedPage from '@/app/podcast/[podcastId]/embed/page';

interface BySlugEmbedPageProps {
  params: Promise<{ handle: string; slug: string }>;
}

export const metadata = { robots: 'noindex' };

export default async function BySlugEmbedPage({ params }: BySlugEmbedPageProps) {
  const { handle, slug } = await params;

  const user = await prisma.user.findUnique({
    where: { handle: handle.toLowerCase() },
    select: { id: true },
  });
  if (!user) notFound();

  const podcast = await prisma.podcast.findUnique({
    where: { userId_slug: { userId: user.id, slug } },
    select: { id: true },
  });
  if (!podcast) notFound();

  return EmbedPage({ params: Promise.resolve({ podcastId: podcast.id }) });
}
