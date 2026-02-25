# @sottofm/verification-standard

**Open Reference Verification Standard** — domain-aware scoring for academic, news, government, and general sources.

Used by [Sotto](https://sotto.fm) to verify podcast citations. Community-improvable via PRs.

## The Problem

A single fixed scoring formula (e.g., `doi × 0.4 + title_search × 0.3`) makes it mathematically impossible for news articles to pass: DOI and academic indexing are irrelevant for news. A live NYT article would score ≤ 0.23 and always be removed.

## The Fix: Domain-Aware Scoring

Each domain has its own applicable verification layers, weights, and threshold:

| Domain     | Layers (weight)                                      | Threshold |
|------------|------------------------------------------------------|-----------|
| ACADEMIC   | doi(0.45) + title_search(0.30) + url(0.10) + ai(0.15) | 0.70    |
| NEWS       | url(0.35) + ai(0.65)                                 | 0.50      |
| GOVERNMENT | url(0.40) + ai(0.60)                                 | 0.55      |
| GENERAL    | url(0.30) + title_search(0.10) + ai(0.60)            | 0.55      |

**Example**: NYT article (URL 200 + AI credible):
- url = 0.35 × 0.6 = 0.21
- ai = 0.65 × 0.85 = 0.5525
- score = 0.76 → **VERIFIED** (was 0.23 → REMOVED)

**Paywall case**: NYT article (403 + AI credible):
- url = 0
- ai = 0.65 × 0.85 = 0.5525
- score = 0.55 → **VERIFIED** (threshold 0.50)

## Usage

```ts
import { classifyReference, computeDomainAwareScore, DOMAIN_CONFIGS } from '@sottofm/verification-standard';

const domain = classifyReference({ doi: null, url: 'https://nytimes.com/...', type: 'ARTICLE' });
// → 'NEWS'

const { score, verdict } = computeDomainAwareScore('NEWS', [
  { layerId: 'url', passed: true, confidence: 0.6 },
  { layerId: 'ai', passed: true, confidence: 0.85 },
]);
// → { score: 0.76, verdict: 'VERIFIED' }
```

## Contributing

PRs welcome. This standard is intentionally open — the community can improve domain detection, add new domains, or adjust weights via pull requests.

## License

MIT
