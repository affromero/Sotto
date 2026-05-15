'use client';

import { useRef, useCallback, useEffect } from 'react';
import { useTrack } from '@/components/providers/EventProvider';

interface ImpressionEntry {
  podcastId: string;
  position: number;
  surface?: string;
  searchQuery?: string;
}

const VISIBILITY_THRESHOLD = 0.5;
const DWELL_TIME_MS = 1000;

/**
 * IntersectionObserver-based impression tracker.
 * Fires library.impression when a card is 50% visible for 1+ second.
 * Deduplicates per podcast per session.
 */
export function useImpressionTracker() {
  const track = useTrack();
  const observerRef = useRef<IntersectionObserver | null>(null);
  const seenRef = useRef(new Set<string>());
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const metadataRef = useRef(new Map<string, ImpressionEntry>());

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const podcastId = (entry.target as HTMLElement).dataset.podcastId;
          if (!podcastId) continue;

          if (entry.isIntersecting && entry.intersectionRatio >= VISIBILITY_THRESHOLD) {
            if (seenRef.current.has(podcastId)) continue;

            const timer = setTimeout(() => {
              if (seenRef.current.has(podcastId)) return;
              seenRef.current.add(podcastId);
              timersRef.current.delete(podcastId);

              const meta = metadataRef.current.get(podcastId);
              track({
                eventType: 'library.impression',
                podcastId,
                position: meta?.position ?? 0,
                surface: meta?.surface,
                searchQuery: meta?.searchQuery,
              });
            }, DWELL_TIME_MS);

            timersRef.current.set(podcastId, timer);
          } else {
            const existing = timersRef.current.get(podcastId!);
            if (existing) {
              clearTimeout(existing);
              timersRef.current.delete(podcastId!);
            }
          }
        }
      },
      { threshold: VISIBILITY_THRESHOLD }
    );

    const timers = timersRef.current;
    return () => {
      observerRef.current?.disconnect();
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
    };
  }, [track]);

  const observe = useCallback(
    (
      element: HTMLElement | null,
      podcastId: string,
      position: number,
      surface?: string,
      searchQuery?: string
    ) => {
      if (!element || !observerRef.current) return;

      element.dataset.podcastId = podcastId;
      metadataRef.current.set(podcastId, { podcastId, position, surface, searchQuery });
      observerRef.current.observe(element);
    },
    []
  );

  const reset = useCallback(() => {
    seenRef.current.clear();
    for (const timer of timersRef.current.values()) {
      clearTimeout(timer);
    }
    timersRef.current.clear();
  }, []);

  return { observe, reset };
}
