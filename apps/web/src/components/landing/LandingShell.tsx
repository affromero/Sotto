'use client';

import { useEffect, useRef, useCallback, type ReactNode } from 'react';
import styles from './LandingShell.module.css';

const INTERACTIVE_SELECTOR = 'a, button, input, textarea, select, form, [role="button"]';
const MAX_RIPPLES = 3;

interface LandingShellProps {
  children: ReactNode;
  revealClassName: string;
  visibleClassName: string;
}

export function LandingShell({ children, revealClassName, visibleClassName }: LandingShellProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const activeRipples = useRef(0);

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
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add(visibleClassName);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
    );
    document.querySelectorAll(`.${revealClassName}`).forEach((el) => observer.observe(el));

    const el = shellRef.current;
    if (el) {
      el.addEventListener('click', handleClick);
    }

    return () => {
      observer.disconnect();
      if (el) {
        el.removeEventListener('click', handleClick);
      }
    };
  }, [handleClick, revealClassName, visibleClassName]);

  return (
    <div ref={shellRef} className={styles.shell}>
      {children}
    </div>
  );
}
