import { Router } from 'express';
import { renderMedia, selectComposition } from '@remotion/renderer';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import type { VideoSegment } from '@sotto/video';
import { DEFAULT_RENDER_CONFIG } from '@sotto/video';
import { getBundlePath } from './render';

export const clipRouter = Router();

/** Simple concurrency limiter — max 3 clip renders at a time. */
let activeClips = 0;
const MAX_CONCURRENT_CLIPS = 3;

/**
 * POST /clip — render a short MP4 clip of a programmatic composition.
 *
 * Body: { segment: VideoSegment, durationSeconds?: number }
 * Returns: MP4 video buffer (Content-Type: video/mp4)
 *
 * Synchronous — blocks until the render is complete.
 * Uses CRF 28 for faster/smaller preview renders (vs production CRF 23).
 */
clipRouter.post('/', async (req, res) => {
  const { segment, durationSeconds = 3 } = req.body as {
    segment: VideoSegment;
    durationSeconds?: number;
  };

  if (!segment?.visualType) {
    res.status(400).json({ error: 'segment with visualType is required' });
    return;
  }

  if (activeClips >= MAX_CONCURRENT_CLIPS) {
    res.status(429).json({ error: 'Too many concurrent clip renders. Try again shortly.' });
    return;
  }

  activeClips++;
  const outputPath = path.join(os.tmpdir(), `sotto-clip-${uuidv4()}.mp4`);

  try {
    // Set segment.duration so calculateMetadata computes correct durationInFrames
    segment.duration = durationSeconds;

    const serveUrl = await getBundlePath();

    const composition = await selectComposition({
      serveUrl,
      id: 'SegmentStill',
      inputProps: { segment },
    });

    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      crf: 28,
      outputLocation: outputPath,
      inputProps: { segment },
    });

    const buffer = fs.readFileSync(outputPath);
    fs.unlinkSync(outputPath);

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    // Clean up temp file on error
    try { fs.unlinkSync(outputPath); } catch { /* ignore */ }

    const message = err instanceof Error ? err.message : 'Clip render failed';
    console.error('Clip render error:', message);
    res.status(500).json({ error: message });
  } finally {
    activeClips--;
  }
});
