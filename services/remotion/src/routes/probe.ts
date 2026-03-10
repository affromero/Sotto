import { Router } from 'express';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { probeRemoteDuration } from '../lib/media-utils';

export const probeRouter = Router();

// GET /probe?url=<url> — probe duration of a remote media file
probeRouter.get('/', async (req, res) => {
  const url = req.query.url as string | undefined;
  if (!url) {
    res.status(400).json({ error: 'url query parameter is required' });
    return;
  }

  try {
    const tmpPath = path.join(os.tmpdir(), `sotto-probe-${uuidv4()}`);
    const durationSec = await probeRemoteDuration(url, tmpPath);
    res.json({ durationSec });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Probe failed';
    res.status(500).json({ error: message });
  }
});
