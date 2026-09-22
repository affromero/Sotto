import type { ReactNode } from 'react';

export const metadata = {
  title: 'Welcome to Sotto',
  robots: { index: false, follow: false },
};

export default function WelcomeLayout({ children }: { children: ReactNode }) {
  return <div style={{ height: '100%' }}>{children}</div>;
}
