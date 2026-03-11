import { Router } from 'express';
import { chromium } from 'playwright';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { executeActions, type ActionTimingEntry } from '../lib/actions';
import { gradeVideo } from '../lib/grade';

const execFileAsync = promisify(execFile);

export const recordRouter = Router();

interface RecordRequest {
  actions: Array<{ type: string; [key: string]: unknown }>;
  sessionToken: string;
  appUrl: string;
  viewport?: { width: number; height: number };
  gradeVideo?: boolean;
}

interface RecordJob {
  status: 'recording' | 'stitching' | 'grading' | 'done' | 'error';
  progress: number;
  outputPath?: string;
  error?: string;
  actionTimingLog?: ActionTimingEntry[];
}

const jobs = new Map<string, RecordJob>();

async function executeRecording(jobId: string, input: RecordRequest): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  const viewport = input.viewport ?? { width: 1920, height: 1080 };
  const videoDir = path.join(os.tmpdir(), `sotto-record-${jobId}`);
  const frameDir = path.join(videoDir, 'frames');
  fs.mkdirSync(frameDir, { recursive: true });

  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--force-device-scale-factor=2',
      ],
    });

    // deviceScaleFactor:2 → Chromium renders at 2× HiDPI (physicalSize pixels)
    const physicalSize = { width: viewport.width * 2, height: viewport.height * 2 };
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 2,
    });

    await context.addCookies([{
      name: 'next-auth.session-token',
      value: input.sessionToken,
      domain: new URL(input.appUrl).hostname,
      path: '/',
    }]);

    const page = await context.newPage();
    job.progress = 10;

    // CDP screencast bypasses Playwright's VP8 recordVideo — captures raw JPEG
    // frames directly from Chromium's screen compositor at physical resolution.
    const cdp = await context.newCDPSession(page);
    let frameCount = 0;

    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 95,
      maxWidth: physicalSize.width,
      maxHeight: physicalSize.height,
      everyNthFrame: 1,
    });

    cdp.on('Page.screencastFrame', (event) => {
      const framePath = path.join(frameDir, `f${String(frameCount++).padStart(6, '0')}.jpg`);
      fs.writeFileSync(framePath, Buffer.from(event.data, 'base64'));
      void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId });
    });

    const timingLog = await executeActions(page, input.actions);
    job.actionTimingLog = timingLog;
    job.progress = 65;

    await cdp.send('Page.stopScreencast');
    await page.close();
    await context.close();

    if (frameCount === 0) {
      throw new Error('No frames captured during recording');
    }

    // Stitch JPEG frames → H264 MP4 (no VP8 intermediate, full quality)
    job.status = 'stitching';
    job.progress = 70;
    const rawVideoPath = path.join(videoDir, `raw-${jobId}.mp4`);
    await execFileAsync('ffmpeg', [
      '-y',
      '-framerate', '24',
      '-pattern_type', 'sequence',
      '-i', path.join(frameDir, 'f%06d.jpg'),
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '12',
      '-pix_fmt', 'yuv420p',
      '-profile:v', 'high',
      '-level:v', '4.2',
      '-movflags', '+faststart',
      rawVideoPath,
    ], { timeout: 300_000 });

    fs.rmSync(frameDir, { recursive: true, force: true });

    let outputPath = rawVideoPath;

    if (input.gradeVideo !== false) {
      job.status = 'grading';
      job.progress = 85;
      const gradedPath = path.join(videoDir, `graded-${jobId}.mp4`);
      await gradeVideo(rawVideoPath, gradedPath);
      fs.rmSync(rawVideoPath, { force: true });
      outputPath = gradedPath;
    }

    job.status = 'done';
    job.progress = 100;
    job.outputPath = outputPath;
  } catch (err) {
    job.status = 'error';
    job.error = err instanceof Error ? err.message : 'Recording failed';
    console.error(`Recording ${jobId} failed:`, err);
    fs.rmSync(frameDir, { recursive: true, force: true });
  } finally {
    await browser?.close();
  }
}

// POST /record — start a browser recording session
recordRouter.post('/', (req, res) => {
  const body = req.body as Partial<RecordRequest>;

  if (!body.actions?.length || !body.sessionToken || !body.appUrl) {
    res.status(400).json({ error: 'actions, sessionToken, and appUrl are required' });
    return;
  }

  const jobId = uuidv4();
  jobs.set(jobId, { status: 'recording', progress: 0 });

  // Fire and forget
  executeRecording(jobId, body as RecordRequest);

  res.status(202).json({ jobId });
});

// GET /record/:jobId/status
recordRouter.get('/:jobId/status', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  res.json({
    status: job.status,
    progress: job.progress,
    ...(job.error && { error: job.error }),
    ...(job.actionTimingLog && { actionTimingLog: job.actionTimingLog }),
  });
});

// GET /record/:jobId/output — stream recorded video
recordRouter.get('/:jobId/output', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  if (job.status !== 'done' || !job.outputPath) {
    res.status(409).json({ error: 'Recording not complete', status: job.status });
    return;
  }

  const outputPath = job.outputPath;

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="sotto-record-${req.params.jobId}.mp4"`);

  const stream = fs.createReadStream(outputPath);
  stream.pipe(res);
  stream.on('end', () => {
    const dir = path.dirname(outputPath);
    fs.rm(dir, { recursive: true }, () => {});
    jobs.delete(req.params.jobId);
  });
  stream.on('error', () => {
    res.status(500).json({ error: 'Failed to read output file' });
  });
});
