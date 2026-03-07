import type { Map as MapboxMap, FilterSpecification } from 'mapbox-gl';

const OHM_TILE_URL = 'https://vtiles.openhistoricalmap.org/maps/ohm/{z}/{x}/{y}.pbf';
const OHM_SOURCE_ID = 'ohm-tiles';

interface OHMOverlayOptions {
  map: MapboxMap;
  year?: number;
}

function yearFilter(year: number): FilterSpecification {
  const yearStr = String(year);
  return [
    'all',
    ['<=', ['get', 'start_date'], yearStr],
    ['any', ['!', ['has', 'end_date']], ['>=', ['get', 'end_date'], yearStr]],
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

  // Historical borders (land boundaries)
  map.addLayer({
    id: 'ohm-land-lines',
    type: 'line',
    source: OHM_SOURCE_ID,
    'source-layer': 'land_ohm_lines',
    paint: {
      'line-color': '#8B4513',
      'line-width': 2,
      'line-opacity': 0.8,
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
      'line-width': 1,
      'line-opacity': 0.5,
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

const OHM_LAYER_IDS = ['ohm-places', 'ohm-transport', 'ohm-land-lines'];

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
