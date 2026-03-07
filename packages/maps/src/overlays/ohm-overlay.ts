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

  // Historical borders — thick colored lines by admin level
  map.addLayer({
    id: 'ohm-land-lines',
    type: 'line',
    source: OHM_SOURCE_ID,
    'source-layer': 'land_ohm_lines',
    paint: {
      'line-color': [
        'match', ['get', 'admin_level'],
        2, '#B22222',   // national borders — red
        3, '#CD853F',   // provincial — tan
        4, '#8B6914',   // regional — dark gold
        '#8B4513',      // default — brown
      ],
      'line-width': [
        'match', ['get', 'admin_level'],
        2, 3,
        3, 2,
        1.5,
      ],
      'line-opacity': 0.85,
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
      'line-color': '#4682B4',
      'line-width': 1.5,
      'line-opacity': 0.6,
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
      'line-color': '#6B4423',
      'line-width': 1.5,
      'line-opacity': 0.6,
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
      'line-color': '#A0522D',
      'line-width': 2,
      'line-opacity': 0.5,
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
      'text-size': ['interpolate', ['linear'], ['zoom'], 3, 11, 8, 15],
      'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.1,
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': '#8B0000',
      'text-halo-color': 'rgba(255, 248, 230, 0.95)',
      'text-halo-width': 2,
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
      'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 10, 14],
      'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
      'text-anchor': 'bottom',
      'text-offset': [0, -0.5],
    },
    paint: {
      'text-color': '#3D1C00',
      'text-halo-color': 'rgba(255, 248, 230, 0.9)',
      'text-halo-width': 1.5,
    },
    ...filter,
  });
}

const OHM_LAYER_IDS = ['ohm-places', 'ohm-centroids', 'ohm-routes', 'ohm-transport', 'ohm-maritime', 'ohm-land-lines'];

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
