import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { z } from 'zod';
import { errorResponse } from '@/lib/api-response';
import { classifySegmentVisuals } from '@/lib/visual-classifier';
import type { SegmentInput } from '@/lib/visual-classifier';
import { PlaceResolver } from '@sotto/maps/server';
import type { MapPresetId } from '@sotto/maps/server';
import { generateMapImage } from '@/lib/map-image';
import { FalImageProvider } from '@/lib/providers/image/fal.provider';
import { getImageProviderMeta } from '@/lib/providers/image-registry';
import { searchStockVideo } from '@/lib/stock-footage';

const classifySchema = z.object({
  type: z.literal('classify'),
  title: z.string().min(1),
  topic: z.string().min(1),
  segments: z.array(z.string().min(1)).min(1),
  provider: z.string().optional(),
  model: z.string().optional(),
});

const resolvePlaceSchema = z.object({
  type: z.literal('resolve-place'),
  query: z.string().min(1),
  yearHint: z.number().int().optional(),
});

const mapImageSchema = z.object({
  type: z.literal('map-image'),
  place: z.string().min(1),
  preset: z.enum(['vintage', 'satellite', 'parchment', 'cinematic', 'dark', 'terrain']),
  width: z.number().int().min(100).max(2560).optional(),
  height: z.number().int().min(100).max(2560).optional(),
});

const aiIllustrationSchema = z.object({
  type: z.literal('ai-illustration'),
  prompt: z.string().min(1),
  model: z.string().optional(),
});

const stockFootageSchema = z.object({
  type: z.literal('stock-footage'),
  query: z.string().min(1),
});

const requestSchema = z.discriminatedUnion('type', [
  classifySchema,
  resolvePlaceSchema,
  mapImageSchema,
  aiIllustrationSchema,
  stockFootageSchema,
]);

function classifyError(error: Error): string {
  const msg = error.message;
  const lower = msg.toLowerCase();

  if (msg === 'timeout' || lower.includes('timed out') || error.name === 'AbortError') {
    return 'Timed out';
  }
  if (
    lower.includes('not configured') ||
    lower.includes('api key not') ||
    lower.includes('no api key') ||
    lower.includes('is not set')
  ) {
    return 'API key not configured';
  }
  if (
    lower.includes('401') ||
    lower.includes('unauthorized') ||
    lower.includes('authentication failed') ||
    lower.includes('invalid api key') ||
    lower.includes('403') ||
    lower.includes('forbidden')
  ) {
    return 'Authentication failed — check API key';
  }
  if (lower.includes('429') || lower.includes('rate limit')) {
    return 'Rate limited by provider';
  }
  if (
    lower.includes('econnrefused') ||
    lower.includes('fetch failed') ||
    lower.includes('enotfound')
  ) {
    return `Network error: ${msg}`;
  }
  return msg;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms)
    ),
  ]);
}

export async function POST(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json();
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const data = parsed.data;
  const start = Date.now();

  try {
    if (data.type === 'classify') {
      const segmentInputs: SegmentInput[] = data.segments.map((text, i) => ({
        segmentId: crypto.randomUUID(),
        order: i,
        speaker: 'host',
        text,
        duration: Math.max(5, (text.split(/\s+/).length / 150) * 60),
      }));

      const result = await withTimeout(
        classifySegmentVisuals(segmentInputs, data.title, data.topic, {
          provider: data.provider,
          model: data.model,
        }),
        60_000
      );

      return NextResponse.json({
        success: true,
        latencyMs: Date.now() - start,
        result: result.classifications,
        transitionRecommendations: result.transitionRecommendations,
        model: result.model,
        tokens: { input: result.inputTokens, output: result.outputTokens },
      });
    }

    if (data.type === 'resolve-place') {
      const resolver = new PlaceResolver();
      const result = data.yearHint
        ? await withTimeout(resolver.resolveHistorical(data.query, data.yearHint), 30_000)
        : await withTimeout(resolver.resolve(data.query), 30_000);

      return NextResponse.json({
        success: true,
        latencyMs: Date.now() - start,
        result,
      });
    }

    if (data.type === 'map-image') {
      const resolver = new PlaceResolver();
      const resolved = await withTimeout(resolver.resolve(data.place), 15_000);
      if (!resolved) {
        return NextResponse.json({
          success: false,
          latencyMs: Date.now() - start,
          error: `Could not resolve place: "${data.place}"`,
        });
      }

      const imageBuffer = await withTimeout(
        generateMapImage(resolved, data.preset as MapPresetId, data.width ?? 800, data.height ?? 600),
        30_000
      );

      return NextResponse.json({
        success: true,
        latencyMs: Date.now() - start,
        imageBase64: `data:image/png;base64,${imageBuffer.toString('base64')}`,
        resolvedPlace: resolved,
        preset: data.preset,
      });
    }

    if (data.type === 'ai-illustration') {
      const falKey = process.env.FAL_KEY;
      if (!falKey) {
        return NextResponse.json({
          success: false,
          latencyMs: Date.now() - start,
          error: 'FAL_KEY not configured',
        });
      }

      const defaultModel = getImageProviderMeta('fal').defaultModel;
      const model = data.model || defaultModel;
      const provider = new FalImageProvider(falKey, model);
      const imageBuffer = await withTimeout(
        provider.generateImage({ prompt: data.prompt }),
        30_000
      );

      return NextResponse.json({
        success: true,
        latencyMs: Date.now() - start,
        imageBase64: `data:image/png;base64,${imageBuffer.toString('base64')}`,
        model,
      });
    }

    if (data.type === 'stock-footage') {
      const result = await withTimeout(searchStockVideo(data.query), 30_000);

      return NextResponse.json({
        success: true,
        latencyMs: Date.now() - start,
        result,
      });
    }

    return errorResponse('Invalid type', 400);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return NextResponse.json({
      success: false,
      latencyMs: Date.now() - start,
      error: classifyError(err),
    });
  }
}
