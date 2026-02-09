import type { Metadata } from 'next';
import { VoiceManager } from './VoiceManager';

export const metadata: Metadata = {
  title: 'Voices',
  description: 'Manage your cloned voices and premium voice credits.',
};

export default function VoicesPage() {
  return <VoiceManager />;
}
