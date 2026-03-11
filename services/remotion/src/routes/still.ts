import { Router } from 'express';
import { renderStill, selectComposition } from '@remotion/renderer';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import type { VideoSegment } from '@sotto/video';
import { DEFAULT_RENDER_CONFIG } from '@sotto/video';
import { getBundlePath } from './render';

export const stillRouter = Router();

/**
 * POST /still — render a single frame of a programmatic composition as PNG.
 *
 * Body: { segment: VideoSegment, frame?: number, durationInFrames?: number }
 * Returns: PNG image buffer (Content-Type: image/png)
 *
 * Lightweight and synchronous — no mutex, no job tracking.
 * Reuses the cached Remotion bundle from the render route.
 */
stillRouter.post('/', async (req, res) => {
  const { segment, frame = 0, durationInFrames } = req.body as {
    segment: VideoSegment;
    frame?: number;
    durationInFrames?: number;
  };

  if (!segment?.visualType) {
    res.status(400).json({ error: 'segment with visualType is required' });
    return;
  }

  const fps = DEFAULT_RENDER_CONFIG.fps;
  const computedDuration = durationInFrames ?? Math.max(1, Math.ceil((segment.duration ?? 5) * fps));
  const clampedFrame = Math.max(0, Math.min(frame, computedDuration - 1));

  const outputPath = path.join(os.tmpdir(), `sotto-still-${uuidv4()}.png`);

  try {
    const serveUrl = await getBundlePath();

    const composition = await selectComposition({
      serveUrl,
      id: 'SegmentStill',
      inputProps: { segment },
    });

    // Override duration so animations compute correctly
    composition.durationInFrames = computedDuration;

    await renderStill({
      composition,
      serveUrl,
      frame: clampedFrame,
      imageFormat: 'png',
      output: outputPath,
      inputProps: { segment },
    });

    const buffer = fs.readFileSync(outputPath);
    fs.unlinkSync(outputPath);

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    // Clean up temp file on error
    try { fs.unlinkSync(outputPath); } catch { /* ignore */ }

    const message = err instanceof Error ? err.message : 'Still render failed';
    console.error('Still render error:', message);
    res.status(500).json({ error: message });
  }
});
