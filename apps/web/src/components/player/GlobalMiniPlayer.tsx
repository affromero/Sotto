'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { usePlayer } from '@/components/providers/AudioPlayerProvider';

const MiniPlayer = dynamic(
  () => import('./MiniPlayer').then((m) => ({ default: m.MiniPlayer })),
  { ssr: false }
);

export function GlobalMiniPlayer() {
  const pathname = usePathname();
  const router = useRouter();
  const player = usePlayer();

  const isEpisodeRoute = pathname.startsWith('/episode/') || pathname.startsWith('/@');
  const isVisible = !isEpisodeRoute && !!player.episodeId;

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
      episodeTitle={player.episodeTitle ?? undefined}
      onExpand={() => router.push(`/episode/${player.episodeId}`)}
      onClose={() => player.clearEpisode()}
    />
  );
}
