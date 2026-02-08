'use client';

import { useState, useEffect, useCallback } from 'react';
import { PodcastDetail } from '@/types/podcast';

interface UsePodcastReturn {
  podcast: PodcastDetail | null;
  isLoading: boolean;
  error: string | null;
  like: () => Promise<void>;
  unlike: () => Promise<void>;
  save: () => Promise<void>;
  unsave: () => Promise<void>;
  fork: () => Promise<string | null>;
}

export function usePodcast(podcastId: string): UsePodcastReturn {
  const [podcast, setPodcast] = useState<PodcastDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchPodcast() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/podcasts/${podcastId}`);
        if (!response.ok) {
          throw new Error(response.status === 404 ? 'Podcast not found' : 'Failed to fetch podcast');
        }
        const data: PodcastDetail = await response.json();
        if (!cancelled) {
          setPodcast(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'An unexpected error occurred');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchPodcast();

    return () => {
      cancelled = true;
    };
  }, [podcastId]);

  const like = useCallback(async () => {
    if (!podcast) return;

    // Optimistic update
    setPodcast((prev) =>
      prev ? { ...prev, isLiked: true, likeCount: prev.likeCount + 1 } : prev
    );

    try {
      const response = await fetch(`/api/podcasts/${podcastId}/like`, { method: 'POST' });
      if (!response.ok) {
        throw new Error('Failed to like podcast');
      }
    } catch {
      // Revert optimistic update
      setPodcast((prev) =>
        prev ? { ...prev, isLiked: false, likeCount: prev.likeCount - 1 } : prev
      );
    }
  }, [podcast, podcastId]);

  const unlike = useCallback(async () => {
    if (!podcast) return;

    // Optimistic update
    setPodcast((prev) =>
      prev ? { ...prev, isLiked: false, likeCount: prev.likeCount - 1 } : prev
    );

    try {
      const response = await fetch(`/api/podcasts/${podcastId}/like`, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error('Failed to unlike podcast');
      }
    } catch {
      // Revert optimistic update
      setPodcast((prev) =>
        prev ? { ...prev, isLiked: true, likeCount: prev.likeCount + 1 } : prev
      );
    }
  }, [podcast, podcastId]);

  const save = useCallback(async () => {
    if (!podcast) return;

    // Optimistic update
    setPodcast((prev) =>
      prev ? { ...prev, isSaved: true, saveCount: prev.saveCount + 1 } : prev
    );

    try {
      const response = await fetch(`/api/podcasts/${podcastId}/save`, { method: 'POST' });
      if (!response.ok) {
        throw new Error('Failed to save podcast');
      }
    } catch {
      // Revert optimistic update
      setPodcast((prev) =>
        prev ? { ...prev, isSaved: false, saveCount: prev.saveCount - 1 } : prev
      );
    }
  }, [podcast, podcastId]);

  const unsave = useCallback(async () => {
    if (!podcast) return;

    // Optimistic update
    setPodcast((prev) =>
      prev ? { ...prev, isSaved: false, saveCount: prev.saveCount - 1 } : prev
    );

    try {
      const response = await fetch(`/api/podcasts/${podcastId}/save`, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error('Failed to unsave podcast');
      }
    } catch {
      // Revert optimistic update
      setPodcast((prev) =>
        prev ? { ...prev, isSaved: true, saveCount: prev.saveCount + 1 } : prev
      );
    }
  }, [podcast, podcastId]);

  const fork = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch(`/api/podcasts/${podcastId}/fork`, { method: 'POST' });
      if (!response.ok) {
        throw new Error('Failed to fork podcast');
      }
      const data = await response.json();

      // Update fork count optimistically
      setPodcast((prev) =>
        prev ? { ...prev, forkCount: prev.forkCount + 1 } : prev
      );

      return data.id as string;
    } catch {
      return null;
    }
  }, [podcastId]);

  return { podcast, isLoading, error, like, unlike, save, unsave, fork };
}
