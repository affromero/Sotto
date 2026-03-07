import type { Map as MapboxMap, FilterSpecification } from 'mapbox-gl';

const OHM_TILE_URL = 'https://vtiles.openhistoricalmap.org/maps/ohm/{z}/{x}/{y}.pbf';
const OHM_SOURCE_ID = 'ohm-tiles';

interface OHMOverlayOptions {
  map: MapboxMap;
  year?: number;
}

/**
 * Build a Mapbox GL filter that selects features whose [start_decdate, end_decdate]
 * range contains the given year. OHM tiles use decimal-year numbers
 * (e.g. 1453.5, -499.99) — NOT ISO date strings.
 */
function yearFilter(year: number): FilterSpecification {
  return [
    'all',
    ['has', 'start_decdate'],
    ['<=', ['get', 'start_decdate'], year],
    ['any',
      ['!', ['has', 'end_decdate']],
      ['>=', ['get', 'end_decdate'], year],
    ],
  ];
}

export function addOHMOverlay({ map, year }: OHMOverlayOptions): void {
  if (map.getSource(OHM_SOURCE_ID)) return;

  map.addSource(OHM_SOURCE_ID, {
    type: 'vector',
    tiles: [OHM_TILE_URL],
    maxzoom: 20,
  });

  const filter = year != null ? { filter: yearFilter(year) } : {};

  // Glow layer behind borders for visibility against satellite imagery
  map.addLayer({
    id: 'ohm-land-glow',
    type: 'line',
    source: OHM_SOURCE_ID,
    'source-layer': 'land_ohm_lines',
    paint: {
      'line-color': '#FFD700',
      'line-width': [
        'match', ['get', 'admin_level'],
        2, 10,
        3, 7,
        5,
      ],
      'line-opacity': 0.3,
      'line-blur': 4,
    },
    ...filter,
  });

  // Historical borders — bold colored lines by admin level
  map.addLayer({
    id: 'ohm-land-lines',
    type: 'line',
    source: OHM_SOURCE_ID,
    'source-layer': 'land_ohm_lines',
    paint: {
      'line-color': [
        'match', ['get', 'admin_level'],
        2, '#FF4444',   // national borders — bright red
        3, '#FFB347',   // provincial — orange
        4, '#DAA520',   // regional — goldenrod
        '#E8A317',      // default — amber
      ],
      'line-width': [
        'match', ['get', 'admin_level'],
        2, 4,
        3, 3,
        2,
      ],
      'line-opacity': 0.9,
    },
    ...filter,
  });

  // Maritime boundaries
  map.addLayer({
    id: 'ohm-maritime',
    type: 'line',
    source: OHM_SOURCE_ID,
    'source-layer': 'land_ohm_maritime',
    paint: {
      'line-color': '#60A5FA',
      'line-width': 2,
      'line-opacity': 0.7,
      'line-dasharray': [4, 3],
    },
    ...filter,
  });

  // Transport routes (roads, trade routes)
  map.addLayer({
    id: 'ohm-transport',
    type: 'line',
    source: OHM_SOURCE_ID,
    'source-layer': 'transport_lines',
    paint: {
      'line-color': '#D2691E',
      'line-width': 2,
      'line-opacity': 0.7,
      'line-dasharray': [6, 3],
    },
    ...filter,
  });

  // Route lines (trade routes, pilgrimage routes)
  map.addLayer({
    id: 'ohm-routes',
    type: 'line',
    source: OHM_SOURCE_ID,
    'source-layer': 'route_lines',
    paint: {
      'line-color': '#FF8C00',
      'line-width': 2.5,
      'line-opacity': 0.6,
      'line-dasharray': [3, 2],
    },
    ...filter,
  });

  // Territory labels (centroids of admin areas)
  map.addLayer({
    id: 'ohm-centroids',
    type: 'symbol',
    source: OHM_SOURCE_ID,
    'source-layer': 'land_ohm_centroids',
    layout: {
      'text-field': ['get', 'name'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 3, 13, 8, 18],
      'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.15,
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': '#FFFFFF',
      'text-halo-color': 'rgba(139, 0, 0, 0.9)',
      'text-halo-width': 2.5,
    },
    ...filter,
  });

  // Place labels
  map.addLayer({
    id: 'ohm-places',
    type: 'symbol',
    source: OHM_SOURCE_ID,
    'source-layer': 'place_points_centroids',
    layout: {
      'text-field': ['get', 'name'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 10, 15],
      'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
      'text-anchor': 'bottom',
      'text-offset': [0, -0.5],
    },
    paint: {
      'text-color': '#FFFFFF',
      'text-halo-color': 'rgba(60, 30, 0, 0.85)',
      'text-halo-width': 2,
    },
    ...filter,
  });
}

const OHM_LAYER_IDS = ['ohm-places', 'ohm-centroids', 'ohm-routes', 'ohm-transport', 'ohm-maritime', 'ohm-land-lines', 'ohm-land-glow'];

export function removeOHMOverlay(map: MapboxMap): void {
  for (const id of OHM_LAYER_IDS) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(OHM_SOURCE_ID)) map.removeSource(OHM_SOURCE_ID);
}

export function updateOHMYear(map: MapboxMap, year: number): void {
  const filter = yearFilter(year);
  for (const id of OHM_LAYER_IDS) {
    if (map.getLayer(id)) map.setFilter(id, filter);
  }
}
