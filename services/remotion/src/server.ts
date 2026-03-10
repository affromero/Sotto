import express from 'express';
import { renderRouter, preWarmBundle } from './routes/render';
import { recordRouter } from './routes/record';
import { stitchRouter } from './routes/stitch';

const app = express();
app.use(express.json({ limit: '50mb' }));

const PORT = parseInt(process.env.PORT ?? '3100', 10);

// Mount route modules
app.use('/render', renderRouter);
app.use('/record', recordRouter);
app.use('/stitch', stitchRouter);

// GET /health — health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Remotion render server listening on port ${PORT}`);
  // Pre-warm the Remotion bundle cache
  preWarmBundle();
});
