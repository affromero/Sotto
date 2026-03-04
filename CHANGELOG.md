# Changelog

## [0.1.42] - 2026-03-04

### Changed
- Replace hardcoded LLM pricing tables with `pricetoken` package — 36 models from static data + live API updates
- Replace HTML-scraping + LLM-extraction pricing pipeline with PriceTokenClient API call
- Separate "servable models" (9 registry) from "pricing-known models" (36 pricetoken) for type safety

### Fixed
- Discovery worker handling reasoning models that return 0 visible bytes
- OG image params not awaited, causing undefined podcastId
