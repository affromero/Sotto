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

| Feature | **@sotto/maps** | [react-map-gl](https://visgl.github.io/react-map-gl/) | [Leaflet](https://leafletjs.com/) | [deck.gl](https://deck.gl/) | [MapLibre GL](https://maplibre.org/) | [Allmaps](https://allmaps.org/) | [Mapbox GL JS](https://docs.mapbox.com/mapbox-gl-js/) |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| React components | **Yes** | **Yes** | **Yes** | **Yes** | No | No | No |
| Map presets (vintage, cinematic, etc.) | **Yes** (6) | No | No | No | No | No | No |
| 3D terrain (one-line) | **Yes** | No | No | **Yes** | No | No | No |
| Historical map overlays (IIIF) | **Yes** | No | No | No | No | **Yes** | No |
| OpenHistoricalMap tiles | **Yes** | No | No | No | No | No | No |
| Before/after comparison (3 modes) | **Yes** | No | No | No | No | No | No |
| Time slider with event markers | **Yes** | No | No | No | No | No | No |
| Place resolution (name → coords) | **Yes** | No | No | No | No | No | No |
| Historical place bias | **Yes** | No | No | No | No | No | No |
| Camera animation sequences | **Yes** | No | No | **Yes** | No | No | No |
| Remotion video integration | **Yes** | No | No | No | No | No | No |
| Static image API for video frames | **Yes** | No | No | No | No | No | No |
| CSS Modules | **Yes** | No | No | No | No | No | No |
| Content-synced media design | **Yes** | No | No | No | No | No | No |
| Built-in caching (LRU + TTL) | **Yes** | No | No | No | No | No | No |
| Tree-shakeable (types-only import) | **Yes** | No | **Yes** | No | No | **Yes** | No |

### Closest alternative: react-map-gl + manual integration

[react-map-gl](https://visgl.github.io/react-map-gl/) is the most popular React wrapper for Mapbox GL and the closest starting point. To match what `@sotto/maps` provides, you'd need to:

1. **Build a preset system** — create and maintain 6 map style configurations with texture overlays and 3D terrain toggles
2. **Integrate Allmaps** — wire up `@allmaps/maplibre` for IIIF historical map warping, handle lifecycle and layer management
3. **Add OpenHistoricalMap** — configure vector tile sources with year-based filtering
4. **Build DualEraView** — implement 3 comparison modes (side-by-side with synced cameras, CSS clip-path slider, opacity fade) from scratch
5. **Build a place resolver** — integrate 3 gazetteer APIs (WHG, GeoNames, Pleiades) with caching, confidence scoring, and historical bias
6. **Build an animation system** — keyframe interpolation, bearing calculation, easing functions, sequence playback with progress tracking
7. **Build Remotion compositions** — Ken Burns effect on static map images with annotation overlays for the video pipeline

Each piece exists in isolation across different libraries. `@sotto/maps` combines them into a single API where `<HistoricalMap place={constantinople} year={1453} preset="vintage" />` just works.

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
| `cinematic` | Satellite + terrain | **Yes** | Johnny Harris style — dramatic 3D |
| `dark` | Dark v11 | No | Dark mode |
| `terrain` | Outdoors + terrain | **Yes** | Topographic with hillshading |

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
