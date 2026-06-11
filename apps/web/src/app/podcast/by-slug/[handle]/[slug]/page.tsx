import { cache } from 'react';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import type { Metadata } from 'next';

// Re-use the main podcast page's default export and metadata generator
import PodcastPage from '@/app/podcast/[podcastId]/page';

interface BySlugPageProps {
  params: Promise<{ handle: string; slug: string }>;
}

const resolveSlug = cache(async (handle: string, slug: string): Promise<string | null> => {
  const user = await prisma.user.findUnique({
    where: { handle: handle.toLowerCase() },
    select: { id: true },
  });
  if (!user) return null;

  const podcast = await prisma.podcast.findUnique({
    where: { userId_slug: { userId: user.id, slug } },
    select: { id: true },
  });
  return podcast?.id ?? null;
});

export async function generateMetadata({ params }: BySlugPageProps): Promise<Metadata> {
  const { handle, slug } = await params;
  const podcastId = await resolveSlug(handle, slug);
  if (!podcastId) return { title: 'Lesson Not Found' };

  // Delegate to the main podcast page's metadata by importing it dynamically
  const mod = await import('@/app/podcast/[podcastId]/page');
  if (mod.generateMetadata) {
    return mod.generateMetadata({ params: Promise.resolve({ podcastId }) });
  }
  return { title: 'Lesson' };
}

export default async function PodcastBySlugPage({ params }: BySlugPageProps) {
  const { handle, slug } = await params;
  const podcastId = await resolveSlug(handle, slug);
  if (!podcastId) notFound();

  // Render the main podcast page with the resolved ID
  return PodcastPage({ params: Promise.resolve({ podcastId }) });
}
