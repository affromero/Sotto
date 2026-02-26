/* eslint-disable no-console */
/**
 * Composite narrated video — places voiceover segments at exact timestamps
 * over the graded screen recording using FFmpeg.
 *
 * Strategy:
 *   1. Take the graded MP4 (has silent audio track)
 *   2. Resolve segment overlaps → compute required audio duration
 *   3. If audio exceeds video, SLOW the video (setpts) to match
 *   4. Place each audio segment at its resolved timestamp
 *   5. Mix all segments together, composite with (possibly slowed) video
 *   6. Output final narrated MP4
 *
 * The voice is the source of truth — video stretches to fit, never the
 * other way around. No audio is chopped or sped up.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { VoiceoverResult } from './generate-voiceover';

function runFFmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, { maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`ffmpeg failed: ${err.message}\n${stderr}`));
      else resolve(stdout + stderr);
    });
  });
}

interface CompositeOptions {
  /** Path to the graded MP4 video (silent) */
  videoPath: string;
  /** Voiceover segments with audio files and timestamps */
  voiceover: VoiceoverResult;
  /** Output directory for narrated MP4 */
  outputDir: string;
}

interface CompositeResult {
  flowName: string;
  outputPath: string;
  sizeBytes: number;
  slowFactor: number;
}

/** Minimum silence (ms) between consecutive segments. */
const GAP_MS = 300;

/** Padding (s) after the last segment ends before the video should end. */
const TAIL_PADDING = 0.5;

interface ResolvedSegment {
  index: number;
  originalStartAt: number;
  resolvedStartAt: number;
  durationSec: number;
  audioPath: string;
}

/**
 * Resolve overlaps by placing segments sequentially when they'd collide.
 * Does NOT clip to video duration — we'll stretch the video to fit instead.
 */
function resolveOverlaps(
  segments: VoiceoverResult['segments']
): ResolvedSegment[] {
  const resolved: ResolvedSegment[] = [];
  let cursor = 0; // earliest time (ms) the next segment can start

  for (const seg of segments) {
    const scriptedMs = seg.startAt * 1000;
    const actualStart = Math.max(scriptedMs, cursor);

    resolved.push({
      index: seg.index,
      originalStartAt: seg.startAt,
      resolvedStartAt: actualStart / 1000,
      durationSec: seg.durationSec,
      audioPath: seg.audioPath,
    });

    cursor = actualStart + seg.durationSec * 1000 + GAP_MS;
  }

  return resolved;
}

export async function compositeNarratedVideo(
  options: CompositeOptions
): Promise<CompositeResult> {
  const { videoPath, voiceover, outputDir } = options;
  fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, `${voiceover.flowName}-narrated.mp4`);
  const segments = voiceover.segments;

  if (segments.length === 0) {
    throw new Error(`No voiceover segments for ${voiceover.flowName}`);
  }

  const videoDur = await getMediaDuration(videoPath);

  // Resolve overlaps (all segments kept — no clipping)
  const resolved = resolveOverlaps(segments);

  // Required duration = last segment end + tail padding
  const lastSeg = resolved[resolved.length - 1];
  const requiredDuration = lastSeg.resolvedStartAt + lastSeg.durationSec + TAIL_PADDING;

  // Compute slow factor: >1 means video plays slower to fit narration
  const slowFactor = requiredDuration > videoDur
    ? requiredDuration / videoDur
    : 1.0;

  const effectiveVideoDur = videoDur * slowFactor;

  console.log(`    Video: ${videoDur.toFixed(1)}s → ${effectiveVideoDur.toFixed(1)}s (${slowFactor > 1 ? `${slowFactor.toFixed(2)}x slower` : 'no change'})`);
  console.log(`    Timing:`);
  for (const seg of resolved) {
    const shifted = Math.abs(seg.resolvedStartAt - seg.originalStartAt) > 0.05;
    const marker = shifted ? ` (shifted from ${seg.originalStartAt.toFixed(1)}s)` : '';
    console.log(`      seg${seg.index}: ${seg.resolvedStartAt.toFixed(1)}s → ${(seg.resolvedStartAt + seg.durationSec).toFixed(1)}s${marker}`);
  }

  // ── Build FFmpeg command ──────────────────────────────────────

  const inputs: string[] = ['-i', videoPath];
  for (const seg of resolved) {
    inputs.push('-i', seg.audioPath);
  }

  const filterParts: string[] = [];
  const delayedLabels: string[] = [];

  // Audio: delay each segment and pad to effective video duration
  for (let i = 0; i < resolved.length; i++) {
    const seg = resolved[i];
    const delayMs = Math.round(seg.resolvedStartAt * 1000);
    const label = `delayed${i}`;
    filterParts.push(
      `[${i + 1}:a]adelay=${delayMs}|${delayMs},apad=whole_dur=${effectiveVideoDur.toFixed(3)}[${label}]`
    );
    delayedLabels.push(`[${label}]`);
  }

  // Mix all narration segments
  filterParts.push(
    `${delayedLabels.join('')}amix=inputs=${resolved.length}:duration=first:normalize=0[narration]`
  );

  if (slowFactor > 1) {
    // Video needs slowdown — add setpts filter and re-encode
    filterParts.push(`[0:v]setpts=PTS*${slowFactor.toFixed(6)}[slowvid]`);

    const filterComplex = filterParts.join(';');
    await runFFmpeg([
      ...inputs,
      '-filter_complex', filterComplex,
      '-map', '[slowvid]',
      '-map', '[narration]',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
      '-movflags', '+faststart',
      '-y', outputPath,
    ]);
  } else {
    // No slowdown needed — use audio filter only, copy video stream
    const filterComplex = filterParts.join(';');
    await runFFmpeg([
      ...inputs,
      '-filter_complex', filterComplex,
      '-map', '0:v',
      '-map', '[narration]',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
      '-movflags', '+faststart',
      '-y', outputPath,
    ]);
  }

  const stat = fs.statSync(outputPath);
  return {
    flowName: voiceover.flowName,
    outputPath,
    sizeBytes: stat.size,
    slowFactor,
  };
}

async function getMediaDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath],
      (err, stdout) => {
        if (err) reject(err);
        else resolve(parseFloat(stdout.trim()));
      }
    );
  });
}
