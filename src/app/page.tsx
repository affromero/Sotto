'use client';

import { useEffect, useCallback, useRef } from 'react';
import styles from './page.module.css';

const INTERACTIVE_SELECTOR = 'a, button, input, textarea, select, [role="button"]';
const MAX_RIPPLES = 3;

export default function UnderConstructionPage() {
  const pageRef = useRef<HTMLDivElement>(null);
  const activeRipples = useRef(0);

  const handlePageClick = useCallback((e: MouseEvent) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if ((e.target as HTMLElement).closest(INTERACTIVE_SELECTOR)) return;
    if (activeRipples.current >= MAX_RIPPLES) return;

    const container = pageRef.current;
    if (!container) return;

    const ripple = document.createElement('div');
    ripple.className = styles.ripple;
    ripple.setAttribute('aria-hidden', 'true');
    ripple.style.setProperty('--ripple-x', `${e.clientX}px`);
    ripple.style.setProperty('--ripple-y', `${e.clientY}px`);

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
    const pageEl = pageRef.current;
    if (pageEl) {
      pageEl.addEventListener('click', handlePageClick);
    }
    return () => {
      if (pageEl) {
        pageEl.removeEventListener('click', handlePageClick);
      }
    };
  }, [handlePageClick]);

  return (
    <div ref={pageRef} className={styles.page}>
      <main className={styles.center}>
        <h1 className={styles.title}>Sotto</h1>
        <p className={styles.subtitle}>Under Construction</p>
      </main>
    </div>
  );
}
