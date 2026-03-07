import type { Map as MapboxMap } from 'mapbox-gl';
import type { CameraKeyframe } from '../types';

type EasingFn = (t: number) => number;

const EASING_FUNCTIONS: Record<CameraKeyframe['easing'], EasingFn> = {
  linear: (t) => t,
  easeIn: (t) => t * t,
  easeOut: (t) => t * (2 - t),
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpCoords(a: [number, number], b: [number, number], t: number): [number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
}

export function interpolateKeyframes(
  from: CameraKeyframe,
  to: CameraKeyframe,
  progress: number,
): { center: [number, number]; zoom: number; pitch: number; bearing: number } {
  const easing = EASING_FUNCTIONS[to.easing];
  const t = easing(progress);

  return {
    center: lerpCoords(from.center, to.center, t),
    zoom: lerp(from.zoom, to.zoom, t),
    pitch: lerp(from.pitch, to.pitch, t),
    bearing: lerp(from.bearing, to.bearing, t),
  };
}

export function animateCameraPath(
  map: MapboxMap,
  keyframes: CameraKeyframe[],
  onProgress?: (progress: number) => void,
): { cancel: () => void; promise: Promise<void> } {
  if (keyframes.length < 2) {
    return { cancel: () => {}, promise: Promise.resolve() };
  }

  let cancelled = false;
  let animationFrame: number | null = null;

  const totalDuration = keyframes.reduce((sum, kf) => sum + kf.duration, 0);

  const promise = new Promise<void>((resolve) => {
    const startTime = performance.now();

    function tick() {
      if (cancelled) {
        resolve();
        return;
      }

      const elapsed = performance.now() - startTime;
      const globalProgress = Math.min(elapsed / totalDuration, 1);
      onProgress?.(globalProgress);

      // Find current keyframe pair
      let accumulated = 0;
      for (let i = 1; i < keyframes.length; i++) {
        const segmentDuration = keyframes[i].duration;
        if (elapsed <= accumulated + segmentDuration) {
          const segmentProgress = (elapsed - accumulated) / segmentDuration;
          const interpolated = interpolateKeyframes(keyframes[i - 1], keyframes[i], segmentProgress);

          map.jumpTo({
            center: interpolated.center,
            zoom: interpolated.zoom,
            pitch: interpolated.pitch,
            bearing: interpolated.bearing,
          });
          break;
        }
        accumulated += segmentDuration;
      }

      if (globalProgress < 1) {
        animationFrame = requestAnimationFrame(tick);
      } else {
        // Snap to final keyframe
        const last = keyframes[keyframes.length - 1];
        map.jumpTo({
          center: last.center,
          zoom: last.zoom,
          pitch: last.pitch,
          bearing: last.bearing,
        });
        resolve();
      }
    }

    animationFrame = requestAnimationFrame(tick);
  });

  return {
    cancel: () => {
      cancelled = true;
      if (animationFrame != null) {
        cancelAnimationFrame(animationFrame);
      }
    },
    promise,
  };
}
