import type { Map as MapboxMap } from 'mapbox-gl';

export interface OverlayFadeParams {
  map: MapboxMap;
  layerId: string;
  fromOpacity: number;
  toOpacity: number;
  duration: number;
}

export function animateOverlayFade({
  map,
  layerId,
  fromOpacity,
  toOpacity,
  duration,
}: OverlayFadeParams): Promise<void> {
  return new Promise((resolve) => {
    const startTime = performance.now();

    function tick() {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const opacity = fromOpacity + (toOpacity - fromOpacity) * progress;

      const layer = map.getLayer(layerId);
      if (!layer) {
        resolve();
        return;
      }

      const type = layer.type;
      const opacityProp =
        type === 'raster'
          ? 'raster-opacity'
          : type === 'fill'
            ? 'fill-opacity'
            : type === 'line'
              ? 'line-opacity'
              : type === 'symbol'
                ? 'icon-opacity'
                : null;

      if (opacityProp) {
        map.setPaintProperty(layerId, opacityProp, opacity);
      }

      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        resolve();
      }
    }

    requestAnimationFrame(tick);
  });
}
