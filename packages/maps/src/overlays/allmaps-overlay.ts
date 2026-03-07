import type { Map as MapboxMap, CustomLayerInterface } from 'mapbox-gl';

interface AllmapsOverlayOptions {
  map: MapboxMap;
  iiifManifestUrl: string;
}

let AllmapsModule: typeof import('@allmaps/maplibre') | null = null;

async function loadAllmaps(): Promise<typeof import('@allmaps/maplibre')> {
  if (!AllmapsModule) {
    AllmapsModule = await import('@allmaps/maplibre');
  }
  return AllmapsModule;
}

export async function addAllmapsOverlay({ map, iiifManifestUrl }: AllmapsOverlayOptions): Promise<string> {
  const allmaps = await loadAllmaps();
  const layerId = `allmaps-${Date.now()}`;

  const layer = new allmaps.WarpedMapLayer();
  map.addLayer(layer as unknown as CustomLayerInterface);

  await (layer as unknown as { addGeoreferenceAnnotationByUrl: (url: string) => Promise<void> }).addGeoreferenceAnnotationByUrl(iiifManifestUrl);

  return layerId;
}

export function removeAllmapsOverlay(map: MapboxMap, layerId: string): void {
  if (map.getLayer(layerId)) {
    map.removeLayer(layerId);
  }
}
