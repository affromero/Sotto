import { logger } from './logger';

export type SfxType = 'intro' | 'transition' | 'outro' | 'ambient' | 'laugh_track' | 'music_sting' | 'applause' | 'comedic_hit' | 'rim_shot';

const SFX_VOLUME_MAP: Record<SfxType, string> = {
  intro: '0.4',
  outro: '0.4',
  transition: '0.3',
  ambient: '0.15',
  laugh_track: '0.35',
  music_sting: '0.3',
  applause: '0.3',
  comedic_hit: '0.45',
  rim_shot: '0.4',
};

export interface SfxInsert {
  path: string;
  insertAfterSegment: number; // index of the segment after which to insert SFX
  durationMs: number;
  delayMs?: number; // cumulative offset from start of speech track (computed by worker)
  type: SfxType;
  volume?: number; // 0.0-1.0, overrides SFX_VOLUME_MAP
  fadeOutMs?: number; // fade-out duration in ms
}

/**
 * Stitch speech segments with sound effects using FFmpeg.
 *
 * Builds a filter graph that:
 * 1. Concatenates speech segments with short crossfades
 * 2. Overlays SFX at appropriate transition points (lower volume for ambient)
 * 3. Applies loudness normalization to the final output
 */
export async function stitchWithEffects(params: {
  segmentPaths: string[];
  sfxInserts: SfxInsert[];
  outputPath: string;
  crossfadeMs?: number;
}): Promise<{ duration: number }> {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  const { segmentPaths, sfxInserts, outputPath, crossfadeMs = 300 } = params;

  if (segmentPaths.length === 0) {
    throw new Error('No segments to stitch');
  }

  // For a single segment with no SFX, do a simple conversion
  if (segmentPaths.length === 1 && sfxInserts.length === 0) {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      segmentPaths[0],
      '-c:a',
      'libmp3lame',
      '-b:a',
      '128k',
      '-ar',
      '44100',
      '-ac',
      '1',
      '-filter:a',
      'loudnorm=I=-16:TP=-1.5:LRA=11',
      outputPath,
    ]);
    const duration = await getAudioDuration(outputPath);
    return { duration };
  }

  // Build FFmpeg inputs and filter graph
  const inputArgs: string[] = [];
  const inputLabels: string[] = [];
  let inputIndex = 0;

  // Add all speech segment inputs
  for (const segPath of segmentPaths) {
    inputArgs.push('-i', segPath);
    inputLabels.push(`[${inputIndex}:a]`);
    inputIndex++;
  }

  // Add all SFX inputs
  const sfxStartIndex = inputIndex;
  for (const sfx of sfxInserts) {
    inputArgs.push('-i', sfx.path);
    inputIndex++;
  }

  // Build filter graph
  const filters: string[] = [];
  const crossfadeSec = crossfadeMs / 1000;

  // Step 1: Normalize each speech segment to consistent format
  for (let i = 0; i < segmentPaths.length; i++) {
    filters.push(
      `[${i}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=mono[seg${i}]`
    );
  }

  // Step 2: Concatenate speech segments with crossfades
  if (segmentPaths.length === 1) {
    filters.push(`[seg0]acopy[speech]`);
  } else if (segmentPaths.length === 2) {
    filters.push(`[seg0][seg1]acrossfade=d=${crossfadeSec}:c1=tri:c2=tri[speech]`);
  } else {
    // Chain crossfades: merge first two, then each subsequent one
    filters.push(`[seg0][seg1]acrossfade=d=${crossfadeSec}:c1=tri:c2=tri[xf0]`);
    for (let i = 2; i < segmentPaths.length; i++) {
      const prevLabel = i === 2 ? 'xf0' : `xf${i - 2}`;
      const outLabel = i === segmentPaths.length - 1 ? 'speech' : `xf${i - 1}`;
      filters.push(
        `[${prevLabel}][seg${i}]acrossfade=d=${crossfadeSec}:c1=tri:c2=tri[${outLabel}]`
      );
    }
  }

  // Step 3: If there are SFX, mix them into the speech
  if (sfxInserts.length > 0) {
    // Normalize SFX inputs and apply volume adjustment
    for (let i = 0; i < sfxInserts.length; i++) {
      const sfxIdx = sfxStartIndex + i;
      const sfx = sfxInserts[i];
      const volume = sfx.volume?.toString() ?? SFX_VOLUME_MAP[sfx.type] ?? '0.3';
      const fadeFilter = sfx.fadeOutMs && sfx.durationMs > sfx.fadeOutMs
        ? `,afade=t=out:st=${((sfx.durationMs - sfx.fadeOutMs) / 1000).toFixed(3)}:d=${(sfx.fadeOutMs / 1000).toFixed(3)}`
        : '';
      filters.push(
        `[${sfxIdx}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=mono,volume=${volume}${fadeFilter}[sfx${i}]`
      );
    }

    // Apply adelay to position each SFX at the correct timestamp
    for (let i = 0; i < sfxInserts.length; i++) {
      const sfx = sfxInserts[i];
      const delayMs = sfx.delayMs ?? 0;
      if (delayMs > 0) {
        filters.push(`[sfx${i}]adelay=${delayMs}|${delayMs}[sfxd${i}]`);
      } else {
        filters.push(`[sfx${i}]acopy[sfxd${i}]`);
      }
    }

    // Mix all SFX onto the speech track; duration=first so speech controls length
    let currentLabel = 'speech';
    for (let i = 0; i < sfxInserts.length; i++) {
      const outLabel = i === sfxInserts.length - 1 ? 'mixed' : `mix${i}`;
      filters.push(
        `[${currentLabel}][sfxd${i}]amix=inputs=2:duration=first:dropout_transition=0[${outLabel}]`
      );
      currentLabel = outLabel;
    }

    // Final loudness normalization
    filters.push(`[${currentLabel}]loudnorm=I=-16:TP=-1.5:LRA=11[out]`);
  } else {
    filters.push(`[speech]loudnorm=I=-16:TP=-1.5:LRA=11[out]`);
  }

  const filterGraph = filters.join(';');

  const ffmpegArgs = [
    '-y',
    ...inputArgs,
    '-filter_complex',
    filterGraph,
    '-map',
    '[out]',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '128k',
    '-ac',
    '1',
    outputPath,
  ];

  logger.info('Running FFmpeg stitch', {
    segments: String(segmentPaths.length),
    sfx: String(sfxInserts.length),
  });

  await execFileAsync('ffmpeg', ffmpegArgs, { maxBuffer: 50 * 1024 * 1024 });

  const duration = await getAudioDuration(outputPath);

  logger.info('Audio stitching complete', {
    outputPath,
    segmentCount: String(segmentPaths.length),
    sfxCount: String(sfxInserts.length),
    duration: String(Math.round(duration)),
  });

  return { duration };
}

/**
 * Simple segment concatenation with loudness normalization (no SFX).
 * Kept as a fast path for re-stitching after interactions.
 */
export async function stitchSegments(segmentPaths: string[], outputPath: string): Promise<void> {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  const { writeFile, unlink } = await import('fs/promises');
  const concatListPath = `${outputPath}.concat.txt`;
  const concatContent = segmentPaths.map((p) => `file '${p}'`).join('\n');

  await writeFile(concatListPath, concatContent);

  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatListPath,
      '-c:a',
      'libmp3lame',
      '-b:a',
      '128k',
      '-ar',
      '44100',
      '-ac',
      '1',
      '-filter:a',
      'loudnorm=I=-16:TP=-1.5:LRA=11',
      outputPath,
    ]);

    logger.info('Audio stitching complete', {
      outputPath,
      segmentCount: String(segmentPaths.length),
    });
  } finally {
    await unlink(concatListPath).catch(() => {});
  }
}

/**
 * Get audio duration in seconds using FFprobe
 */
export async function getAudioDuration(filePath: string): Promise<number> {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'quiet',
    '-show_entries',
    'format=duration',
    '-of',
    'csv=p=0',
    filePath,
  ]);

  return parseFloat(stdout.trim());
}
