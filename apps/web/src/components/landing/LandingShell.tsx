'use client';

import { useCallback, type ReactNode } from 'react';
import { useScrollReveal } from '@/lib/hooks/useScrollReveal';
import styles from './LandingShell.module.css';

interface LandingShellProps {
  children: ReactNode;
}

export function LandingShell({ children }: LandingShellProps) {
  const revealRef = useScrollReveal();

  const combinedRef = useCallback(
    (node: HTMLElement | null) => {
      revealRef(node);
    },
    [revealRef]
  );

  return (
    <main ref={combinedRef} className={styles.shell}>
      {children}
    </main>
  );
}
