import type { Metadata } from 'next';
import { PlaySafety } from '@/components/play/safety/PlaySafety';

export const metadata: Metadata = { title: 'Game safety' };

export default function PlaySafetyPage() {
  return <PlaySafety />;
}
