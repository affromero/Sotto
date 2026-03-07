import { useCallback, useRef, useState } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import type { AnimationSequence, MapPresetId } from '../types';
import { animateCameraPath } from '../animations/camera-path';
import { MapView } from './MapView';
import styles from './MapSequence.module.css';

export interface MapSequenceProps {
  sequence: AnimationSequence;
  preset?: MapPresetId;
  mapboxToken: string;
  autoPlay?: boolean;
  onComplete?: () => void;
  onProgress?: (progress: number) => void;
  className?: string;
}

export function MapSequence({
  sequence,
  preset = 'cinematic',
  mapboxToken,
  autoPlay = false,
  onComplete,
  onProgress,
  className,
}: MapSequenceProps) {
  const [progress, setProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);

  const play = useCallback(() => {
    if (!mapRef.current || sequence.keyframes.length < 2) return;

    setIsPlaying(true);
    const { cancel, promise } = animateCameraPath(mapRef.current, sequence.keyframes, (p) => {
      setProgress(p);
      onProgress?.(p);
    });

    cancelRef.current = cancel;

    promise.then(() => {
      setIsPlaying(false);
      cancelRef.current = null;
      onComplete?.();
    });
  }, [sequence, onComplete, onProgress]);

  const stop = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
    setIsPlaying(false);
  }, []);

  const handleMapLoad = useCallback(
    (map: MapboxMap) => {
      mapRef.current = map;
      if (autoPlay) {
        // Defer to next tick to let map settle
        setTimeout(() => play(), 100);
      }
    },
    [autoPlay, play],
  );

  const firstKeyframe = sequence.keyframes[0];
  if (!firstKeyframe) return null;

  return (
    <div className={`${styles.root} ${className ?? ''}`}>
      <MapView
        center={firstKeyframe.center}
        zoom={firstKeyframe.zoom}
        pitch={firstKeyframe.pitch}
        bearing={firstKeyframe.bearing}
        preset={preset}
        mapboxToken={mapboxToken}
        interactive={!isPlaying}
        onMapLoad={handleMapLoad}
      />
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.playButton}
          onClick={isPlaying ? stop : play}
          aria-label={isPlaying ? 'Stop animation' : 'Play animation'}
        >
          {isPlaying ? '■' : '▶'}
        </button>
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: `${progress * 100}%` }} />
        </div>
        <span className={styles.duration}>{Math.round(sequence.totalDuration / 1000)}s</span>
      </div>
    </div>
  );
}
