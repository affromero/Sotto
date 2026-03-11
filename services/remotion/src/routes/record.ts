import { Router } from 'express';
import { chromium } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { executeActions, type ActionTimingEntry } from '../lib/actions';
import { gradeVideo } from '../lib/grade';

export const recordRouter = Router();

interface RecordRequest {
  actions: Array<{ type: string; [key: string]: unknown }>;
  sessionToken: string;
  appUrl: string;
  viewport?: { width: number; height: number };
  gradeVideo?: boolean;
}

interface RecordJob {
  status: 'recording' | 'grading' | 'done' | 'error';
  progress: number;
  outputPath?: string;
  error?: string;
  actionTimingLog?: ActionTimingEntry[];
}

const jobs = new Map<string, RecordJob>();

async function executeRecording(jobId: string, input: RecordRequest): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  const viewport = input.viewport ?? { width: 1280, height: 720 };
  const videoDir = path.join(os.tmpdir(), `sotto-record-${jobId}`);
  fs.mkdirSync(videoDir, { recursive: true });

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

    // deviceScaleFactor:2 renders at 2× HiDPI — crisp text + UI at no viewport cost
    const physicalSize = { width: viewport.width * 2, height: viewport.height * 2 };
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 2,
      recordVideo: {
        dir: videoDir,
        size: physicalSize,
      },
    });

    // Inject session cookie for auth
    await context.addCookies([{
      name: 'next-auth.session-token',
      value: input.sessionToken,
      domain: new URL(input.appUrl).hostname,
      path: '/',
    }]);

    const page = await context.newPage();
    job.progress = 10;

    // Execute browser actions and capture timing log
    const timingLog = await executeActions(page, input.actions);
    job.actionTimingLog = timingLog;
    job.progress = 70;

    // Close page + context to finalize the video recording
    await page.close();
    await context.close();

    // Find the recorded video file
    const files = fs.readdirSync(videoDir).filter((f) => f.endsWith('.webm'));
    if (files.length === 0) {
      throw new Error('No recording file produced');
    }

    let outputPath = path.join(videoDir, files[0]);

    // Optionally apply warm amber grading
    if (input.gradeVideo !== false) {
      job.status = 'grading';
      job.progress = 80;
      const gradedPath = path.join(videoDir, `graded-${jobId}.mp4`);
      await gradeVideo(outputPath, gradedPath);
      outputPath = gradedPath;
    }

    job.status = 'done';
    job.progress = 100;
    job.outputPath = outputPath;
  } catch (err) {
    job.status = 'error';
    job.error = err instanceof Error ? err.message : 'Recording failed';
    console.error(`Recording ${jobId} failed:`, err);
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
    // Clean up temp directory
    const dir = path.dirname(outputPath);
    fs.rm(dir, { recursive: true }, () => {});
    jobs.delete(req.params.jobId);
  });
  stream.on('error', () => {
    res.status(500).json({ error: 'Failed to read output file' });
  });
});
