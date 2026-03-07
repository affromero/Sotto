import type { Map as MapboxMap, FilterSpecification } from 'mapbox-gl';

const OHM_TILE_URL = 'https://vtiles.openhistoricalmap.org/maps/osm/{z}/{x}/{y}.pbf';
const OHM_SOURCE_ID = 'ohm-tiles';

interface OHMOverlayOptions {
  map: MapboxMap;
  year?: number;
}

export function addOHMOverlay({ map, year }: OHMOverlayOptions): void {
  if (map.getSource(OHM_SOURCE_ID)) return;

  map.addSource(OHM_SOURCE_ID, {
    type: 'vector',
    tiles: [OHM_TILE_URL],
    maxzoom: 14,
  });

  // Add boundary layer with year filtering
  map.addLayer({
    id: 'ohm-boundaries',
    type: 'line',
    source: OHM_SOURCE_ID,
    'source-layer': 'boundaries',
    paint: {
      'line-color': '#8B4513',
      'line-width': 1.5,
      'line-opacity': 0.7,
      'line-dasharray': [4, 2],
    },
    ...(year != null
      ? {
          filter: [
            'all',
            ['<=', ['get', 'start_date'], String(year)],
            ['any', ['!', ['has', 'end_date']], ['>=', ['get', 'end_date'], String(year)]],
          ],
        }
      : {}),
  });

  // Add place labels
  map.addLayer({
    id: 'ohm-places',
    type: 'symbol',
    source: OHM_SOURCE_ID,
    'source-layer': 'place',
    layout: {
      'text-field': ['get', 'name'],
      'text-size': 12,
      'text-font': ['DIN Pro Regular', 'Arial Unicode MS Regular'],
    },
    paint: {
      'text-color': '#5C3317',
      'text-halo-color': 'rgba(255,255,255,0.8)',
      'text-halo-width': 1,
    },
    ...(year != null
      ? {
          filter: [
            'all',
            ['<=', ['get', 'start_date'], String(year)],
            ['any', ['!', ['has', 'end_date']], ['>=', ['get', 'end_date'], String(year)]],
          ],
        }
      : {}),
  });
}

export function removeOHMOverlay(map: MapboxMap): void {
  if (map.getLayer('ohm-places')) map.removeLayer('ohm-places');
  if (map.getLayer('ohm-boundaries')) map.removeLayer('ohm-boundaries');
  if (map.getSource(OHM_SOURCE_ID)) map.removeSource(OHM_SOURCE_ID);
}

export function updateOHMYear(map: MapboxMap, year: number): void {
  const yearFilter = [
    'all',
    ['<=', ['get', 'start_date'], String(year)],
    ['any', ['!', ['has', 'end_date']], ['>=', ['get', 'end_date'], String(year)]],
  ] as FilterSpecification;

  if (map.getLayer('ohm-boundaries')) map.setFilter('ohm-boundaries', yearFilter);
  if (map.getLayer('ohm-places')) map.setFilter('ohm-places', yearFilter);
}
