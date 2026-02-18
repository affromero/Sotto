import { logger } from './logger';
import { logUsage } from './usage-logger';

const EMBEDDING_DIM = 384;

/**
 * Abstraction layer for embedding generation.
 * Single swap point for embedding strategy.
 * Currently stubs with a simple hash-based embedding for development.
 * Swap to text-embedding-3-small (384-dim) or other model when ready.
 */

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  dimension: number;
}

/**
 * Stub embedding provider for development.
 * Generates deterministic pseudo-embeddings from text content.
 * Replace with real embedding model when ready.
 */
class StubEmbeddingProvider implements EmbeddingProvider {
  readonly dimension = EMBEDDING_DIM;

  async embed(text: string): Promise<number[]> {
    return this.hashEmbed(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.hashEmbed(t));
  }

  private hashEmbed(text: string): number[] {
    const embedding = new Array(EMBEDDING_DIM).fill(0);
    const normalized = text.toLowerCase().trim();

    for (let i = 0; i < normalized.length; i++) {
      const idx = (normalized.charCodeAt(i) * (i + 1)) % EMBEDDING_DIM;
      embedding[idx] += 1;
    }

    // L2 normalize
    const norm = Math.sqrt(embedding.reduce((sum: number, v: number) => sum + v * v, 0)) || 1;
    return embedding.map((v: number) => v / norm);
  }
}

/**
 * OpenAI embedding provider.
 * Uses text-embedding-3-small with 384 dimensions.
 */
class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dimension = EMBEDDING_DIM;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: texts,
        dimensions: EMBEDDING_DIM,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI embedding API error: ${error}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
      usage?: { total_tokens: number };
    };

    if (data.usage) {
      logUsage({
        service: 'openai',
        model: 'text-embedding-3-small',
        category: 'embedding',
        inputTokens: data.usage.total_tokens,
        totalCost: (data.usage.total_tokens / 1_000_000) * 0.02,
      });
    }

    return data.data.map((d) => d.embedding);
  }
}

let _provider: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (!_provider) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      _provider = new OpenAIEmbeddingProvider(openaiKey);
      logger.info('Using OpenAI embedding provider (text-embedding-3-small, 384d)');
    } else {
      _provider = new StubEmbeddingProvider();
      logger.warn('Using stub embedding provider — set OPENAI_API_KEY for real embeddings');
    }
  }
  return _provider;
}

export { EMBEDDING_DIM };
