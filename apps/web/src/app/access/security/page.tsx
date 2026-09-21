import type { Metadata } from 'next';
import { SecurityScreen } from './SecurityScreen';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Account security · Sotto',
  robots: { index: false, follow: false },
};

export default function SecurityPage() {
  return <SecurityScreen />;
}
