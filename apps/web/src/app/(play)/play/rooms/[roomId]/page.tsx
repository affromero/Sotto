import type { Metadata } from 'next';
import { playResourceIdSchema } from '@sotto/shared';
import { notFound } from 'next/navigation';
import { PlayRoom } from '@/components/play/PlayRoom';

export const metadata: Metadata = { title: 'Your game' };

export default async function PlayRoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const result = playResourceIdSchema.safeParse((await params).roomId);
  if (!result.success) notFound();
  return <PlayRoom key={result.data} roomId={result.data} />;
}
