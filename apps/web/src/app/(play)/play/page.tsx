import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { PlayLobby } from '@/components/play/PlayLobby';

export const metadata: Metadata = { title: 'Play together' };

export default async function PlayPage() {
  const session = await auth();
  return <PlayLobby isOwner={session?.isOwner ?? false} />;
}
