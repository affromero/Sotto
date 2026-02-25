import type { ContentDomain, LayerResult } from './types';
import { DOMAIN_CONFIGS } from './domains';

export function computeDomainAwareScore(
  domain: ContentDomain,
  layerResults: LayerResult[]
): { score: number; verdict: 'VERIFIED' | 'FAILED' } {
  const config = DOMAIN_CONFIGS[domain];
  const resultMap = new Map(layerResults.map((r) => [r.layerId, r]));
  let score = 0;
  for (const layer of config.layers) {
    const result = resultMap.get(layer.id);
    if (result) score += layer.weight * result.confidence;
  }
  return { score, verdict: score >= config.threshold ? 'VERIFIED' : 'FAILED' };
}
