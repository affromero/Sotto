'use client';

import { useEffect, useRef, useCallback, type ReactNode } from 'react';
import { useScrollReveal } from '@/lib/hooks/useScrollReveal';
import styles from './LandingShell.module.css';

const INTERACTIVE_SELECTOR = 'a, button, input, textarea, select, form, [role="button"]';
const MAX_RIPPLES = 3;

interface LandingShellProps {
  children: ReactNode;
}

export function LandingShell({ children }: LandingShellProps) {
  const shellRef = useRef<HTMLElement | null>(null);
  const activeRipples = useRef(0);
  const revealRef = useScrollReveal();

  const handleClick = useCallback((e: MouseEvent) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if ((e.target as HTMLElement).closest(INTERACTIVE_SELECTOR)) return;
    if (activeRipples.current >= MAX_RIPPLES) return;

    const container = shellRef.current;
    if (!container) return;

    const ripple = document.createElement('div');
    ripple.className = styles.ripple;
    ripple.setAttribute('aria-hidden', 'true');
    ripple.style.setProperty('--ripple-x', `${e.pageX}px`);
    ripple.style.setProperty('--ripple-y', `${e.pageY}px`);

    activeRipples.current += 1;
    container.appendChild(ripple);

    let removed = false;
    const cleanup = () => {
      if (removed) return;
      removed = true;
      ripple.remove();
      activeRipples.current -= 1;
    };

    ripple.addEventListener('animationend', cleanup, { once: true });
    setTimeout(cleanup, 2500);
  }, []);

  useEffect(() => {
    const el = shellRef.current;
    if (el) {
      el.addEventListener('click', handleClick);
    }
    return () => {
      if (el) {
        el.removeEventListener('click', handleClick);
      }
    };
  }, [handleClick]);

  const combinedRef = useCallback(
    (node: HTMLElement | null) => {
      shellRef.current = node;
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
