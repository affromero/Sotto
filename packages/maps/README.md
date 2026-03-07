<div align="center">

# @sotto/maps

**Rich historical & modern map visuals for content-synced media**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18%2F19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Mapbox GL](https://img.shields.io/badge/Mapbox_GL-3.9-000000?logo=mapbox&logoColor=white)](https://docs.mapbox.com/mapbox-gl-js/)
[![Vitest](https://img.shields.io/badge/Vitest-3.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![License](https://img.shields.io/badge/License-Private-red)](#)

*Johnny Harris documentary-style map visuals: vintage overlays, cinematic fly-ins, before/after comparisons, historical context — all in a single package designed for content-synced media.*

</div>

---

## Why this exists

Sotto podcasts often reference real places — historical and modern. We wanted to render rich map visuals showing both the **modern location** and **historical context**: vintage map overlays, cinematic 3D fly-ins, before/after views, annotations. The pieces exist separately across different libraries, but nobody has combined them into a **single unified package** — especially not one designed for **content-synced media** (podcasts, videos, interactive timelines).

## Comparison with existing solutions

| Feature | **@sotto/maps** | [react-map-gl](https://visgl.github.io/react-map-gl/) | [Leaflet](https://leafletjs.com/) / react-leaflet | [deck.gl](https://deck.gl/) | [MapLibre GL](https://maplibre.org/) | [Allmaps](https://allmaps.org/) | Manual Mapbox GL |
|---|---|---|---|---|---|---|---|
| **React components** | Built-in (`MapView`, `HistoricalMap`, `DualEraView`) | Yes | Yes | Yes | Community wrappers | No | Manual |
| **Map presets** (vintage, cinematic, dark, etc.) | 6 built-in presets with texture overlays | No | No | No | No | No | Manual per-project |
| **3D terrain** | One-line (`preset="cinematic"`) | Manual setup | No | Yes (mesh layers) | Manual setup | No | Manual setup |
| **Historical map overlays** (IIIF warping) | Built-in via Allmaps integration | No | Plugin required | No | Plugin required | Core feature (standalone) | Manual integration |
| **OpenHistoricalMap tiles** | Built-in with year filtering | No | No | No | No | No | Manual tile source |
| **Before/after comparison** | 3 modes (side-by-side, slider, overlay-fade) | No | No | No | No | No | Manual |
| **Time slider** with event markers | Built-in `TimeSlider` component | No | No | No | No | No | Manual |
| **Place resolution** (name → coordinates) | Multi-gazetteer (WHG, GeoNames, Pleiades) | No | No | No | No | No | External service |
| **Historical place bias** | `resolveHistorical()` — biases WHG/Pleiades | No | No | No | No | No | N/A |
| **Camera animations** | `SequenceBuilder`, cinematic fly-betweens | No | No | Yes (transitions) | No | No | Manual `flyTo()` |
| **Animation sequences** | `MapSequence` with playback controls | No | No | No | No | No | Manual |
| **Remotion integration** | `MapSlide` for video pipeline | No | No | No | No | No | N/A |
| **Static image API** | `generateMapImage()` for video frames | No | No | No | No | No | Manual API call |
| **CSS Modules** | All components use CSS Modules | Inline styles | CSS classes | Inline styles | CSS classes | N/A | N/A |
| **Content-synced media** | Designed for podcast/video sync | No | No | No | No | No | No |
| **Caching** | In-memory LRU (500 entries, 24h TTL) | N/A | N/A | N/A | N/A | N/A | N/A |
| **Bundle impact** | Tree-shakeable — workers import types only | Full GL bundle | ~40KB | ~300KB | Full GL bundle | Separate package | Full GL bundle |

### Why not use existing libraries directly?

| Library | What it does well | What's missing for Sotto |
|---|---|---|
| **react-map-gl** | Thin React wrapper over Mapbox GL | No presets, no historical overlays, no animation system, no place resolution. We'd still need to build everything on top. |
| **Leaflet** | Lightweight 2D maps, huge plugin ecosystem | No 3D terrain, no WebGL rendering, poor performance for cinematic animations. Plugin ecosystem is fragmented. |
| **deck.gl** | Large-scale data visualization on maps | Overkill for our use case (we're rendering places, not millions of data points). No historical features. |
| **MapLibre GL** | Open-source Mapbox GL fork | Same API as Mapbox GL but without premium styles. Still need all the same wrapper code. |
| **Allmaps** | IIIF historical map warping | Standalone viewer only. No React components, no presets, no integration with modern map UIs. We integrate it as one overlay source. |
| **OpenHistoricalMap** | Community-curated historical geodata | Tile server only. No components, no year filtering UI, no integration layer. We consume their tiles. |

**The gap**: Each library solves one piece. None provides a unified API for "show me Constantinople in 1453 with a vintage style, historical overlay, and cinematic fly-in" — which is what our podcast video pipeline needs.

## Features

### Place Resolution
```typescript
const resolver = new PlaceResolver();
const place = await resolver.resolve('Constantinople');
// → { name: 'Constantinople', coordinates: [28.97, 41.01], source: 'whg', ... }

const historical = await resolver.resolveHistorical('Byzantium', 330, 1453);
// Biases toward WHG + Pleiades, boosts confidence for period matches
```

### Map Presets
| Preset | Style | 3D | Description |
|--------|-------|-----|-------------|
| `vintage` | Sepia antique | No | Paper grain texture overlay |
| `satellite` | Satellite Streets | No | Modern satellite imagery |
| `parchment` | Light + sepia filter | No | Old-world parchment feel |
| `cinematic` | Satellite + terrain | Yes | Johnny Harris style — dramatic 3D |
| `dark` | Dark v11 | No | Dark mode |
| `terrain` | Outdoors + terrain | Yes | Topographic with hillshading |

### Components
```tsx
// Basic map with preset
<MapView center={[28.97, 41.01]} zoom={12} preset="cinematic" mapboxToken={token} />

// Historical comparison
<DualEraView place={place} mode="slider" mapboxToken={token} />

// Animated cinematic sequence
const sequence = SequenceBuilder.cinematic([rome, constantinople, jerusalem], 5000);
<MapSequence sequence={sequence} preset="cinematic" autoPlay mapboxToken={token} />
```

## Architecture

```
@sotto/maps
├── types.ts                  # PlaceMetadata, MapPreset, CameraKeyframe, etc.
├── resolver/                 # Place name → coordinates
│   ├── place-resolver.ts     # Multi-gazetteer with cache
│   ├── cache.ts              # In-memory LRU (500 entries, 24h TTL)
│   └── gazetteers/           # WHG, GeoNames, Pleiades clients
├── presets/                   # 6 map style presets
├── components/               # React components (CSS Modules)
│   ├── MapView               # Base Mapbox GL wrapper
│   ├── HistoricalMap          # Place + year + overlays
│   ├── DualEraView            # Before/after (3 modes)
│   ├── TimeSlider             # Year slider with events
│   └── MapSequence            # Animated camera sequences
├── overlays/                  # Historical map layers
│   ├── allmaps-overlay.ts      # IIIF warping via @allmaps/maplibre
│   └── ohm-overlay.ts         # OpenHistoricalMap tiles
├── animations/                # Camera animation primitives
│   ├── fly-to.ts              # flyTo with bearing calculation
│   ├── camera-path.ts         # Multi-keyframe interpolation
│   ├── sequence-builder.ts    # High-level sequence API
│   └── ...                    # overlay-fade, mask-reveal
└── remotion/                  # Video pipeline compositions
    └── MapSlide.tsx           # Static map + Ken Burns + annotations
```

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `GEONAMES_USERNAME` | GeoNames API access (free tier) |
| `MAPBOX_ACCESS_TOKEN` | Server-side Mapbox (static images for video pipeline) |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Client-side Mapbox (playground app) |

All managed via Doppler (dev + prd configs).

## Development

```bash
# Type-check
cd packages/maps && npx tsc --noEmit

# Run tests
cd packages/maps && npx vitest run

# Watch mode
cd packages/maps && npx vitest
```

## Playground

The `maps.sotto.fm` playground (`apps/maps/`) provides an interactive demo:

```bash
npm run dev --workspace=@sotto/maps-app  # localhost:3001
```

- **Homepage**: Search places with year-aware parsing
- **Gallery**: Same location rendered in all 6 presets
- **Events**: Curated historical events with map sequences
- **Docs**: Developer reference + code snippets
