import express from 'express';
import path from 'path';
import { renderRouter, preWarmBundle } from './routes/render';
import { stillRouter } from './routes/still';
import { clipRouter, TMP_ASSETS_DIR } from './routes/clip';
import { recordRouter } from './routes/record';
import { probeRouter } from './routes/probe';

const app = express();
app.use(express.json({ limit: '50mb' }));

const PORT = parseInt(process.env.PORT ?? '3100', 10);

// Serve SFX assets statically (used by LaunchVideo Remotion composition)
app.use('/assets/sfx', express.static(path.resolve(__dirname, '../assets/sfx')));

// Serve temp assets extracted from base64 data URIs (used by /clip for large inputProps)
app.use('/tmp-assets', express.static(TMP_ASSETS_DIR));

// Mount route modules
app.use('/render', renderRouter);
app.use('/still', stillRouter);
app.use('/clip', clipRouter);
app.use('/record', recordRouter);
app.use('/probe', probeRouter);

// GET /health — health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Remotion render server listening on port ${PORT}`);
  // Pre-warm the Remotion bundle cache
  preWarmBundle();
});
