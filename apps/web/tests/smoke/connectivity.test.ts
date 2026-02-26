/**
 * Smoke tests — validate real external service connectivity.
 *
 * Run with: npm run test:smoke (via doppler run for secrets)
 * Each provider skips gracefully when env vars are missing.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// PostgreSQL
// ---------------------------------------------------------------------------
describe('PostgreSQL', () => {
  it.skipIf(!process.env.DATABASE_URL)('connects and runs a query', async () => {
    const { prisma } = await import('@/lib/prisma');
    const result = await prisma.$queryRaw`SELECT 1 AS ok`;
    expect(result).toEqual([{ ok: 1 }]);
  });
});

// ---------------------------------------------------------------------------
// Redis
// ---------------------------------------------------------------------------
describe('Redis', () => {
  it.skipIf(!process.env.REDIS_URL)('connects and pings', async () => {
    const { getRedisClient } = await import('@/lib/redis');
    const client = getRedisClient();
    const pong = await client.ping();
    expect(pong).toBe('PONG');
  });
});

// ---------------------------------------------------------------------------
// R2 Storage (S3-compatible)
// ---------------------------------------------------------------------------
describe('R2 Storage', () => {
  const hasR2 = !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY
  );

  it.skipIf(!hasR2)('can reach the bucket', async () => {
    const { S3Client, HeadBucketCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
    const bucket = process.env.R2_BUCKET_NAME || 'sotto-storage';
    await expect(client.send(new HeadBucketCommand({ Bucket: bucket }))).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// AI Providers (via ai-registry validate)
// ---------------------------------------------------------------------------
describe('AI Providers', () => {
  describe('Anthropic', () => {
    it.skipIf(!process.env.ANTHROPIC_API_KEY)('validates credentials', async () => {
      const { validateAiProviderCredentials } = await import('@/lib/providers/ai-registry');
      const valid = await validateAiProviderCredentials('anthropic', {
        apiKey: process.env.ANTHROPIC_API_KEY!,
      });
      expect(valid).toBe(true);
    });
  });

  describe('OpenAI', () => {
    it.skipIf(!process.env.OPENAI_API_KEY)('validates credentials', async () => {
      const { validateAiProviderCredentials } = await import('@/lib/providers/ai-registry');
      const valid = await validateAiProviderCredentials('openai', {
        apiKey: process.env.OPENAI_API_KEY!,
      });
      expect(valid).toBe(true);
    });
  });

  describe('Groq', () => {
    it.skipIf(!process.env.GROQ_API_KEY)('validates credentials', async () => {
      const { validateAiProviderCredentials } = await import('@/lib/providers/ai-registry');
      const valid = await validateAiProviderCredentials('groq', {
        apiKey: process.env.GROQ_API_KEY!,
      });
      expect(valid).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// TTS Providers (via tts-registry validate)
// ---------------------------------------------------------------------------
describe('TTS Providers', () => {
  describe('ElevenLabs', () => {
    it.skipIf(!process.env.ELEVENLABS_API_KEY)('validates credentials', async () => {
      const { validateProviderCredentials } = await import('@/lib/providers/tts-registry');
      const valid = await validateProviderCredentials('elevenlabs', {
        apiKey: process.env.ELEVENLABS_API_KEY!,
      });
      expect(valid).toBe(true);
    });
  });

  describe('OpenAI TTS', () => {
    it.skipIf(!process.env.OPENAI_API_KEY)('validates credentials', async () => {
      const { validateProviderCredentials } = await import('@/lib/providers/tts-registry');
      const valid = await validateProviderCredentials('openai', {
        apiKey: process.env.OPENAI_API_KEY!,
      });
      expect(valid).toBe(true);
    });
  });

  describe('Cartesia', () => {
    // BYOK-only — smoke test env vars
    it.skipIf(!process.env.CARTESIA_API_KEY)('validates credentials', async () => {
      const { validateProviderCredentials } = await import('@/lib/providers/tts-registry');
      const valid = await validateProviderCredentials('cartesia', {
        apiKey: process.env.CARTESIA_API_KEY!,
      });
      expect(valid).toBe(true);
    });
  });

  describe('Hume', () => {
    // BYOK-only — smoke test env vars
    it.skipIf(!process.env.HUME_API_KEY)('validates credentials', async () => {
      const { validateProviderCredentials } = await import('@/lib/providers/tts-registry');
      const valid = await validateProviderCredentials('hume', {
        apiKey: process.env.HUME_API_KEY!,
      });
      expect(valid).toBe(true);
    });
  });
});
