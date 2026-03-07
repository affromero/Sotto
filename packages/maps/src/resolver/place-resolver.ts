import type { PlaceMetadata, PlaceResolverOptions, ResolveOptions, GazetteerClient } from '../types';
import { PlaceCache } from './cache';
import { WHGClient, GeoNamesClient, PleiadesClient } from './gazetteers';

export class PlaceResolver {
  private readonly cache: PlaceCache;
  private readonly clients: GazetteerClient[];

  constructor(options: PlaceResolverOptions = {}) {
    this.cache = new PlaceCache(options.cacheTtlSeconds);

    // Default order: WHG (historical) → GeoNames (modern) → Pleiades (ancient)
    this.clients = [new WHGClient(), new GeoNamesClient(), new PleiadesClient()];
  }

  async resolve(query: string, options?: ResolveOptions): Promise<PlaceMetadata | null> {
    const cached = this.cache.get(query, options?.yearHint);
    if (cached) return cached;

    for (const client of this.clients) {
      try {
        const result = await client.search(query, options);
        if (result && result.confidence > 0) {
          this.cache.set(query, result, options?.yearHint);
          return result;
        }
      } catch {
        // Continue to next gazetteer on failure
      }
    }

    return null;
  }

  async resolveBatch(
    queries: Array<{ query: string; options?: ResolveOptions }>,
  ): Promise<Array<PlaceMetadata | null>> {
    return Promise.all(queries.map(({ query, options }) => this.resolve(query, options)));
  }

  async resolveHistorical(
    query: string,
    yearStart: number,
    yearEnd?: number,
  ): Promise<PlaceMetadata | null> {
    const options: ResolveOptions = { yearHint: yearStart };
    const cached = this.cache.get(query, yearStart);
    if (cached) return cached;

    // Bias toward WHG and Pleiades for historical queries
    const historicalClients: GazetteerClient[] = [new WHGClient(), new PleiadesClient(), new GeoNamesClient()];

    for (const client of historicalClients) {
      try {
        const result = await client.search(query, options);
        if (result) {
          // Boost confidence if historical context matches the requested period
          const matchesPeriod = result.historicalContext?.some((ctx) => {
            const ctxStart = ctx.yearStart;
            const ctxEnd = ctx.yearEnd ?? Infinity;
            return yearStart >= ctxStart && yearStart <= ctxEnd;
          });

          if (matchesPeriod) {
            result.confidence = Math.min(result.confidence + 0.1, 1.0);
          }

          this.cache.set(query, result, yearStart);
          return result;
        }
      } catch {
        // Continue to next gazetteer
      }
    }

    // Fall back to standard resolution
    return this.resolve(query, { yearHint: yearEnd ?? yearStart });
  }

  clearCache(): void {
    this.cache.clear();
  }
}
