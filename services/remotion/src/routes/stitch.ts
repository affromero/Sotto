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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TimingSegment {
  start: number;
  end: number;
  speed: number; // 0 = skip
}

interface ActionTimingEntry {
  type: string;
  timestampMs: number;
  meta?: Record<string, unknown>;
}

interface SceneSfxConfig {
  clickSounds?: boolean;
  typingSounds?: boolean;
  ambientUrl?: string;
  ambientVolume?: number;
  cues?: Array<{ atSeconds: number; sfxUrl: string; volume?: number }>;
}

interface ProviderBannerConfig {
  provider: string;
  showAtSeconds?: number;
  hideAtSeconds?: number | null;
  position?: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
}

interface TextOverlayConfig {
  text: string;
  position: 'center' | 'bottom-center' | 'top-center' | 'bottom-left' | 'bottom-right';
  showAtSeconds: number;
  hideAtSeconds: number;
  fontSize?: number;
  backgroundColor?: string;
  textColor?: string;
}

interface SubtitleConfig {
  enabled: boolean;
  style?: 'default' | 'cinematic';
  position?: 'bottom' | 'top';
  fontSize?: number;
}

interface AvatarConfig {
  videoUrl: string;
  posX?: number;
  posY?: number;
  width?: number;
  height?: number;
  maskShape?: 'none' | 'rounded' | 'circle';
  showAtSeconds?: number;
  hideAtSeconds?: number | null;
}

interface StitchScene {
  recordingUrl: string;
  voiceoverUrl?: string;
  visualUrl?: string;
  visualType?: string;
  transitionUrl?: string;
  timingSegments?: TimingSegment[];
  // Launch video cinematic fields
  sfxConfig?: SceneSfxConfig;
  actionTimingLog?: ActionTimingEntry[];
  providerBanner?: ProviderBannerConfig;
  overlays?: TextOverlayConfig[];
  subtitles?: SubtitleConfig;
  narration?: string; // for subtitle generation
  avatarConfig?: AvatarConfig;
}

interface StitchRequest {
  scenes: StitchScene[];
  output?: { width?: number; height?: number; fps?: number };
  gradeVideo?: boolean;
  backgroundMusicUrl?: string;
  backgroundMusicVolume?: number; // 0.0-1.0, default 0.1
}

interface StitchJob {
  status: 'downloading' | 'compositing' | 'grading' | 'done' | 'error';
  progress: number;
  outputPath?: string;
  error?: string;
}

const jobs = new Map<string, StitchJob>();

// Bundled SFX paths (copied into Docker image)
const SFX_DIR = path.resolve(__dirname, '../../assets/sfx');
const CLICK_SFX = path.join(SFX_DIR, 'click.mp3');
const KEYSTROKE_SFX = path.join(SFX_DIR, 'keystroke.mp3');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function downloadFile(url: string, dest: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(dest, buffer);
}

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
 * Build an FFmpeg filter_complex string that mixes SFX tracks into an audio stream.
 * Returns { filterGraph, outputLabel } or null if no SFX to mix.
 */
function buildSfxMixFilter(
  sfxConfig: SceneSfxConfig,
  actionTimingLog: ActionTimingEntry[] | undefined,
  sfxInputs: Array<{ inputIndex: number; delayMs: number; volume: number }>,
): { filterGraph: string; sfxLabels: string[] } | null {
  const entries: Array<{ inputIndex: number; delayMs: number; volume: number }> = [...sfxInputs];

  // Auto-generate click/typing SFX from action timing log
  if (actionTimingLog && sfxConfig.clickSounds !== false) {
    for (const entry of actionTimingLog) {
      if (entry.type === 'click') {
        entries.push({ inputIndex: -1, delayMs: entry.timestampMs, volume: 0.6 }); // -1 = click SFX
      }
    }
  }
  if (actionTimingLog && sfxConfig.typingSounds !== false) {
    for (const entry of actionTimingLog) {
      if (entry.type === 'type') {
        const charCount = (entry.meta?.charCount as number) ?? 10;
        const avgDelay = (entry.meta?.estimatedDurationMs as number ?? charCount * 45) / charCount;
        for (let c = 0; c < charCount; c++) {
          entries.push({
            inputIndex: -2, // -2 = keystroke SFX
            delayMs: entry.timestampMs + c * avgDelay,
            volume: 0.4,
          });
        }
      }
    }
  }

  if (entries.length === 0) return null;

  const sfxLabels: string[] = [];
  const filterParts: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const label = `sfx${i}`;
    filterParts.push(`[${e.inputIndex >= 0 ? e.inputIndex : e.inputIndex === -1 ? 'click' : 'key'}:a]adelay=${Math.round(e.delayMs)}|${Math.round(e.delayMs)},volume=${e.volume}[${label}]`);
    sfxLabels.push(`[${label}]`);
  }

  return { filterGraph: filterParts.join(';'), sfxLabels };
}

// ---------------------------------------------------------------------------
// Timing segments
// ---------------------------------------------------------------------------

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

  if (activeSegments.length === 1 && activeSegments[0].speed === 1) {
    return recordingPath;
  }

  const segmentPaths: string[] = [];

  for (let si = 0; si < activeSegments.length; si++) {
    const seg = activeSegments[si];
    const segPath = path.join(tmpDir, `scene_${index}_tseg_${si}.mp4`);
    const ptsMultiplier = 1 / seg.speed;

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

// ---------------------------------------------------------------------------
// SFX mixing
// ---------------------------------------------------------------------------

/**
 * Mix SFX (click sounds, typing sounds, ambient, custom cues) into a scene.
 * Takes the composited video (with voiceover already muxed) and returns a new
 * video path with SFX mixed in.
 */
async function mixSfx(
  tmpDir: string,
  index: number,
  videoPath: string,
  sfxConfig: SceneSfxConfig,
  actionTimingLog: ActionTimingEntry[] | undefined,
): Promise<string> {
  const inputs: string[] = ['-i', videoPath];
  const needsClick = actionTimingLog?.some((e) => e.type === 'click') && sfxConfig.clickSounds !== false;
  const needsKeystroke = actionTimingLog?.some((e) => e.type === 'type') && sfxConfig.typingSounds !== false;

  // Collect all delayed SFX entries
  const sfxEntries: Array<{ delayMs: number; volume: number; source: 'click' | 'key' | 'cue'; cueUrl?: string }> = [];

  if (needsClick && actionTimingLog) {
    for (const entry of actionTimingLog) {
      if (entry.type === 'click') {
        sfxEntries.push({ delayMs: entry.timestampMs, volume: 0.6, source: 'click' });
      }
    }
  }

  if (needsKeystroke && actionTimingLog) {
    for (const entry of actionTimingLog) {
      if (entry.type === 'type') {
        const charCount = (entry.meta?.charCount as number) ?? 10;
        const totalMs = (entry.meta?.estimatedDurationMs as number) ?? charCount * 45;
        const avgDelay = totalMs / charCount;
        // Limit to 50 keystrokes per action to avoid filter explosion
        const maxChars = Math.min(charCount, 50);
        for (let c = 0; c < maxChars; c++) {
          sfxEntries.push({ delayMs: entry.timestampMs + c * avgDelay, volume: 0.4, source: 'key' });
        }
      }
    }
  }

  // Custom cues
  if (sfxConfig.cues) {
    for (const cue of sfxConfig.cues) {
      sfxEntries.push({
        delayMs: cue.atSeconds * 1000,
        volume: cue.volume ?? 0.6,
        source: 'cue',
        cueUrl: cue.sfxUrl,
      });
    }
  }

  if (sfxEntries.length === 0 && !sfxConfig.ambientUrl) {
    return videoPath; // Nothing to mix
  }

  // Download custom cue files
  const cueFiles = new Map<string, string>();
  for (const entry of sfxEntries) {
    if (entry.source === 'cue' && entry.cueUrl && !cueFiles.has(entry.cueUrl)) {
      const cuePath = path.join(tmpDir, `scene_${index}_cue_${cueFiles.size}.mp3`);
      await downloadFile(entry.cueUrl, cuePath);
      cueFiles.set(entry.cueUrl, cuePath);
    }
  }

  // Download ambient if needed
  let ambientPath: string | null = null;
  if (sfxConfig.ambientUrl) {
    ambientPath = path.join(tmpDir, `scene_${index}_ambient.mp3`);
    await downloadFile(sfxConfig.ambientUrl, ambientPath);
  }

  // Build FFmpeg command with amix approach:
  // We create a single SFX track by generating silence + overlaying each SFX at its delay
  // Simpler approach: use multiple amerge/amix inputs
  // For performance, batch SFX into a single mixed track first

  const videoDuration = await probeDuration(videoPath);

  // Generate a silent base track matching video duration
  const silencePath = path.join(tmpDir, `scene_${index}_silence.wav`);
  await execFileAsync('ffmpeg', [
    '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo`,
    '-t', String(videoDuration),
    '-c:a', 'pcm_s16le',
    '-y', silencePath,
  ]);

  // Overlay each SFX onto the silent track using sox-style approach via ffmpeg
  // We'll create individual delayed SFX files then amix them all
  const delayedPaths: string[] = [];

  for (let i = 0; i < sfxEntries.length; i++) {
    const entry = sfxEntries[i];
    let srcPath: string;
    if (entry.source === 'click') srcPath = CLICK_SFX;
    else if (entry.source === 'key') srcPath = KEYSTROKE_SFX;
    else srcPath = cueFiles.get(entry.cueUrl!)!;

    const delayedPath = path.join(tmpDir, `scene_${index}_sfx_${i}.wav`);
    const delayMs = Math.round(entry.delayMs);

    await execFileAsync('ffmpeg', [
      '-i', srcPath,
      '-af', `adelay=${delayMs}|${delayMs},volume=${entry.volume},apad=whole_dur=${videoDuration}`,
      '-ar', '44100', '-ac', '2',
      '-t', String(videoDuration),
      '-y', delayedPath,
    ]);

    delayedPaths.push(delayedPath);
  }

  // Add ambient track if present
  if (ambientPath) {
    const ambientVol = sfxConfig.ambientVolume ?? 0.15;
    const ambientLoopedPath = path.join(tmpDir, `scene_${index}_ambient_looped.wav`);
    await execFileAsync('ffmpeg', [
      '-stream_loop', '-1',
      '-i', ambientPath,
      '-af', `volume=${ambientVol}`,
      '-ar', '44100', '-ac', '2',
      '-t', String(videoDuration),
      '-y', ambientLoopedPath,
    ]);
    delayedPaths.push(ambientLoopedPath);
  }

  if (delayedPaths.length === 0) return videoPath;

  // Mix all SFX tracks into one combined track
  const sfxMixedPath = path.join(tmpDir, `scene_${index}_sfx_mixed.wav`);
  if (delayedPaths.length === 1) {
    fs.copyFileSync(delayedPaths[0], sfxMixedPath);
  } else {
    // Use amix to combine all SFX tracks
    const amixInputs: string[] = [];
    for (const dp of delayedPaths) {
      amixInputs.push('-i', dp);
    }
    await execFileAsync('ffmpeg', [
      ...amixInputs,
      '-filter_complex', `amix=inputs=${delayedPaths.length}:duration=longest:dropout_transition=0`,
      '-ar', '44100', '-ac', '2',
      '-y', sfxMixedPath,
    ]);
  }

  // Mix the combined SFX track with the original video's audio
  const outputPath = path.join(tmpDir, `scene_${index}_with_sfx.mp4`);
  await execFileAsync('ffmpeg', [
    '-i', videoPath,
    '-i', sfxMixedPath,
    '-filter_complex', '[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=0[a]',
    '-map', '0:v',
    '-map', '[a]',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k',
    '-y', outputPath,
  ]);

  return outputPath;
}

// ---------------------------------------------------------------------------
// Text overlays (provider banners, text overlays, subtitles)
// ---------------------------------------------------------------------------

function escapeDrawtext(text: string): string {
  return text.replace(/'/g, "'\\\\\\''").replace(/:/g, '\\:').replace(/\\/g, '\\\\');
}

function overlayPosition(
  pos: string,
  width: number,
  height: number,
): { x: string; y: string } {
  switch (pos) {
    case 'center': return { x: '(w-tw)/2', y: '(h-th)/2' };
    case 'bottom-center': return { x: '(w-tw)/2', y: `h-th-${Math.round(height * 0.08)}` };
    case 'top-center': return { x: '(w-tw)/2', y: `${Math.round(height * 0.05)}` };
    case 'bottom-left': return { x: '20', y: `h-th-20` };
    case 'bottom-right': return { x: 'w-tw-20', y: 'h-th-20' };
    case 'top-left': return { x: '20', y: '20' };
    case 'top-right': return { x: 'w-tw-20', y: '20' };
    default: return { x: '(w-tw)/2', y: 'h-th-40' };
  }
}

/**
 * Build FFmpeg drawtext filters for provider banners, text overlays, and subtitles.
 */
function buildTextOverlayFilters(
  scene: StitchScene,
  videoDuration: number,
  width: number,
  height: number,
): string[] {
  const filters: string[] = [];
  const fontFile = '/usr/share/fonts/truetype/inter/Inter-Bold.ttf';
  const fontFileRegular = '/usr/share/fonts/truetype/inter/Inter-Regular.ttf';

  // Provider banner
  if (scene.providerBanner) {
    const b = scene.providerBanner;
    const show = b.showAtSeconds ?? 0;
    const hide = b.hideAtSeconds ?? videoDuration;
    const pos = overlayPosition(b.position ?? 'bottom-right', width, height);
    filters.push(
      `drawtext=text='${escapeDrawtext(b.provider)}':fontfile=${fontFile}:fontsize=20:fontcolor=white:x=${pos.x}:y=${pos.y}:box=1:boxcolor=black@0.6:boxborderw=8:enable='between(t,${show},${hide})'`,
    );
  }

  // Text overlays
  if (scene.overlays) {
    for (const o of scene.overlays) {
      const pos = overlayPosition(o.position, width, height);
      const fontSize = o.fontSize ?? 24;
      const bgColor = o.backgroundColor ?? 'black@0.7';
      const textColor = o.textColor ?? 'white';
      filters.push(
        `drawtext=text='${escapeDrawtext(o.text)}':fontfile=${fontFile}:fontsize=${fontSize}:fontcolor=${textColor}:x=${pos.x}:y=${pos.y}:box=1:boxcolor=${bgColor}:boxborderw=6:enable='between(t,${o.showAtSeconds},${o.hideAtSeconds})'`,
      );
    }
  }

  // Subtitles from narration text
  if (scene.subtitles?.enabled && scene.narration) {
    const subStyle = scene.subtitles.style ?? 'default';
    const subPos = scene.subtitles.position ?? 'bottom';
    const subFontSize = scene.subtitles.fontSize ?? 32;
    const subY = subPos === 'top' ? `${Math.round(height * 0.05)}` : `h-th-${Math.round(height * 0.08)}`;

    // Split narration into ~8-word chunks distributed across duration
    const words = scene.narration.split(/\s+/);
    const chunkSize = 8;
    const chunks: string[] = [];
    for (let i = 0; i < words.length; i += chunkSize) {
      chunks.push(words.slice(i, i + chunkSize).join(' '));
    }

    const chunkDuration = videoDuration / chunks.length;
    for (let i = 0; i < chunks.length; i++) {
      const show = i * chunkDuration;
      const hide = (i + 1) * chunkDuration;
      const escaped = escapeDrawtext(chunks[i]);

      if (subStyle === 'cinematic') {
        filters.push(
          `drawtext=text='${escaped}':fontfile=${fontFile}:fontsize=${subFontSize}:fontcolor=white:x=(w-tw)/2:y=${subY}:box=1:boxcolor=black@0.6:boxborderw=10:enable='between(t,${show.toFixed(2)},${hide.toFixed(2)})'`,
        );
      } else {
        // Default style: white text with black border (no box)
        filters.push(
          `drawtext=text='${escaped}':fontfile=${fontFileRegular}:fontsize=${subFontSize}:fontcolor=white:borderw=2:bordercolor=black:x=(w-tw)/2:y=${subY}:enable='between(t,${show.toFixed(2)},${hide.toFixed(2)})'`,
        );
      }
    }
  }

  return filters;
}

// ---------------------------------------------------------------------------
// Avatar PiP overlay
// ---------------------------------------------------------------------------

async function overlayAvatar(
  tmpDir: string,
  index: number,
  videoPath: string,
  avatarConfig: AvatarConfig,
  width: number,
  height: number,
): Promise<string> {
  const avatarPath = path.join(tmpDir, `scene_${index}_avatar.mp4`);
  await downloadFile(avatarConfig.videoUrl, avatarPath);

  const videoDuration = await probeDuration(videoPath);
  const show = avatarConfig.showAtSeconds ?? 0;
  const hide = avatarConfig.hideAtSeconds ?? videoDuration;

  const avW = Math.round((avatarConfig.width ?? 0.25) * width);
  const avH = Math.round((avatarConfig.height ?? 0.35) * height);
  const avX = Math.round((avatarConfig.posX ?? 0.72) * width);
  const avY = Math.round((avatarConfig.posY ?? 0.05) * height);

  const outputPath = path.join(tmpDir, `scene_${index}_with_avatar.mp4`);

  // Scale avatar + overlay with timed enable
  const overlayFilter = `[1:v]scale=${avW}:${avH}[av];[0:v][av]overlay=x=${avX}:y=${avY}:enable='between(t,${show},${hide})'`;

  await execFileAsync('ffmpeg', [
    '-i', videoPath,
    '-i', avatarPath,
    '-filter_complex', overlayFilter,
    '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-c:a', 'copy',
    '-y', outputPath,
  ]);

  return outputPath;
}

// ---------------------------------------------------------------------------
// Scene composition
// ---------------------------------------------------------------------------

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
    // No voiceover — still apply SFX, overlays, avatar if present
    if (scene.sfxConfig && (scene.actionTimingLog || scene.sfxConfig.ambientUrl || scene.sfxConfig.cues?.length)) {
      videoPath = await mixSfx(tmpDir, index, videoPath, scene.sfxConfig, scene.actionTimingLog);
    }

    const textFilters = buildTextOverlayFilters(scene, await probeDuration(videoPath), width, height);
    if (textFilters.length > 0) {
      const withTextPath = path.join(tmpDir, `scene_${index}_text.mp4`);
      await execFileAsync('ffmpeg', [
        '-i', videoPath,
        '-vf', textFilters.join(','),
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-c:a', 'copy',
        '-y', withTextPath,
      ]);
      videoPath = withTextPath;
    }

    if (scene.avatarConfig?.videoUrl) {
      videoPath = await overlayAvatar(tmpDir, index, videoPath, scene.avatarConfig, width, height);
    }

    return videoPath;
  }

  const voiceoverPath = path.join(tmpDir, `scene_${index}_voiceover.mp3`);
  await downloadFile(scene.voiceoverUrl, voiceoverPath);

  const voDuration = await probeDuration(voiceoverPath);
  const adjustedDuration = await probeDuration(videoPath);

  const muxedPath = path.join(tmpDir, `scene_${index}_muxed.mp4`);

  const durationRatio = voDuration / adjustedDuration;
  const needsStretch = Math.abs(durationRatio - 1) > 0.05;

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
      '-y', muxedPath,
    ]);
  } else {
    await execFileAsync('ffmpeg', [
      '-i', videoPath,
      '-i', voiceoverPath,
      '-map', '0:v',
      '-map', '1:a',
      '-t', String(voDuration),
      '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '192k',
      '-y', muxedPath,
    ]);
  }

  videoPath = muxedPath;

  // Mix SFX
  if (scene.sfxConfig && (scene.actionTimingLog || scene.sfxConfig.ambientUrl || scene.sfxConfig.cues?.length)) {
    videoPath = await mixSfx(tmpDir, index, videoPath, scene.sfxConfig, scene.actionTimingLog);
  }

  // Apply text overlays (provider banner, text overlays, subtitles)
  const textFilters = buildTextOverlayFilters(scene, voDuration, width, height);
  if (textFilters.length > 0) {
    const withTextPath = path.join(tmpDir, `scene_${index}_with_text.mp4`);
    await execFileAsync('ffmpeg', [
      '-i', videoPath,
      '-vf', textFilters.join(','),
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-c:a', 'copy',
      '-y', withTextPath,
    ]);
    videoPath = withTextPath;
  }

  // Avatar PiP overlay
  if (scene.avatarConfig?.videoUrl) {
    videoPath = await overlayAvatar(tmpDir, index, videoPath, scene.avatarConfig, width, height);
  }

  return videoPath;
}

// ---------------------------------------------------------------------------
// Background music mixing
// ---------------------------------------------------------------------------

async function mixBackgroundMusic(
  tmpDir: string,
  videoPath: string,
  musicUrl: string,
  volume: number,
): Promise<string> {
  const musicPath = path.join(tmpDir, 'bgmusic.mp3');
  await downloadFile(musicUrl, musicPath);

  const videoDuration = await probeDuration(videoPath);
  const outputPath = path.join(tmpDir, 'final_with_music.mp4');

  await execFileAsync('ffmpeg', [
    '-i', videoPath,
    '-stream_loop', '-1',
    '-i', musicPath,
    '-filter_complex', `[1:a]volume=${volume},afade=t=out:st=${Math.max(0, videoDuration - 3)}:d=3[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=0[a]`,
    '-map', '0:v',
    '-map', '[a]',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k',
    '-t', String(videoDuration),
    '-y', outputPath,
  ]);

  return outputPath;
}

// ---------------------------------------------------------------------------
// Main stitch pipeline
// ---------------------------------------------------------------------------

async function executeStitch(jobId: string, input: StitchRequest): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  const tmpDir = path.join(os.tmpdir(), `sotto-stitch-${jobId}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    job.status = 'downloading';
    const width = input.output?.width ?? 1280;
    const height = input.output?.height ?? 720;

    // Composite each scene (recording + voiceover + SFX + overlays + avatar)
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

    job.progress = 75;

    // Mix background music if provided
    let musicPath = rawOutputPath;
    if (input.backgroundMusicUrl) {
      musicPath = await mixBackgroundMusic(
        tmpDir,
        rawOutputPath,
        input.backgroundMusicUrl,
        input.backgroundMusicVolume ?? 0.1,
      );
    }

    job.progress = 80;

    // Optional warm amber grading
    let finalPath = musicPath;
    if (input.gradeVideo !== false) {
      job.status = 'grading';
      const gradedPath = path.join(tmpDir, `final_graded.mp4`);
      await gradeVideo(musicPath, gradedPath);
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
    const tmpDir = path.dirname(outputPath);
    fs.rm(tmpDir, { recursive: true, force: true }, () => {});
    jobs.delete(req.params.jobId);
  });
  stream.on('error', () => {
    res.status(500).json({ error: 'Failed to read output file' });
  });
});
