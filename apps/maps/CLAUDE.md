# @sotto/maps-app — maps playground

Playground site for the `@sotto/maps` package. Explore historical places with rich map visuals.

## Structure

```
src/app/
  page.tsx          # Homepage: search + map explorer
  gallery/          # Preset gallery (same location, all styles)
  events/           # Famous historical events
    [slug]/         # Full-screen MapSequence for an event
  api/
    resolve/        # GET /api/v1/resolve?q=Constantinople&year=1453
    health/         # GET /api/v1/health
  docs/             # Developer docs + code snippets
src/components/
  SearchBar         # Place search with year parsing
  PresetPicker      # Map style preset selector
  MapExplorer       # Full-screen interactive map
  EventCard         # Historical event card
  SottoLogo         # Brand logo
```

## Commands

```bash
npm run dev     # Port 3002
npm run ci      # lint + type-check + build
npm run build   # Production build
```

## Env vars

- `NEXT_PUBLIC_MAPBOX_TOKEN` — client-side Mapbox
