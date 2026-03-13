import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { z } from 'zod';
import { errorResponse } from '@/lib/api-response';
import { classifySegmentVisuals } from '@/lib/visual-classifier';
import type { SegmentInput } from '@/lib/visual-classifier';
import { PlaceResolver } from '@sotto/maps/server';
import type { MapPresetId } from '@sotto/maps/server';
import { generateMapImage, generateMapZoomFrames } from '@/lib/map-image';
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
  zoomFrames: z.boolean().optional(),
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

const renderStillSchema = z.object({
  type: z.literal('render-still'),
  segment: z.object({
    visualType: z.string(),
    text: z.string().min(1),
    prompt: z.string().optional(),
    assetUrl: z.string().optional(),
    assetType: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
    order: z.number().optional(),
    duration: z.number().optional(),
  }),
  frame: z.number().optional(),
});

const renderClipSchema = z.object({
  type: z.literal('render-clip'),
  segment: z.object({
    visualType: z.string(),
    text: z.string().min(1),
    prompt: z.string().optional(),
    assetUrl: z.string().optional(),
    assetType: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
    order: z.number().optional(),
    duration: z.number().optional(),
  }),
  durationSeconds: z.number().min(1).max(10).optional(),
});

const requestSchema = z.discriminatedUnion('type', [
  classifySchema,
  resolvePlaceSchema,
  mapImageSchema,
  aiIllustrationSchema,
  stockFootageSchema,
  renderStillSchema,
  renderClipSchema,
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

      const w = data.width ?? 800;
      const h = data.height ?? 600;

      if (data.zoomFrames) {
        const frames = await withTimeout(
          generateMapZoomFrames(resolved, data.preset as MapPresetId, w, h),
          60_000,
        );
        return NextResponse.json({
          success: true,
          latencyMs: Date.now() - start,
          zoomFrames: frames,
          resolvedPlace: resolved,
          preset: data.preset,
        });
      }

      const imageBuffer = await withTimeout(
        generateMapImage(resolved, data.preset as MapPresetId, w, h),
        30_000,
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

    if (data.type === 'render-still') {
      const remotionUrl = process.env.REMOTION_URL;
      if (!remotionUrl) {
        return NextResponse.json({
          success: false,
          latencyMs: Date.now() - start,
          error: 'REMOTION_URL not configured',
        });
      }

      const duration = data.segment.duration ?? 10;
      const fps = 30;
      const segment = {
        segmentId: crypto.randomUUID(),
        order: data.segment.order ?? 0,
        speaker: 'host',
        text: data.segment.text,
        startTime: 0,
        duration,
        visualType: data.segment.visualType,
        prompt: data.segment.prompt,
        assetUrl: data.segment.assetUrl,
        assetType: data.segment.assetType,
        metadata: data.segment.metadata,
      };

      const durationInFrames = Math.round(duration * fps);
      const res = await withTimeout(
        fetch(`${remotionUrl}/still`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            segment,
            frame: data.frame ?? 0,
            durationInFrames,
          }),
        }),
        30_000,
      );

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: res.statusText }));
        return NextResponse.json({
          success: false,
          latencyMs: Date.now() - start,
          error: (errBody as { error?: string }).error ?? 'Remotion render failed',
        });
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      const imageBase64 = `data:image/png;base64,${buffer.toString('base64')}`;

      return NextResponse.json({
        success: true,
        latencyMs: Date.now() - start,
        imageBase64,
        segment,
      });
    }

    if (data.type === 'render-clip') {
      const remotionUrl = process.env.REMOTION_URL;
      if (!remotionUrl) {
        return NextResponse.json({
          success: false,
          latencyMs: Date.now() - start,
          error: 'REMOTION_URL not configured',
        });
      }

      const durationSeconds = data.durationSeconds ?? 3;
      const segment = {
        segmentId: crypto.randomUUID(),
        order: data.segment.order ?? 0,
        speaker: 'host',
        text: data.segment.text,
        startTime: 0,
        duration: durationSeconds,
        visualType: data.segment.visualType,
        prompt: data.segment.prompt,
        assetUrl: data.segment.assetUrl,
        assetType: data.segment.assetType,
        metadata: data.segment.metadata,
      };

      const res = await withTimeout(
        fetch(`${remotionUrl}/clip`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ segment, durationSeconds }),
        }),
        90_000,
      );

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: res.statusText }));
        return NextResponse.json({
          success: false,
          latencyMs: Date.now() - start,
          error: (errBody as { error?: string }).error ?? 'Remotion clip render failed',
        });
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      const videoBase64 = `data:video/mp4;base64,${buffer.toString('base64')}`;

      return NextResponse.json({
        success: true,
        latencyMs: Date.now() - start,
        videoBase64,
        segment,
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
