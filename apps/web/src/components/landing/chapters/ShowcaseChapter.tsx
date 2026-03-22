'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ScrollChapter } from '../ScrollChapter';
import styles from './ShowcaseChapter.module.css';

interface ShowcaseItem {
  visualType: string;
  label: string;
  description: string;
  url: string;
  mediaType: 'image' | 'video';
  credits?: string;
}

const AUTO_ADVANCE_MS = 5000;

function ShowcaseCarousel({ items }: { items: ShowcaseItem[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const goTo = useCallback((index: number) => {
    setActiveIndex(index);
    setPaused(true);
    if (timerRef.current) clearInterval(timerRef.current);
    const resumeTimer = setTimeout(() => setPaused(false), 8000);
    return () => clearTimeout(resumeTimer);
  }, []);

  useEffect(() => {
    if (paused) return;
    const interval = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % items.length);
    }, AUTO_ADVANCE_MS);
    timerRef.current = interval;
    return () => clearInterval(interval);
  }, [paused, items.length]);

  useEffect(() => {
    const nextIndex = (activeIndex + 1) % items.length;
    const next = items[nextIndex];
    if (next?.mediaType === 'video') {
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = next.url;
      document.head.appendChild(link);
      return () => { link.remove(); };
    }
  }, [activeIndex, items]);

  const active = items[activeIndex];

  return (
    <div
      className={styles.carousel}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className={styles.featured}>
        <div className={styles.featuredMedia}>
          {active.mediaType === 'video' ? (
            <video
              ref={videoRef}
              key={active.url}
              src={active.url}
              className={styles.featuredVideo}
              autoPlay
              loop
              muted
              playsInline
            />
          ) : (
            <img src={active.url} alt={active.label} className={styles.featuredVideo} />
          )}
          {active.credits && (
            <span className={styles.featuredCredits}>{active.credits}</span>
          )}
        </div>
        <div className={styles.featuredInfo}>
          <span className={styles.featuredLabel}>{active.label}</span>
          <p className={styles.featuredDesc}>{active.description}</p>
        </div>
      </div>

      <div className={styles.rail}>
        {items.map((item, i) => (
          <button
            key={item.visualType}
            type="button"
            className={`${styles.thumb} ${i === activeIndex ? styles.thumbActive : ''}`}
            onClick={() => goTo(i)}
            aria-label={item.label}
            aria-pressed={i === activeIndex}
          >
            <span className={styles.thumbLabel}>{item.label}</span>
            {i === activeIndex && !paused && (
              <span className={styles.thumbProgress} />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ShowcaseChapter() {
  const [showcaseItems, setShowcaseItems] = useState<ShowcaseItem[] | null>(null);
  const [showcaseName, setShowcaseName] = useState('');

  useEffect(() => {
    fetch('/api/showcase')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.items?.length > 0) {
          setShowcaseItems(data.items);
          setShowcaseName(data.name ?? '');
        }
      })
      .catch(() => {});
  }, []);

  if (!showcaseItems || showcaseItems.length === 0) {
    return null;
  }

  return (
    <ScrollChapter id="video" dark>
      <div className={styles.root}>
        <div className={styles.showcaseHeader} data-reveal>
          <span className={styles.overline}>Video generation</span>
          <h2 className={styles.heading}>Turn podcasts into video</h2>
          <p className={styles.description}>
            {showcaseName
              ? <>From a podcast about <strong>{showcaseName}</strong>, here is what the system generated — each visual matched to what the hosts are discussing.</>
              : <>Every segment gets a matching visual — data charts, timelines, maps, illustrations, and more.</>
            }
          </p>
        </div>
        <ShowcaseCarousel items={showcaseItems} />
      </div>
    </ScrollChapter>
  );
}
