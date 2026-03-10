'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_RESUME_DELAY = 3000;

const SCROLL_INPUT_EVENTS = ['wheel', 'touchstart'] as const;

export function isScrollable(el: HTMLElement): boolean {
  if (el.scrollHeight <= el.clientHeight) return false;
  const overflow = getComputedStyle(el).overflowY;
  return overflow === 'auto' || overflow === 'scroll';
}

export function useScrollFollow({ resumeDelay = DEFAULT_RESUME_DELAY } = {}) {
  const scrollContainerRef = useRef<HTMLElement>(null);
  const [isFollowing, setIsFollowing] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const disengage = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || !isScrollable(container)) return;

    setIsFollowing(false);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setIsFollowing(true);
      timerRef.current = null;
    }, resumeDelay);
  }, [resumeDelay]);

  const reengage = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsFollowing(true);
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handler = () => disengage();

    for (const event of SCROLL_INPUT_EVENTS) {
      container.addEventListener(event, handler, { passive: true });
    }

    return () => {
      for (const event of SCROLL_INPUT_EVENTS) {
        container.removeEventListener(event, handler);
      }
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [disengage]);

  return { scrollContainerRef, isFollowing, reengage };
}
