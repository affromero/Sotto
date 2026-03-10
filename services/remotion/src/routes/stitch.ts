import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { gradeVideo } from '../lib/grade';

const execFileAsync = promisify(execFile);

export const stitchRouter = Router();

interface StitchScene {
  recordingUrl: string;
  voiceoverUrl?: string;
  visualUrl?: string;
  visualType?: string;
  transitionUrl?: string;
}

interface StitchRequest {
  scenes: StitchScene[];
  output?: { width?: number; height?: number; fps?: number };
  gradeVideo?: boolean;
}

interface StitchJob {
  status: 'downloading' | 'compositing' | 'grading' | 'done' | 'error';
  progress: number;
  outputPath?: string;
  error?: string;
}

const jobs = new Map<string, StitchJob>();

async function downloadFile(url: string, dest: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(dest, buffer);
}

/**
 * Composite a single scene: overlay voiceover onto recording, trim/stretch
 * video to match voiceover duration (voiceover is source of truth).
 */
async function compositeScene(
  tmpDir: string,
  index: number,
  scene: StitchScene,
  width: number,
  height: number,
): Promise<string> {
  const recordingPath = path.join(tmpDir, `scene_${index}_recording.mp4`);
  await downloadFile(scene.recordingUrl, recordingPath);

  if (!scene.voiceoverUrl) {
    return recordingPath;
  }

  const voiceoverPath = path.join(tmpDir, `scene_${index}_voiceover.mp3`);
  await downloadFile(scene.voiceoverUrl, voiceoverPath);

  // Get voiceover duration (source of truth)
  const { stdout: durationStr } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'csv=p=0',
    voiceoverPath,
  ]);
  const voDuration = parseFloat(durationStr.trim());

  const outputPath = path.join(tmpDir, `scene_${index}_composited.mp4`);

  // Stretch/trim recording to match voiceover duration, mix audio
  await execFileAsync('ffmpeg', [
    '-i', recordingPath,
    '-i', voiceoverPath,
    '-filter_complex', [
      `[0:v]scale=${width}:${height},setpts=PTS*${voDuration}/DURATION,fps=30[v]`,
      `[1:a]aformat=sample_rates=44100:channel_layouts=stereo[a]`,
    ].join(';'),
    '-map', '[v]',
    '-map', '[a]',
    '-t', String(voDuration),
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '192k',
    '-y', outputPath,
  ]);

  return outputPath;
}

async function executeStitch(jobId: string, input: StitchRequest): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  const tmpDir = path.join(os.tmpdir(), `sotto-stitch-${jobId}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    job.status = 'downloading';
    const width = input.output?.width ?? 1280;
    const height = input.output?.height ?? 720;

    // Composite each scene (recording + voiceover)
    const compositedPaths: string[] = [];
    for (let i = 0; i < input.scenes.length; i++) {
      const scenePath = await compositeScene(tmpDir, i, input.scenes[i], width, height);
      compositedPaths.push(scenePath);
      job.progress = Math.round(((i + 1) / input.scenes.length) * 50);
    }

    // Download transition clips
    const transitionPaths: (string | null)[] = [];
    for (let i = 0; i < input.scenes.length; i++) {
      const scene = input.scenes[i];
      if (scene.transitionUrl && i < input.scenes.length - 1) {
        const transPath = path.join(tmpDir, `transition_${i}.mp4`);
        await downloadFile(scene.transitionUrl, transPath);
        transitionPaths.push(transPath);
      } else {
        transitionPaths.push(null);
      }
    }

    job.status = 'compositing';
    job.progress = 60;

    // Build concat list: scene0 [transition0] scene1 [transition1] ...
    const concatListPath = path.join(tmpDir, 'concat.txt');
    const concatEntries: string[] = [];
    for (let i = 0; i < compositedPaths.length; i++) {
      concatEntries.push(`file '${compositedPaths[i]}'`);
      if (transitionPaths[i]) {
        concatEntries.push(`file '${transitionPaths[i]}'`);
      }
    }
    fs.writeFileSync(concatListPath, concatEntries.join('\n'));

    const rawOutputPath = path.join(tmpDir, `final_raw.mp4`);
    await execFileAsync('ffmpeg', [
      '-f', 'concat', '-safe', '0',
      '-i', concatListPath,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      '-y', rawOutputPath,
    ]);

    job.progress = 80;

    // Optional warm amber grading
    let finalPath = rawOutputPath;
    if (input.gradeVideo !== false) {
      job.status = 'grading';
      const gradedPath = path.join(tmpDir, `final_graded.mp4`);
      await gradeVideo(rawOutputPath, gradedPath);
      finalPath = gradedPath;
    }

    job.status = 'done';
    job.progress = 100;
    job.outputPath = finalPath;
  } catch (err) {
    job.status = 'error';
    job.error = err instanceof Error ? err.message : 'Stitch failed';
    console.error(`Stitch ${jobId} failed:`, err);
  }
}

// POST /stitch — start a new stitch job
stitchRouter.post('/', (req, res) => {
  const body = req.body as Partial<StitchRequest>;
  if (!body.scenes?.length) {
    res.status(400).json({ error: 'scenes array is required' });
    return;
  }

  // Validate every scene has a recording
  for (let i = 0; i < body.scenes.length; i++) {
    if (!body.scenes[i].recordingUrl) {
      res.status(400).json({ error: `Scene ${i} is missing recordingUrl` });
      return;
    }
  }

  const jobId = uuidv4();
  jobs.set(jobId, { status: 'downloading', progress: 0 });

  executeStitch(jobId, body as StitchRequest);

  res.status(202).json({ jobId });
});

// GET /stitch/:jobId/status
stitchRouter.get('/:jobId/status', (req, res) => {
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

// GET /stitch/:jobId/output — stream stitched MP4
stitchRouter.get('/:jobId/output', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  if (job.status !== 'done' || !job.outputPath) {
    res.status(409).json({ error: 'Stitch not complete', status: job.status });
    return;
  }

  const outputPath = job.outputPath;

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="sotto-demo-${req.params.jobId}.mp4"`);

  const stream = fs.createReadStream(outputPath);
  stream.pipe(res);
  stream.on('end', () => {
    // Clean up the entire temp directory
    const tmpDir = path.dirname(outputPath);
    fs.rm(tmpDir, { recursive: true, force: true }, () => {});
    jobs.delete(req.params.jobId);
  });
  stream.on('error', () => {
    res.status(500).json({ error: 'Failed to read output file' });
  });
});
