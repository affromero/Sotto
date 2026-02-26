/* eslint-disable no-console */
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { GradeOptions, GradeResult, OutputFormat } from './types';

// ── FFmpeg Probe ──────────────────────────────────────────────────

function runFFmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`ffmpeg failed: ${err.message}\n${stderr}`));
      else resolve(stdout + stderr);
    });
  });
}

function runFFprobe(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('ffprobe', args, (err, stdout, stderr) => {
      if (err) reject(new Error(`ffprobe failed: ${err.message}\n${stderr}`));
      else resolve(stdout + stderr);
    });
  });
}

async function getAvailableEncoders(): Promise<Set<string>> {
  const output = await runFFprobe(['-encoders']);
  const encoders = new Set<string>();
  for (const line of output.split('\n')) {
    const match = line.match(/^\s*V[.F][.S][.X][.B][.D]\s+(\S+)/);
    if (match) encoders.add(match[1]);
  }
  return encoders;
}

function getSupportedFormats(encoders: Set<string>): OutputFormat[] {
  const formats: OutputFormat[] = ['mp4']; // libx264 is always available
  if (encoders.has('libx265')) formats.push('hevc');
  if (encoders.has('libvpx-vp9') || encoders.has('libvpx_vp9')) formats.push('webm');
  formats.push('gif'); // native gif encoder
  return formats;
}

// ── Silent Audio ──────────────────────────────────────────────────

async function ensureSilentAudio(assetsDir: string): Promise<string> {
  const silencePath = path.join(assetsDir, 'silence.mp3');
  if (fs.existsSync(silencePath)) return silencePath;

  fs.mkdirSync(assetsDir, { recursive: true });
  await runFFmpeg([
    '-f', 'lavfi',
    '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', '30',
    '-c:a', 'libmp3lame',
    '-b:a', '32k',
    '-y', silencePath,
  ]);
  return silencePath;
}

// ── Warm Amber Filter Chain ───────────────────────────────────────
//
// Matches Sotto's design system:
//   Primary: #D97706 (Golden Amber)
//   Background: #FEFCF8 (Soft Cream)
//
// Chain: curves → colorbalance → eq → vignette → unsharp

const WARM_AMBER_FILTER = [
  // Warm tone shift: lift shadows, push reds warm, pull blues cool
  "curves=master='0/0 0.05/0.08 0.5/0.52 1/1':red='0/0 0.5/0.53 1/1':blue='0/0 0.5/0.46 1/1'",
  // Subtle color balance — amber push
  'colorbalance=rs=0.06:gs=0.02:bs=-0.04:rm=0.04:gm=0.01:bm=-0.03',
  // Slight brightness/contrast/saturation boost
  'eq=brightness=0.03:contrast=1.05:saturation=1.08',
  // Gentle vignette
  'vignette=PI/6:a=1.2',
  // Light sharpening
  'unsharp=3:3:0.3:3:3:0.0',
].join(',');

// ── Grade Pipeline ────────────────────────────────────────────────

async function gradeToMp4(
  input: string,
  output: string,
  silencePath: string
): Promise<void> {
  await runFFmpeg([
    '-i', input,
    '-i', silencePath,
    '-vf', WARM_AMBER_FILTER,
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-shortest',
    '-movflags', '+faststart',
    '-y', output,
  ]);
}

async function gradeToHevc(
  input: string,
  output: string,
  silencePath: string
): Promise<void> {
  await runFFmpeg([
    '-i', input,
    '-i', silencePath,
    '-vf', WARM_AMBER_FILTER,
    '-c:v', 'libx265',
    '-preset', 'slow',
    '-crf', '22',
    '-tag:v', 'hvc1',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-shortest',
    '-movflags', '+faststart',
    '-y', output,
  ]);
}

async function gradeToWebm(input: string, output: string): Promise<void> {
  await runFFmpeg([
    '-i', input,
    '-vf', WARM_AMBER_FILTER,
    '-c:v', 'libvpx-vp9',
    '-crf', '24',
    '-b:v', '0',
    '-an',
    '-y', output,
  ]);
}

async function gradeToGif(input: string, output: string): Promise<void> {
  // Two-pass palette generation for high-quality GIF
  const palettePath = `${output}.palette.png`;
  const scaleAndGrade = `fps=12,scale=480:-1:flags=lanczos,${WARM_AMBER_FILTER}`;

  await runFFmpeg([
    '-i', input,
    '-vf', `${scaleAndGrade},palettegen=max_colors=128`,
    '-y', palettePath,
  ]);

  await runFFmpeg([
    '-i', input,
    '-i', palettePath,
    '-lavfi', `${scaleAndGrade}[x];[x][1:v]paletteuse=dither=floyd_steinberg`,
    '-y', output,
  ]);

  // Clean up palette
  fs.unlinkSync(palettePath);
}

// ── Public API ────────────────────────────────────────────────────

export async function gradeRecording(options: GradeOptions): Promise<GradeResult[]> {
  const { input, outputDir, name, formats } = options;
  fs.mkdirSync(outputDir, { recursive: true });

  // Detect available encoders
  const encoders = await getAvailableEncoders();
  const supported = getSupportedFormats(encoders);

  // Filter to only supported formats
  const toProcess = formats.filter((f) => {
    if (!supported.includes(f)) {
      console.log(`  Skipping ${f} (encoder not available)`);
      return false;
    }
    return true;
  });

  // Ensure silence audio for mp4/hevc
  const assetsDir = path.join(outputDir, '..', 'assets');
  const silencePath = await ensureSilentAudio(assetsDir);

  const results: GradeResult[] = [];

  for (const format of toProcess) {
    const ext = format === 'hevc' ? 'mp4' : format;
    const suffix = format === 'hevc' ? '-hevc' : '';
    const outputPath = path.join(outputDir, `${name}${suffix}.${ext}`);

    console.log(`  Grading ${name} → ${format}...`);

    switch (format) {
      case 'mp4':
        await gradeToMp4(input, outputPath, silencePath);
        break;
      case 'hevc':
        await gradeToHevc(input, outputPath, silencePath);
        break;
      case 'webm':
        await gradeToWebm(input, outputPath);
        break;
      case 'gif':
        await gradeToGif(input, outputPath);
        break;
    }

    const stat = fs.statSync(outputPath);
    results.push({ format, path: outputPath, sizeBytes: stat.size });
    console.log(`  Done: ${outputPath} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
  }

  return results;
}
