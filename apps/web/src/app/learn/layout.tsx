import type { ReactNode } from 'react';

export default function LearnFullscreenLayout({ children }: { children: ReactNode }) {
  return <div style={{ minHeight: '100dvh' }}>{children}</div>;
}
