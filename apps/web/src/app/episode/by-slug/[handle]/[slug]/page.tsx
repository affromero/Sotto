import { cache } from 'react';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import type { Metadata } from 'next';

// Re-use the main episode page's default export and metadata generator
import EpisodePage from '@/app/episode/[episodeId]/page';

interface BySlugPageProps {
  params: Promise<{ handle: string; slug: string }>;
}

const resolveSlug = cache(async (handle: string, slug: string): Promise<string | null> => {
  const user = await prisma.user.findUnique({
    where: { handle: handle.toLowerCase() },
    select: { id: true },
  });
  if (!user) return null;

  const episode = await prisma.episode.findUnique({
    where: { userId_slug: { userId: user.id, slug } },
    select: { id: true },
  });
  return episode?.id ?? null;
});

export async function generateMetadata({ params }: BySlugPageProps): Promise<Metadata> {
  const { handle, slug } = await params;
  const episodeId = await resolveSlug(handle, slug);
  if (!episodeId) return { title: 'Lesson Not Found' };

  // Delegate to the main episode page's metadata by importing it dynamically
  const mod = await import('@/app/episode/[episodeId]/page');
  if (mod.generateMetadata) {
    return mod.generateMetadata({ params: Promise.resolve({ episodeId }) });
  }
  return { title: 'Lesson' };
}

export default async function EpisodeBySlugPage({ params }: BySlugPageProps) {
  const { handle, slug } = await params;
  const episodeId = await resolveSlug(handle, slug);
  if (!episodeId) notFound();

  // Render the main episode page with the resolved ID
  return EpisodePage({ params: Promise.resolve({ episodeId }) });
}
