'use client';

import { useEffect, useRef } from 'react';
import styles from './PoweredByProviders.module.css';

interface ProviderEntry {
  name: string;
  brand: string;
}

const VOICE_PROVIDERS: ProviderEntry[] = [
  { name: 'ElevenLabs', brand: '#1A1A2E' },
  { name: 'OpenAI', brand: '#10A37F' },
  { name: 'PlayHT', brand: '#6C3AED' },
  { name: 'Cartesia', brand: '#38BDF8' },
  { name: 'Hume', brand: '#FF6B35' },
];

const AI_PROVIDERS: ProviderEntry[] = [
  { name: 'Anthropic', brand: '#D4A574' },
  { name: 'OpenAI', brand: '#10A37F' },
];

const AUTO_SPEED = 0.4; // px per frame (~24px/s at 60fps)

function Wordmark({ name, brand }: ProviderEntry) {
  return (
    <span
      className={styles.wordmark}
      style={{ '--brand': brand } as React.CSSProperties}
    >
      {name}
    </span>
  );
}

function MarqueeTrack({
  items,
  label,
  reverse,
}: {
  items: ProviderEntry[];
  label: string;
  reverse?: boolean;
}) {
  const tickerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const reducedMotion = useRef(false);

  useEffect(() => {
    reducedMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const ticker = tickerRef.current;
    const viewport = viewportRef.current;
    if (!ticker || !viewport) return;

    // Measure one group for seamless wrapping
    const firstGroup = ticker.children[0] as HTMLElement | undefined;
    if (!firstGroup) return;
    const groupWidth = firstGroup.offsetWidth;
    const halfWidth = groupWidth * 2; // 4 copies → wrap at 2

    const direction = reverse ? 1 : -1;
    let rafId: number;

    const animate = () => {
      if (!reducedMotion.current) {
        offsetRef.current += AUTO_SPEED * direction;

        // Seamless wrap
        if (offsetRef.current <= -halfWidth) {
          offsetRef.current += halfWidth;
        } else if (offsetRef.current >= 0) {
          offsetRef.current -= halfWidth;
        }

        ticker.style.transform = `translateX(${offsetRef.current}px)`;
      }
      rafId = requestAnimationFrame(animate);
    };

    // Trackpad / horizontal scroll → nudge position
    const onWheel = (e: WheelEvent) => {
      if (reducedMotion.current) return;
      if (Math.abs(e.deltaX) < 2) return;
      e.preventDefault();
      offsetRef.current -= e.deltaX * 1.5;
    };

    viewport.addEventListener('wheel', onWheel, { passive: false });
    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      viewport.removeEventListener('wheel', onWheel);
    };
  }, [reverse]);

  const group = items.flatMap((item, i) => {
    const els: React.ReactNode[] = [];
    if (i > 0) {
      els.push(<span key={`sep-${i}`} className={styles.sep} aria-hidden="true" />);
    }
    els.push(<Wordmark key={item.name} {...item} />);
    return els;
  });

  return (
    <div className={styles.track}>
      <span className={styles.trackLabel}>{label}</span>
      <div ref={viewportRef} className={styles.viewport}>
        <div className={styles.fadeLeft} aria-hidden="true" />
        <div className={styles.fadeRight} aria-hidden="true" />
        <div ref={tickerRef} className={styles.ticker}>
          {[0, 1, 2, 3].map((copy) => (
            <div key={copy} className={styles.tickerGroup} aria-hidden={copy > 0}>
              {group}
              <span className={styles.sep} aria-hidden="true" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PoweredByProviders() {
  return (
    <div className={styles.root}>
      <MarqueeTrack items={VOICE_PROVIDERS} label="Voice" />
      <MarqueeTrack items={AI_PROVIDERS} label="Intelligence" reverse />

      <div className={styles.security}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={styles.lockIcon}
        >
          <rect x="3" y="7" width="10" height="7" rx="1.5" />
          <path d="M5 7V5a3 3 0 0 1 6 0v2" />
        </svg>
        <span>Your API keys, AES-256 encrypted. We never see them.</span>
      </div>
    </div>
  );
}
