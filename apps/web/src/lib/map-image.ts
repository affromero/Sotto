import type { PlaceMetadata } from '@sotto/maps';
import { MAP_PRESETS } from '@sotto/maps';

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
