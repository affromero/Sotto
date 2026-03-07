import type { Map as MapboxMap } from 'mapbox-gl';

export interface MaskRevealParams {
  map: MapboxMap;
  geojson: GeoJSON.Feature<GeoJSON.Polygon>;
  layerId?: string;
  duration: number;
  fillColor?: string;
  fillOpacity?: number;
}

export function animateMaskReveal({
  map,
  geojson,
  layerId = `mask-reveal-${Date.now()}`,
  duration,
  fillColor = '#D97706',
  fillOpacity = 0.3,
}: MaskRevealParams): Promise<string> {
  const sourceId = `${layerId}-source`;

  map.addSource(sourceId, {
    type: 'geojson',
    data: geojson,
  });

  map.addLayer({
    id: layerId,
    type: 'fill',
    source: sourceId,
    paint: {
      'fill-color': fillColor,
      'fill-opacity': 0,
    },
  });

  return new Promise((resolve) => {
    const startTime = performance.now();

    function tick() {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = progress * (2 - progress); // easeOut

      map.setPaintProperty(layerId, 'fill-opacity', eased * fillOpacity);

      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        resolve(layerId);
      }
    }

    requestAnimationFrame(tick);
  });
}
