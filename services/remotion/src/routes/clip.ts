import { Router } from 'express';
import { renderMedia, selectComposition } from '@remotion/renderer';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import type { VideoSegment } from '@sotto/video';
import { getBundlePath } from './render';

export const clipRouter = Router();

/** Directory for temp assets extracted from base64 data URIs. */
export const TMP_ASSETS_DIR = path.join(os.tmpdir(), 'sotto-tmp-assets');
fs.mkdirSync(TMP_ASSETS_DIR, { recursive: true });

/** Simple concurrency limiter — max 3 clip renders at a time. */
let activeClips = 0;
const MAX_CONCURRENT_CLIPS = 3;

/**
 * Extract base64 data URI to a temp file and return a local HTTP URL.
 * renderMedia serializes inputProps to each frame worker; data URIs >200KB
 * cause blank renders. Writing to disk and serving via Express avoids this.
 */
function extractDataUri(dataUri: string, port: number): { localUrl: string; filePath: string } {
  const matches = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) throw new Error('Invalid data URI');
  const mime = matches[1];
  const ext = mime.includes('png') ? '.png' : mime.includes('jpeg') || mime.includes('jpg') ? '.jpg' : '.bin';
  const fileName = `${uuidv4()}${ext}`;
  const filePath = path.join(TMP_ASSETS_DIR, fileName);
  fs.writeFileSync(filePath, Buffer.from(matches[2], 'base64'));
  return { localUrl: `http://localhost:${port}/tmp-assets/${fileName}`, filePath };
}

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
  const { segment, durationSeconds = 3, audioUrl, audioStartTime, quality = 'preview' } = req.body as {
    segment: VideoSegment;
    durationSeconds?: number;
    audioUrl?: string;
    audioStartTime?: number;
    quality?: 'preview' | 'full';
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
  const tmpAssetPaths: string[] = [];

  try {
    // Set segment.duration so calculateMetadata computes correct durationInFrames
    segment.duration = durationSeconds;

    // Extract base64 data URIs to temp files to avoid >200KB inputProps limit
    const port = parseInt(process.env.PORT ?? '3100', 10);
    if (segment.assetUrl?.startsWith('data:')) {
      const extracted = extractDataUri(segment.assetUrl, port);
      segment.assetUrl = extracted.localUrl;
      tmpAssetPaths.push(extracted.filePath);
    }

    // Extract base64 URIs from zoomFrames metadata (globe-to-location zoom)
    const zoomFrames = (segment.metadata as Record<string, unknown> | undefined)?.zoomFrames as
      Array<{ zoom: number; assetUrl: string }> | undefined;
    if (zoomFrames) {
      for (const zf of zoomFrames) {
        if (zf.assetUrl?.startsWith('data:')) {
          const extracted = extractDataUri(zf.assetUrl, port);
          zf.assetUrl = extracted.localUrl;
          tmpAssetPaths.push(extracted.filePath);
        }
      }
    }

    const serveUrl = await getBundlePath();

    const inputProps = {
      segment,
      ...(audioUrl && { audioUrl }),
      ...(audioStartTime !== undefined && { audioStartTime }),
    };

    const composition = await selectComposition({
      serveUrl,
      id: 'SegmentStill',
      inputProps,
    });

    const crf = quality === 'full' ? 23 : 28;

    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      crf,
      outputLocation: outputPath,
      inputProps,
    });

    const stat = fs.statSync(outputPath);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', stat.size);

    const stream = fs.createReadStream(outputPath);
    stream.pipe(res);
    stream.on('end', () => {
      fs.unlink(outputPath, () => {});
    });
    stream.on('error', () => {
      fs.unlink(outputPath, () => {});
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream clip' });
      }
    });
  } catch (err) {
    try { fs.unlinkSync(outputPath); } catch { /* ignore */ }

    const message = err instanceof Error ? err.message : 'Clip render failed';
    console.error('Clip render error:', message);
    res.status(500).json({ error: message });
  } finally {
    activeClips--;
    // Clean up extracted assets
    for (const p of tmpAssetPaths) {
      try { fs.unlinkSync(p); } catch { /* ignore */ }
    }
  }
});
