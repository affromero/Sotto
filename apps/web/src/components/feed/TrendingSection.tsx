'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PodcastCard } from '@/components/feed/PodcastCard';
import type { PodcastSummary } from '@/types/podcast';
import styles from './TrendingSection.module.css';

interface TrendingSectionProps {
  podcasts: PodcastSummary[];
  onPlay?: (id: string) => void;
}

const AUTO_ADVANCE_MS = 6000;

export function TrendingSection({ podcasts, onPlay }: TrendingSectionProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const scrollToIndex = useCallback((index: number) => {
    const container = scrollRef.current;
    if (!container) return;
    const child = container.children[index] as HTMLElement | undefined;
    if (child) {
      container.scrollTo({ left: child.offsetLeft - container.offsetLeft, behavior: 'smooth' });
    }
    setActiveIndex(index);
  }, []);

  // Auto-advance
  useEffect(() => {
    if (paused || podcasts.length <= 1) return;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;

    timerRef.current = setTimeout(() => {
      const next = (activeIndex + 1) % podcasts.length;
      scrollToIndex(next);
    }, AUTO_ADVANCE_MS);

    return () => clearTimeout(timerRef.current);
  }, [activeIndex, paused, podcasts.length, scrollToIndex]);

  // Track scroll position for dot indicators
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const onScroll = () => {
      const scrollLeft = container.scrollLeft;
      const childWidth = (container.firstElementChild as HTMLElement)?.offsetWidth ?? 1;
      const gap = 16; // matches --space-4
      const idx = Math.round(scrollLeft / (childWidth + gap));
      setActiveIndex(Math.min(idx, podcasts.length - 1));
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [podcasts.length]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      scrollToIndex(Math.min(activeIndex + 1, podcasts.length - 1));
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      scrollToIndex(Math.max(activeIndex - 1, 0));
    }
  }, [activeIndex, podcasts.length, scrollToIndex]);

  if (podcasts.length === 0) {
    return null;
  }

  return (
    <section
      className={styles.root}
      aria-label="Trending podcasts"
      aria-roledescription="carousel"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onKeyDown={handleKeyDown}
    >
      <div className={styles.header}>
        <h2 className={styles.heading}>Trending</h2>
        <Link href="/feed?sort=trending" className={styles.seeAll}>
          See all
        </Link>
      </div>
      <div
        ref={scrollRef}
        className={styles.carousel}
        role="region"
        aria-live="polite"
        tabIndex={0}
      >
        {podcasts.map((podcast, i) => (
          <div
            key={podcast.id}
            className={styles.slide}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${podcasts.length}`}
          >
            <PodcastCard
              podcast={podcast}
              onPlay={onPlay}
            />
          </div>
        ))}
      </div>
      {podcasts.length > 1 && (
        <div className={styles.dots} role="tablist" aria-label="Carousel navigation">
          {podcasts.map((_, i) => (
            <button
              key={i}
              className={`${styles.dot} ${i === activeIndex ? styles.dotActive : ''}`}
              onClick={() => scrollToIndex(i)}
              role="tab"
              aria-selected={i === activeIndex}
              aria-label={`Go to slide ${i + 1}`}
              type="button"
            />
          ))}
        </div>
      )}
    </section>
  );
}
