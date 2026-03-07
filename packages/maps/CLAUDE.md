# @sotto/maps

Rich map visuals for Sotto podcasts — historical and modern. Johnny Harris documentary style.

## Structure

```
src/
  types.ts              # Core types: PlaceMetadata, MapPreset, CameraKeyframe, etc.
  index.ts              # Barrel export
  resolver/             # Place name → coordinates resolution
    place-resolver.ts   # PlaceResolver class (resolve, resolveBatch, resolveHistorical)
    cache.ts            # In-memory LRU cache with TTL
    gazetteers/         # External API clients
      whg.ts            # World Historical Gazetteer
      geonames.ts       # GeoNames
      pleiades.ts       # Pleiades (ancient world)
  presets/              # Map style presets (vintage, satellite, cinematic, etc.)
  components/           # React components (MapView, HistoricalMap, DualEraView, etc.)
  hooks/                # React hooks (useMapbox)
  overlays/             # Historical map overlays (Allmaps IIIF, OpenHistoricalMap)
  animations/           # Camera animation primitives
  remotion/             # Remotion compositions for video pipeline
tests/                  # Vitest tests mirroring src/ structure
```

## Commands

```bash
npx tsc --noEmit          # Type-check
npx vitest run            # Run tests
npx vitest                # Watch mode
```

## Env vars (Doppler)

- `GEONAMES_USERNAME` — GeoNames API (free tier)
- `MAPBOX_ACCESS_TOKEN` — Server-side Mapbox (static images)
- `NEXT_PUBLIC_MAPBOX_TOKEN` — Client-side Mapbox (playground)

## Patterns

- Gazetteer clients implement `GazetteerClient` interface
- PlaceResolver queries gazetteers in priority order: WHG → GeoNames → Pleiades
- Cache: in-memory LRU (500 entries, 24h TTL)
- Components follow `Name.tsx` + `Name.module.css` pattern
- Mapbox GL CSS must be imported by consumers (not bundled)
