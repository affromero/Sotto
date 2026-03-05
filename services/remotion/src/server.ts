import express from 'express';
import { bundle } from '@remotion/renderer';
import { renderMedia } from '@remotion/renderer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import os from 'os';
import type { RenderInput } from '@sotto/video';
import { DEFAULT_RENDER_CONFIG, DEFAULT_BRANDING } from '@sotto/video';

const app = express();
app.use(express.json({ limit: '50mb' }));

const PORT = parseInt(process.env.PORT ?? '3100', 10);

interface RenderJob {
  status: 'queued' | 'rendering' | 'done' | 'error';
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
    const entryPoint = path.resolve(__dirname, '../../packages/video/src/index.ts');
    bundlePromise = bundle({
      entryPoint,
      onProgress: (progress) => {
        if (progress === 100) {
          console.log('Remotion bundle ready');
        }
      },
    });
  }
  return bundlePromise;
}

async function executeRender(jobId: string, input: RenderInput): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  job.status = 'rendering';
  currentRender = jobId;

  const outputPath = path.join(os.tmpdir(), `sotto-video-${jobId}.mp4`);

  try {
    const bundlePath = await getBundlePath();
    const config = input.config ?? DEFAULT_RENDER_CONFIG;

    const totalDuration = input.segments.reduce(
      (max, s) => Math.max(max, s.startTime + s.duration),
      0,
    );
    const durationInFrames = Math.ceil(totalDuration * config.fps);

    await renderMedia({
      composition: {
        id: 'PodcastVideo',
        durationInFrames,
        fps: config.fps,
        width: config.width,
        height: config.height,
        defaultProps: input,
        props: input,
        defaultCodec: 'h264',
      },
      serveUrl: bundlePath,
      codec: config.codec,
      crf: config.crf,
      audioBitrate: config.audioBitrate,
      outputLocation: outputPath,
      onProgress: ({ progress }) => {
        job.progress = Math.round(progress * 100);
      },
    });

    job.status = 'done';
    job.progress = 100;
    job.outputPath = outputPath;
  } catch (err) {
    job.status = 'error';
    job.error = err instanceof Error ? err.message : 'Render failed';
    console.error(`Render ${jobId} failed:`, err);
  } finally {
    currentRender = null;
  }
}

// POST /render — start a new render
app.post('/render', (req, res) => {
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
  };

  const jobId = uuidv4();
  jobs.set(jobId, { status: 'queued', progress: 0 });

  // Fire and forget — render runs in background
  executeRender(jobId, input);

  res.status(202).json({ jobId });
});

// GET /render/:jobId/status — check render progress
app.get('/render/:jobId/status', (req, res) => {
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
app.get('/render/:jobId/output', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  if (job.status !== 'done' || !job.outputPath) {
    res.status(409).json({ error: 'Render not complete', status: job.status });
    return;
  }

  const outputPath = job.outputPath;

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="sotto-${req.params.jobId}.mp4"`);

  const stream = fs.createReadStream(outputPath);
  stream.pipe(res);
  stream.on('end', () => {
    // Clean up temp file and job entry after download
    fs.unlink(outputPath, () => {});
    jobs.delete(req.params.jobId);
  });
  stream.on('error', () => {
    res.status(500).json({ error: 'Failed to read output file' });
  });
});

// GET /health — health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Remotion render server listening on port ${PORT}`);
  // Pre-warm the bundle cache
  getBundlePath().catch((err) => {
    console.error('Failed to pre-warm bundle:', err);
  });
});
