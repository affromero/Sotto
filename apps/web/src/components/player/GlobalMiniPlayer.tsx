'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { usePlayer } from '@/components/providers/AudioPlayerProvider';
import { MiniPlayer } from './MiniPlayer';

export function GlobalMiniPlayer() {
  const pathname = usePathname();
  const router = useRouter();
  const player = usePlayer();

  const isPodcastRoute = pathname.startsWith('/podcast/');
  const isVisible = !isPodcastRoute && !!player.podcastId;

  useEffect(() => {
    if (isVisible) {
      document.body.setAttribute('data-mini-player', '');
    } else {
      document.body.removeAttribute('data-mini-player');
    }
    return () => document.body.removeAttribute('data-mini-player');
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <MiniPlayer
      podcastTitle={player.podcastTitle ?? undefined}
      onExpand={() => router.push(`/podcast/${player.podcastId}`)}
      onClose={() => player.clearPodcast()}
    />
  );
}
