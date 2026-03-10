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

interface TimingSegment {
  start: number;
  end: number;
  speed: number; // 0 = skip
}

interface StitchScene {
  recordingUrl: string;
  voiceoverUrl?: string;
  visualUrl?: string;
  visualType?: string;
  transitionUrl?: string;
  timingSegments?: TimingSegment[];
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

/** Get duration of a media file in seconds. */
async function probeDuration(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'csv=p=0',
    filePath,
  ]);
  return parseFloat(stdout.trim());
}

/**
 * Apply timing segments to a recording: extract time ranges, apply per-segment
 * speed via setpts, then concat the pieces. Returns the timing-adjusted video path.
 */
async function applyTimingSegments(
  tmpDir: string,
  index: number,
  recordingPath: string,
  segments: TimingSegment[],
  width: number,
  height: number,
): Promise<string> {
  const activeSegments = segments.filter((s) => s.speed > 0);
  if (activeSegments.length === 0) {
    throw new Error(`Scene ${index}: all timing segments are skipped`);
  }

  // If single segment at 1x covering the whole recording, just return as-is
  if (activeSegments.length === 1 && activeSegments[0].speed === 1) {
    return recordingPath;
  }

  const segmentPaths: string[] = [];

  for (let si = 0; si < activeSegments.length; si++) {
    const seg = activeSegments[si];
    const segPath = path.join(tmpDir, `scene_${index}_tseg_${si}.mp4`);
    const ptsMultiplier = 1 / seg.speed; // speed 4x → PTS * 0.25

    await execFileAsync('ffmpeg', [
      '-ss', String(seg.start),
      '-to', String(seg.end),
      '-i', recordingPath,
      '-filter:v', `scale=${width}:${height},setpts=${ptsMultiplier}*PTS,fps=30`,
      '-an',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-y', segPath,
    ]);

    segmentPaths.push(segPath);
  }

  // Concat all timing-adjusted segments
  const concatPath = path.join(tmpDir, `scene_${index}_timing_concat.txt`);
  fs.writeFileSync(concatPath, segmentPaths.map((p) => `file '${p}'`).join('\n'));

  const outputPath = path.join(tmpDir, `scene_${index}_timing_adjusted.mp4`);
  await execFileAsync('ffmpeg', [
    '-f', 'concat', '-safe', '0',
    '-i', concatPath,
    '-c', 'copy',
    '-y', outputPath,
  ]);

  return outputPath;
}

/**
 * Composite a single scene: apply timing segments (if any), overlay voiceover,
 * trim/stretch video to match voiceover duration (voiceover is pacing anchor).
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

  // Apply timing segments if present
  let videoPath = recordingPath;
  if (scene.timingSegments && scene.timingSegments.length > 0) {
    videoPath = await applyTimingSegments(tmpDir, index, recordingPath, scene.timingSegments, width, height);
  }

  if (!scene.voiceoverUrl) {
    return videoPath;
  }

  const voiceoverPath = path.join(tmpDir, `scene_${index}_voiceover.mp3`);
  await downloadFile(scene.voiceoverUrl, voiceoverPath);

  const voDuration = await probeDuration(voiceoverPath);
  const adjustedDuration = await probeDuration(videoPath);

  const outputPath = path.join(tmpDir, `scene_${index}_composited.mp4`);

  // If timing-adjusted duration closely matches voiceover, just mux them
  // Otherwise stretch/trim video to match voiceover
  const durationRatio = voDuration / adjustedDuration;
  const needsStretch = Math.abs(durationRatio - 1) > 0.05; // >5% difference

  if (needsStretch) {
    await execFileAsync('ffmpeg', [
      '-i', videoPath,
      '-i', voiceoverPath,
      '-filter_complex', [
        `[0:v]setpts=${durationRatio}*PTS,fps=30[v]`,
        `[1:a]aformat=sample_rates=44100:channel_layouts=stereo[a]`,
      ].join(';'),
      '-map', '[v]',
      '-map', '[a]',
      '-t', String(voDuration),
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '192k',
      '-y', outputPath,
    ]);
  } else {
    // Durations close enough — just mux video + audio
    await execFileAsync('ffmpeg', [
      '-i', videoPath,
      '-i', voiceoverPath,
      '-map', '0:v',
      '-map', '1:a',
      '-t', String(voDuration),
      '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '192k',
      '-y', outputPath,
    ]);
  }

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
