import type { Metadata } from 'next';
import { PlayJoin } from '@/components/play/PlayJoin';
import { playDistribution, type PlayDistribution } from '@/lib/play/install/distribution';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'You’re invited',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function PlayJoinPage() {
  let distribution: PlayDistribution;
  let installationError: string | null = null;
  try {
    distribution = playDistribution();
  } catch {
    distribution = { ios: null, androidStore: null, androidApk: null };
    installationError = 'Native app download links are misconfigured on this server.';
  }
  return <PlayJoin distribution={distribution} installationError={installationError} />;
}
