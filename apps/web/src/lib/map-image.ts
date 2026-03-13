import type { PlaceMetadata } from '@sotto/maps/server';
import { MAP_PRESETS } from '@sotto/maps/server';
import type { MapZoomFrame } from '@sotto/video';

export async function generateMapImage(
  place: PlaceMetadata,
  preset: string,
  width = 1280,
  height = 720,
): Promise<Buffer> {
  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) throw new Error('MAPBOX_ACCESS_TOKEN not configured');

  const presetConfig = MAP_PRESETS[preset as keyof typeof MAP_PRESETS];
  const styleId = presetConfig
    ? presetConfig.styleUrl.replace('mapbox://styles/', '')
    : 'mapbox/satellite-streets-v12';

  const [lng, lat] = place.coordinates;
  const zoom = 10;
  const url = `https://api.mapbox.com/styles/v1/${styleId}/static/${lng},${lat},${zoom},0/${width}x${height}@2x?access_token=${token}`;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Mapbox Static API error: ${response.status}`);

  return Buffer.from(await response.arrayBuffer());
}

/** Zoom levels for globe-to-location animation: globe → continent → region → city */
const ZOOM_LEVELS = [1.5, 4, 7, 10];

/**
 * Generate 4 map images at progressive zoom levels for globe-to-location animation.
 * Uses satellite style for globe/continent views (zoom < 5) since street-style tiles
 * render poorly at low zoom. Preset style kicks in at region/city level.
 */
export async function generateMapZoomFrames(
  place: PlaceMetadata,
  preset: string,
  width = 1280,
  height = 720,
): Promise<MapZoomFrame[]> {
  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) throw new Error('MAPBOX_ACCESS_TOKEN not configured');

  const presetConfig = MAP_PRESETS[preset as keyof typeof MAP_PRESETS];
  const presetStyleId = presetConfig
    ? presetConfig.styleUrl.replace('mapbox://styles/', '')
    : 'mapbox/satellite-streets-v12';

  const [lng, lat] = place.coordinates;

  const frames = await Promise.all(
    ZOOM_LEVELS.map(async (zoom) => {
      // Use satellite for globe/continent views; preset style for region/city
      const styleId = zoom < 5 ? 'mapbox/satellite-streets-v12' : presetStyleId;
      const url = `https://api.mapbox.com/styles/v1/${styleId}/static/${lng},${lat},${zoom},0/${width}x${height}@2x?access_token=${token}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Mapbox Static API error: ${response.status} at zoom ${zoom}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      return {
        zoom,
        assetUrl: `data:image/png;base64,${buffer.toString('base64')}`,
      };
    }),
  );

  return frames;
}
