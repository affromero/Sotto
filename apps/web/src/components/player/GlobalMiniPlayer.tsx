'use client';

import { usePathname, useRouter } from 'next/navigation';
import { usePlayer } from '@/components/providers/AudioPlayerProvider';
import { MiniPlayer } from './MiniPlayer';

export function GlobalMiniPlayer() {
  const pathname = usePathname();
  const router = useRouter();
  const player = usePlayer();

  const isPodcastRoute = pathname.startsWith('/podcast/');
  if (isPodcastRoute || !player.podcastId) return null;

  return (
    <MiniPlayer
      podcastTitle={player.podcastTitle ?? undefined}
      onExpand={() => router.push(`/podcast/${player.podcastId}`)}
      onClose={() => player.clearPodcast()}
    />
  );
}
