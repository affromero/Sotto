'use client';

import { useState, useEffect, useCallback, useRef, FormEvent } from 'react';
import styles from './page.module.css';
import type { PitchManifest, PitchDocument } from '@/types/pitch';

const ANIMATION_DURATION = 400;
const SWIPE_THRESHOLD = 80;
const SWIPE_TIMEOUT = 200;
const TOUCH_MIN_DISTANCE = 50;

type SlotId = 'A' | 'B';
type AnimDirection = 'left' | 'right';

export default function PitchPage() {
  const [state, setState] = useState<'loading' | 'locked' | 'unlocked' | 'empty'>('loading');
  const [manifest, setManifest] = useState<PitchManifest | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<string>('');
  const [docIndex, setDocIndex] = useState(0);
  const [tocOpen, setTocOpen] = useState(false);

  // Dual-iframe slot state
  const [activeSlot, setActiveSlot] = useState<SlotId>('A');
  const [slotAIndex, setSlotAIndex] = useState(0);
  const [slotBIndex, setSlotBIndex] = useState(-1);
  const [animating, setAnimating] = useState(false);
  const [animDirection, setAnimDirection] = useState<AnimDirection | null>(null);

  // Password gate state
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Refs for swipe detection and scroll forwarding
  const contentRef = useRef<HTMLDivElement>(null);
  const slotAIframeRef = useRef<HTMLIFrameElement>(null);
  const slotBIframeRef = useRef<HTMLIFrameElement>(null);
  const swipeDeltaRef = useRef(0);
  const swipeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastTouchRef = useRef<{ x: number; y: number } | null>(null);

  const currentVersion = manifest?.versions.find((v) => v.date === selectedVersion);
  const documents = currentVersion?.documents ?? [];
  const selectedDoc: PitchDocument | undefined = documents[docIndex];
  const hasPrev = docIndex > 0;
  const hasNext = docIndex < documents.length - 1;

  const getActiveIframe = useCallback(() => {
    return activeSlot === 'A' ? slotAIframeRef.current : slotBIframeRef.current;
  }, [activeSlot]);

  const navigate = useCallback(
    (direction: AnimDirection) => {
      if (animating) return;

      const targetIndex = direction === 'left' ? docIndex + 1 : docIndex - 1;
      if (targetIndex < 0 || targetIndex >= documents.length) return;

      // Load target page into the inactive slot
      const inactiveSlot = activeSlot === 'A' ? 'B' : 'A';
      if (inactiveSlot === 'A') {
        setSlotAIndex(targetIndex);
      } else {
        setSlotBIndex(targetIndex);
      }

      // Start animation
      setAnimating(true);
      setAnimDirection(direction);

      // After animation completes, swap slots and update state
      setTimeout(() => {
        setActiveSlot(inactiveSlot);
        setDocIndex(targetIndex);
        setAnimating(false);
        setAnimDirection(null);
        setTocOpen(false);
      }, ANIMATION_DURATION);
    },
    [animating, docIndex, documents.length, activeSlot]
  );

  const goNext = useCallback(() => {
    if (docIndex < documents.length - 1) {
      navigate('left');
    }
  }, [docIndex, documents.length, navigate]);

  const goPrev = useCallback(() => {
    if (docIndex > 0) {
      navigate('right');
    }
  }, [docIndex, navigate]);

  const jumpToDoc = useCallback(
    (index: number) => {
      if (animating || index === docIndex) return;

      const direction: AnimDirection = index > docIndex ? 'left' : 'right';

      // Load target page into inactive slot
      const inactiveSlot = activeSlot === 'A' ? 'B' : 'A';
      if (inactiveSlot === 'A') {
        setSlotAIndex(index);
      } else {
        setSlotBIndex(index);
      }

      setAnimating(true);
      setAnimDirection(direction);

      setTimeout(() => {
        setActiveSlot(inactiveSlot);
        setDocIndex(index);
        setAnimating(false);
        setAnimDirection(null);
        setTocOpen(false);
      }, ANIMATION_DURATION);
    },
    [animating, docIndex, activeSlot]
  );

  // Keyboard navigation
  useEffect(() => {
    if (state !== 'unlocked') return;

    const SCROLL_STEP = 80;

    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? SCROLL_STEP : -SCROLL_STEP;
        try {
          getActiveIframe()?.contentWindow?.scrollBy(0, delta);
        } catch {
          /* cross-origin guard */
        }
      } else if (e.key === 'Escape') {
        setTocOpen(false);
      }
    }

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [state, goNext, goPrev, getActiveIframe]);

  // Trackpad swipe detection (wheel events)
  useEffect(() => {
    if (state !== 'unlocked') return;

    const el = contentRef.current;
    if (!el) return;

    function handleWheel(e: WheelEvent) {
      // Only handle pixel-based (trackpad), not line-based (mouse wheel)
      if (e.deltaMode !== 0) return;

      const absX = Math.abs(e.deltaX);
      const absY = Math.abs(e.deltaY);

      // Any horizontal component: suppress browser back/forward immediately
      if (absX > 0) {
        e.preventDefault();
      }

      // Vertical-dominant scrolling → forward to iframe
      if (absY > 2 * absX || absX < 2) {
        try {
          getActiveIframe()?.contentWindow?.scrollBy(0, e.deltaY);
        } catch {
          /* cross-origin guard */
        }
        return;
      }

      // Drain events while animating so they don't pile up
      if (animating) {
        swipeDeltaRef.current = 0;
        return;
      }

      swipeDeltaRef.current += e.deltaX;

      // Reset accumulator after inactivity
      if (swipeTimerRef.current) {
        clearTimeout(swipeTimerRef.current);
      }
      swipeTimerRef.current = setTimeout(() => {
        swipeDeltaRef.current = 0;
      }, SWIPE_TIMEOUT);

      if (swipeDeltaRef.current > SWIPE_THRESHOLD) {
        swipeDeltaRef.current = 0;
        goNext();
      } else if (swipeDeltaRef.current < -SWIPE_THRESHOLD) {
        swipeDeltaRef.current = 0;
        goPrev();
      }
    }

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
      if (swipeTimerRef.current) clearTimeout(swipeTimerRef.current);
    };
  }, [state, animating, goNext, goPrev, getActiveIframe]);

  // Touch swipe detection
  useEffect(() => {
    if (state !== 'unlocked') return;

    const el = contentRef.current;
    if (!el) return;

    function handleTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      const pos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      touchStartRef.current = pos;
      lastTouchRef.current = pos;
    }

    function handleTouchMove(e: TouchEvent) {
      if (!lastTouchRef.current || e.touches.length !== 1) return;

      const curX = e.touches[0].clientX;
      const curY = e.touches[0].clientY;
      const dy = curY - lastTouchRef.current.y;

      lastTouchRef.current = { x: curX, y: curY };

      // Forward vertical movement to iframe scroll
      if (Math.abs(dy) > 0) {
        try {
          getActiveIframe()?.contentWindow?.scrollBy(0, -dy);
        } catch {
          /* cross-origin guard */
        }
      }
    }

    function handleTouchEnd(e: TouchEvent) {
      if (!touchStartRef.current) return;
      if (e.changedTouches.length !== 1) return;

      const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
      const dy = e.changedTouches[0].clientY - touchStartRef.current.y;
      touchStartRef.current = null;
      lastTouchRef.current = null;

      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      // Must be mostly horizontal and meet minimum distance
      if (absDx < TOUCH_MIN_DISTANCE) return;
      if (absDy > absDx * 0.577) return; // ~30 degrees from horizontal

      if (dx < 0) {
        goNext(); // swipe left → next
      } else {
        goPrev(); // swipe right → prev
      }
    }

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: true });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [state, goNext, goPrev, getActiveIframe]);

  useEffect(() => {
    fetchManifest();
  }, []);

  async function fetchManifest() {
    try {
      const res = await fetch('/api/pitch/manifest');
      if (res.status === 401) {
        setState('locked');
        return;
      }
      if (res.status === 404) {
        setState('empty');
        return;
      }
      if (!res.ok) {
        setState('locked');
        return;
      }
      const data: PitchManifest = await res.json();
      setManifest(data);
      if (data.latest) {
        setSelectedVersion(data.latest);
        setDocIndex(0);
        setSlotAIndex(0);
        setSlotBIndex(-1);
        setActiveSlot('A');
      }
      setState('unlocked');
    } catch {
      setState('locked');
    }
  }

  async function handleAuth(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch('/api/pitch/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        setPassword('');
        await fetchManifest();
      } else {
        const data = await res.json();
        setError(data.error || 'Invalid password');
      }
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleVersionChange(date: string) {
    setSelectedVersion(date);
    setDocIndex(0);
    setSlotAIndex(0);
    setSlotBIndex(-1);
    setActiveSlot('A');
    setAnimating(false);
    setAnimDirection(null);
    setTocOpen(false);
  }

  function getSlotClassName(slot: SlotId): string {
    const isActive = slot === activeSlot;

    if (!animating) {
      return `${styles.iframeSlot} ${isActive ? styles.slotActive : styles.slotHidden}`;
    }

    // During animation
    if (isActive) {
      // Current page slides out
      const outClass = animDirection === 'left' ? styles.slideOutLeft : styles.slideOutRight;
      return `${styles.iframeSlot} ${outClass}`;
    } else {
      // Incoming page slides in
      const inClass = animDirection === 'left' ? styles.slideInFromRight : styles.slideInFromLeft;
      return `${styles.iframeSlot} ${inClass}`;
    }
  }

  function getIframeSrc(index: number): string {
    if (index < 0 || index >= documents.length) return 'about:blank';
    return `/api/pitch/${selectedVersion}/${documents[index].filename}`;
  }

  function getIframeTitle(index: number): string {
    if (index < 0 || index >= documents.length) return '';
    return documents[index].displayName;
  }

  if (state === 'loading') {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
      </div>
    );
  }

  if (state === 'locked') {
    return (
      <main className={styles.main}>
        <div className={styles.gateContainer}>
          <h1 className={styles.logo}>Sotto</h1>
          <p className={styles.subtitle}>Investor Materials</p>
          <form className={styles.form} onSubmit={handleAuth}>
            <input
              className={styles.input}
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              required
            />
            <button className={styles.button} type="submit" disabled={submitting}>
              {submitting ? 'Checking...' : 'Enter'}
            </button>
            {error && <p className={styles.error}>{error}</p>}
          </form>
        </div>
      </main>
    );
  }

  if (state === 'empty') {
    return (
      <main className={styles.main}>
        <div className={styles.gateContainer}>
          <h1 className={styles.logo}>Sotto</h1>
          <p className={styles.subtitle}>Investor Materials</p>
          <p className={styles.subtitle}>
            No pitch builds yet. Run the rebuild pipeline to generate.
          </p>
        </div>
      </main>
    );
  }

  return (
    <div className={styles.viewer}>
      {/* Top bar */}
      <header className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <a href="/romero" className={styles.topBarLogo}>
            Sotto
          </a>
          <span className={styles.topBarDivider} />
          {selectedDoc && <span className={styles.topBarTitle}>{selectedDoc.displayName}</span>}
        </div>
        <div className={styles.topBarRight}>
          <button
            className={styles.tocToggle}
            onClick={() => setTocOpen(!tocOpen)}
            aria-label="Table of contents"
          >
            <span className={styles.tocCounter}>
              {documents.length > 0 ? `${docIndex + 1} of ${documents.length}` : ''}
            </span>
            <svg
              className={`${styles.tocChevron} ${tocOpen ? styles.tocChevronOpen : ''}`}
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
            >
              <path
                d="M4 6l4 4 4-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {manifest && manifest.versions.length > 1 && (
            <select
              className={styles.versionSelect}
              value={selectedVersion}
              onChange={(e) => handleVersionChange(e.target.value)}
            >
              {manifest.versions.map((v) => (
                <option key={v.date} value={v.date}>
                  {v.date}
                  {v.date === manifest.latest ? ' (latest)' : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      </header>

      {/* Table of contents dropdown */}
      {tocOpen && (
        <>
          <div className={styles.tocBackdrop} onClick={() => setTocOpen(false)} />
          <nav className={styles.tocDropdown}>
            {documents.map((doc, i) => (
              <button
                key={doc.filename}
                className={`${styles.tocItem} ${i === docIndex ? styles.tocItemActive : ''}`}
                onClick={() => jumpToDoc(i)}
              >
                <span className={styles.tocItemNumber}>{i + 1}</span>
                <span className={styles.tocItemName}>{doc.displayName}</span>
              </button>
            ))}
          </nav>
        </>
      )}

      {/* Document content — dual-iframe slots */}
      <main className={styles.content} ref={contentRef}>
        {documents.length > 0 ? (
          <div className={styles.iframeContainer}>
            {/* Swipe overlay captures wheel/touch events above iframes */}
            <div className={styles.swipeOverlay} />

            {/* Slot A */}
            <div className={getSlotClassName('A')}>
              {slotAIndex >= 0 && (
                <iframe
                  ref={slotAIframeRef}
                  src={getIframeSrc(slotAIndex)}
                  title={getIframeTitle(slotAIndex)}
                />
              )}
            </div>

            {/* Slot B */}
            <div className={getSlotClassName('B')}>
              {slotBIndex >= 0 && (
                <iframe
                  ref={slotBIframeRef}
                  src={getIframeSrc(slotBIndex)}
                  title={getIframeTitle(slotBIndex)}
                />
              )}
            </div>
          </div>
        ) : (
          <div className={styles.emptyState}>
            No documents in this build. Run /update-pitch to generate.
          </div>
        )}
      </main>

      {/* Bottom navigation */}
      {documents.length > 0 && (
        <footer className={styles.bottomBar}>
          <button
            className={`${styles.navButton} ${!hasPrev ? styles.navButtonDisabled : ''}`}
            onClick={goPrev}
            disabled={!hasPrev || animating}
            aria-label="Previous document"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M10 12L6 8l4-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className={styles.navLabel}>
              {hasPrev ? documents[docIndex - 1].displayName : 'Previous'}
            </span>
          </button>
          <div className={styles.progressDots}>
            {documents.map((_, i) => (
              <button
                key={i}
                className={`${styles.dot} ${i === docIndex ? styles.dotActive : ''}`}
                onClick={() => jumpToDoc(i)}
                aria-label={`Go to document ${i + 1}`}
              />
            ))}
          </div>
          <button
            className={`${styles.navButton} ${styles.navButtonNext} ${!hasNext ? styles.navButtonDisabled : ''}`}
            onClick={goNext}
            disabled={!hasNext || animating}
            aria-label="Next document"
          >
            <span className={styles.navLabel}>
              {hasNext ? documents[docIndex + 1].displayName : 'Next'}
            </span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M6 4l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </footer>
      )}
    </div>
  );
}
