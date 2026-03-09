'use client';

import { useEffect, useRef, useCallback } from 'react';

interface UseScrollRevealOptions {
  threshold?: number;
  rootMargin?: string;
  once?: boolean;
}

/**
 * Hook that observes elements with [data-reveal] inside a container
 * and adds [data-visible] + --reveal-index when they enter the viewport.
 *
 * Returns a ref callback to attach to the container element.
 */
export function useScrollReveal(options: UseScrollRevealOptions = {}) {
  const { threshold = 0.08, rootMargin = '0px 0px -40px 0px', once = true } = options;
  const containerRef = useRef<HTMLElement | null>(null);

  const observe = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      container.querySelectorAll('[data-reveal]').forEach((el) => {
        el.setAttribute('data-visible', '');
      });
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.setAttribute('data-visible', '');
            if (once) {
              observer.unobserve(entry.target);
            }
          } else if (!once) {
            entry.target.removeAttribute('data-visible');
          }
        });
      },
      { threshold, rootMargin }
    );

    container.querySelectorAll('[data-reveal]').forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [threshold, rootMargin, once]);

  useEffect(() => {
    return observe();
  }, [observe]);

  const ref = useCallback(
    (node: HTMLElement | null) => {
      containerRef.current = node;
    },
    []
  );

  return ref;
}
