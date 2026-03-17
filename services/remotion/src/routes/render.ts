import { Router } from 'express';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import os from 'os';
import type { RenderInput, RenderStatusValue } from '@sotto/video';
import { DEFAULT_RENDER_CONFIG, DEFAULT_BRANDING, RenderStatus } from '@sotto/video';

export const renderRouter = Router();

/** Supported composition IDs — both use the same Remotion bundle. */
type CompositionId = 'PodcastVideo' | 'LaunchVideo';

interface RenderJob {
  status: RenderStatusValue;
  progress: number;
  outputPath?: string;
  error?: string;
}

const jobs = new Map<string, RenderJob>();

/** Use half of available CPUs for per-render frame concurrency (min 1, max 4). */
const RENDER_CONCURRENCY = Math.min(4, Math.max(1, Math.floor(os.cpus().length / 2)));

// Cache the bundled Remotion project
let bundlePromise: Promise<string> | null = null;

export function getBundlePath(): Promise<string> {
  if (!bundlePromise) {
    const entryPoint = path.resolve(process.cwd(), 'packages/video/src/Root.tsx');
    bundlePromise = bundle({
      entryPoint,
      onProgress: (progress: number) => {
        if (progress === 100) {
          console.log('Remotion bundle ready');
        }
      },
    });
  }
  return bundlePromise!;
}

async function executeRender(jobId: string, compositionId: CompositionId, input: Record<string, unknown>): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  job.status = RenderStatus.RENDERING;

  const outputPath = path.join(os.tmpdir(), `sotto-video-${jobId}.mp4`);

  try {
    const serveUrl = await getBundlePath();
    const config = (input.config as typeof DEFAULT_RENDER_CONFIG) ?? DEFAULT_RENDER_CONFIG;

    const composition = await selectComposition({
      serveUrl,
      id: compositionId,
      inputProps: input,
    });

    await renderMedia({
      composition,
      serveUrl,
      codec: config.codec,
      crf: config.crf,
      audioBitrate: `${config.audioBitrate}` as `${number}k`,
      outputLocation: outputPath,
      inputProps: input,
      concurrency: RENDER_CONCURRENCY,
      enableMultiProcessOnLinux: true,
      onProgress: ({ progress }: { progress: number }) => {
        job.progress = Math.round(progress * 100);
      },
    });

    job.status = RenderStatus.DONE;
    job.progress = 100;
    job.outputPath = outputPath;
  } catch (err) {
    job.status = RenderStatus.ERROR;
    job.error = err instanceof Error ? err.message : 'Render failed';
    console.error(`Render ${jobId} failed:`, err);
  }
}

/** Pre-warm the bundle cache */
export function preWarmBundle(): void {
  getBundlePath().catch((err) => {
    console.error('Failed to pre-warm bundle:', err);
  });
}

// POST /render — start a new render
renderRouter.post('/', (req, res) => {
  const { compositionId: rawCompositionId, ...body } = req.body;
  const compositionId: CompositionId = rawCompositionId === 'LaunchVideo' ? 'LaunchVideo' : 'PodcastVideo';

  // Validate based on composition type
  if (compositionId === 'PodcastVideo') {
    const podcastBody = body as Partial<RenderInput>;
    if (!podcastBody.audioUrl || !podcastBody.segments?.length) {
      res.status(400).json({ error: 'audioUrl and segments are required for PodcastVideo' });
      return;
    }
  } else if (compositionId === 'LaunchVideo') {
    if (!body.scenes?.length) {
      res.status(400).json({ error: 'scenes are required for LaunchVideo' });
      return;
    }
  }

  // Build input — for PodcastVideo, apply defaults; for LaunchVideo, pass through
  let input: Record<string, unknown>;
  if (compositionId === 'PodcastVideo') {
    const podcastBody = body as Partial<RenderInput>;
    input = {
      audioUrl: podcastBody.audioUrl,
      segments: podcastBody.segments,
      config: podcastBody.config ?? DEFAULT_RENDER_CONFIG,
      branding: podcastBody.branding ?? DEFAULT_BRANDING,
      transitions: podcastBody.transitions,
      avatarOverlays: podcastBody.avatarOverlays,
    };
  } else {
    input = {
      ...body,
      config: body.config ?? DEFAULT_RENDER_CONFIG,
    };
  }

  const jobId = uuidv4();
  jobs.set(jobId, { status: RenderStatus.QUEUED, progress: 0 });

  // Fire and forget — render runs in background
  executeRender(jobId, compositionId, input);

  res.status(202).json({ jobId });
});

// GET /render/:jobId/status — check render progress
renderRouter.get('/:jobId/status', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  res.json({
    status: job.status,
    progress: job.progress,
    ...(job.error && { error: job.error }),
  });
});

// GET /render/:jobId/output — stream rendered MP4
renderRouter.get('/:jobId/output', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  if (job.status !== RenderStatus.DONE || !job.outputPath) {
    res.status(409).json({ error: 'Render not complete', status: job.status });
    return;
  }

  const outputPath = job.outputPath;

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="sotto-${req.params.jobId}.mp4"`);

  const stream = fs.createReadStream(outputPath);
  stream.pipe(res);
  stream.on('end', () => {
    fs.unlink(outputPath, () => {});
    jobs.delete(req.params.jobId);
  });
  stream.on('error', () => {
    res.status(500).json({ error: 'Failed to read output file' });
  });
});
