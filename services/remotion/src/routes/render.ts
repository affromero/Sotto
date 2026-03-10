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

interface RenderJob {
  status: RenderStatusValue;
  progress: number;
  outputPath?: string;
  error?: string;
}

const jobs = new Map<string, RenderJob>();
let currentRender: string | null = null;

// Cache the bundled Remotion project
let bundlePromise: Promise<string> | null = null;

function getBundlePath(): Promise<string> {
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

async function executeRender(jobId: string, input: RenderInput): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  job.status = RenderStatus.RENDERING;
  currentRender = jobId;

  const outputPath = path.join(os.tmpdir(), `sotto-video-${jobId}.mp4`);

  try {
    const serveUrl = await getBundlePath();
    const config = input.config ?? DEFAULT_RENDER_CONFIG;

    const composition = await selectComposition({
      serveUrl,
      id: 'PodcastVideo',
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
  } finally {
    currentRender = null;
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
  if (currentRender) {
    res.status(429).json({
      error: 'A render is already in progress',
      currentJobId: currentRender,
    });
    return;
  }

  const body = req.body as Partial<RenderInput>;
  if (!body.audioUrl || !body.segments?.length) {
    res.status(400).json({ error: 'audioUrl and segments are required' });
    return;
  }

  const input: RenderInput = {
    audioUrl: body.audioUrl,
    segments: body.segments,
    config: body.config ?? DEFAULT_RENDER_CONFIG,
    branding: body.branding ?? DEFAULT_BRANDING,
    transitions: body.transitions,
  };

  const jobId = uuidv4();
  jobs.set(jobId, { status: RenderStatus.QUEUED, progress: 0 });

  // Fire and forget — render runs in background
  executeRender(jobId, input);

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
