'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import styles from './ScrollChapter.module.css';

interface ScrollChapterProps {
  children: ReactNode;
  id?: string;
  className?: string;
  /** Dark background variant (hero, convert) */
  dark?: boolean;
  /** Cream/alt background variant */
  alt?: boolean;
}

const THRESHOLDS = Array.from({ length: 11 }, (_, i) => i / 10);

export function ScrollChapter({
  children,
  id,
  className,
  dark,
  alt,
}: ScrollChapterProps) {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.style.setProperty('--scroll-progress', '1');
      el.setAttribute('data-active', '');
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const ratio = Math.round(entry.intersectionRatio * 100) / 100;
          el.style.setProperty('--scroll-progress', String(ratio));

          if (entry.isIntersecting && ratio > 0.1) {
            el.setAttribute('data-active', '');
          } else if (ratio < 0.05) {
            el.removeAttribute('data-active');
          }
        }
      },
      { threshold: THRESHOLDS }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const classNames = [
    styles.chapter,
    dark && styles.dark,
    alt && styles.alt,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section ref={sectionRef} id={id} className={classNames}>
      {children}
    </section>
  );
}
