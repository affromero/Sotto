import type { Map as MapboxMap } from 'mapbox-gl';
import type { PlaceMetadata } from '../types';

export interface FlyToOptions {
  duration?: number;
  zoom?: number;
  pitch?: number;
  bearing?: number;
  curve?: number;
}

export function flyToPlace(
  map: MapboxMap,
  place: PlaceMetadata,
  options: FlyToOptions = {},
): Promise<void> {
  const { duration = 3000, zoom = 12, pitch = 0, bearing = 0, curve = 1.42 } = options;

  return new Promise((resolve) => {
    map.flyTo({
      center: place.coordinates,
      zoom,
      pitch,
      bearing,
      duration,
      curve,
      essential: true,
    });

    map.once('moveend', () => resolve());
  });
}

export function flyBetween(
  map: MapboxMap,
  from: PlaceMetadata,
  to: PlaceMetadata,
  duration: number = 5000,
  pitch: number = 45,
): Promise<void> {
  return flyToPlace(map, to, { duration, pitch, bearing: calculateBearing(from.coordinates, to.coordinates) });
}

function calculateBearing(from: [number, number], to: [number, number]): number {
  const [lng1, lat1] = from.map((d) => (d * Math.PI) / 180);
  const [lng2, lat2] = to.map((d) => (d * Math.PI) / 180);

  const dLng = lng2 - lng1;
  const x = Math.sin(dLng) * Math.cos(lat2);
  const y = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}
