import type { Map as MapboxMap, CustomLayerInterface } from 'mapbox-gl';

const ALLMAPS_API = 'https://api.allmaps.org';
const LAYER_ID = 'allmaps-warped';

interface AllmapsOverlayOptions {
  map: MapboxMap;
  iiifManifestUrl?: string;
  coordinates?: [number, number];
  bbox?: [number, number, number, number];
}

interface AllmapsMapResult {
  id: string;
  type: string;
  created: string;
}

let AllmapsModule: typeof import('@allmaps/maplibre') | null = null;
let activeLayer: unknown = null;

async function loadAllmaps(): Promise<typeof import('@allmaps/maplibre')> {
  if (!AllmapsModule) {
    AllmapsModule = await import('@allmaps/maplibre');
  }
  return AllmapsModule;
}

/**
 * Search Allmaps for georeferenced historical maps near given coordinates.
 * Returns annotation URLs that can be passed to WarpedMapLayer.
 */
export async function findHistoricalMaps(
  coordinates: [number, number],
  radiusDeg = 0.5,
): Promise<AllmapsMapResult[]> {
  const [lng, lat] = coordinates;
  const bbox = `${lng - radiusDeg},${lat - radiusDeg},${lng + radiusDeg},${lat + radiusDeg}`;
  const res = await fetch(`${ALLMAPS_API}/maps?bbox=${bbox}&limit=5`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/**
 * Add a georeferenced historical map overlay using either:
 * - A specific IIIF manifest URL
 * - Auto-search by coordinates (finds nearest georeferenced maps)
 */
export async function addAllmapsOverlay({ map, iiifManifestUrl, coordinates, bbox }: AllmapsOverlayOptions): Promise<boolean> {
  const allmaps = await loadAllmaps();

  // Remove existing layer if any
  removeAllmapsOverlay(map);

  const layer = new allmaps.WarpedMapLayer();
  activeLayer = layer;
  map.addLayer(layer as unknown as CustomLayerInterface, getFirstSymbolLayerId(map));

  const warpedLayer = layer as unknown as {
    addGeoreferenceAnnotationByUrl: (url: string) => Promise<void>;
    addGeoreferencedMap: (map: unknown) => Promise<void>;
  };

  try {
    if (iiifManifestUrl) {
      // Use specific IIIF manifest
      const annotationUrl = `https://annotations.allmaps.org/?url=${encodeURIComponent(iiifManifestUrl)}`;
      await warpedLayer.addGeoreferenceAnnotationByUrl(annotationUrl);
      return true;
    }

    if (coordinates || bbox) {
      // Search for georeferenced maps near the coordinates
      const [lng, lat] = coordinates ?? [(bbox![0] + bbox![2]) / 2, (bbox![1] + bbox![3]) / 2];
      const maps = await findHistoricalMaps([lng, lat]);

      if (maps.length === 0) return false;

      // Add the first available georeferenced map
      for (const m of maps) {
        try {
          await warpedLayer.addGeoreferenceAnnotationByUrl(m.id);
          return true;
        } catch {
          // This map might not load, try next
          continue;
        }
      }
      return false;
    }

    return false;
  } catch {
    removeAllmapsOverlay(map);
    return false;
  }
}

export function removeAllmapsOverlay(map: MapboxMap): void {
  if (activeLayer && map.getLayer(LAYER_ID)) {
    map.removeLayer(LAYER_ID);
  }
  activeLayer = null;
}

function getFirstSymbolLayerId(map: MapboxMap): string | undefined {
  const layers = map.getStyle()?.layers;
  if (!layers) return undefined;
  for (const layer of layers) {
    if (layer.type === 'symbol') return layer.id;
  }
  return undefined;
}
