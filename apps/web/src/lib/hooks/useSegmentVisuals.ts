'use client';

import { useState, useEffect, useCallback } from 'react';
import type { SegmentVisualData } from '@/lib/segment-utils';

interface UseSegmentVisualsResult {
  visuals: SegmentVisualData[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useSegmentVisuals(episodeId: string | null): UseSegmentVisualsResult {
  const [visuals, setVisuals] = useState<SegmentVisualData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchVisuals = useCallback(async () => {
    if (!episodeId) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/episodes/${episodeId}/video`);
      if (!res.ok) {
        setIsLoading(false);
        return;
      }
      const data = await res.json();
      if (data?.status === 'READY' && data.segmentVisuals?.length > 0) {
        setVisuals(data.segmentVisuals);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch visuals');
    } finally {
      setIsLoading(false);
    }
  }, [episodeId]);

  useEffect(() => {
    fetchVisuals();
  }, [fetchVisuals]);

  return { visuals, isLoading, error, refresh: fetchVisuals };
}
