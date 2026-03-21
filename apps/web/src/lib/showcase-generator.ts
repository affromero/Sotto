import { uploadFile } from './r2';
import { logger } from './logger';
import type { VideoSegment } from '@sotto/video';

const REMOTION_URL = process.env.REMOTION_URL;

interface ShowcaseItem {
  visualType: string;
  label: string;
  description: string;
  imageUrl: string;
  credits?: string;
}

interface ShowcaseResult {
  items: ShowcaseItem[];
  failures: Array<{ visualType: string; error: string }>;
}

interface ImageModelOption {
  modelId: string;
  displayName: string;
  pricePerImage: number;
  formattedPrice: string;
}

interface ShowcaseCostPreview {
  programmatic: { count: number; cost: string };
  aiIllustration: {
    defaultModel: string;
    provider: string;
    available: boolean;
    models: ImageModelOption[];
  };
  stockFootage: { provider: string; available: boolean; cost: string };
  mapOverlay: { provider: string; available: boolean; cost: string };
}

const STILL_TIMEOUT_MS = 30000;

const CURATED_SEGMENTS: Array<{
  visualType: string;
  label: string;
  description: string;
  segment: VideoSegment;
  frame?: number;
}> = [
  {
    visualType: 'DATA_CHART',
    label: 'Data Charts',
    description: 'Real numbers from your sources, animated as bar, line, or pie charts',
    segment: {
      segmentId: 'showcase-chart',
      order: 0,
      speaker: 'Host',
      text: '',
      startTime: 0,
      duration: 5,
      visualType: 'DATA_CHART',
      metadata: {
        chartType: 'bar',
        title: 'Global Fusion Energy Investment by Region',
        xAxisLabel: 'Region',
        yAxisLabel: 'Investment ($B)',
        data: [
          { name: 'EU (ITER)', value: 24.7 },
          { name: 'United States', value: 6.4 },
          { name: 'Private Sector', value: 6.2 },
          { name: 'China', value: 3.8 },
          { name: 'South Korea', value: 1.2 },
        ],
      },
    },
    frame: 90, // Mid-animation: bars partially grown
  },
  {
    visualType: 'DATA_TABLE',
    label: 'Data Tables',
    description: 'Exact values, rankings, and comparisons in styled tables',
    segment: {
      segmentId: 'showcase-table',
      order: 1,
      speaker: 'Expert',
      text: '',
      startTime: 0,
      duration: 5,
      visualType: 'DATA_TABLE',
      metadata: {
        headers: { title: 'Leading Fusion Startups', sourceLabel: 'Nature Energy, 2025' },
        columns: [
          { key: 'company', label: 'Company', align: 'left', widthPercent: 30 },
          { key: 'approach', label: 'Approach', align: 'left', widthPercent: 25 },
          { key: 'funding', label: 'Funding', align: 'right', widthPercent: 20, isNumeric: true },
          { key: 'target', label: 'Target Year', align: 'center', widthPercent: 25 },
        ],
        rows: [
          { key: 'cfs', values: { company: 'Commonwealth Fusion', approach: 'Tokamak (HTS)', funding: '$2.0B', target: '2030s' } },
          { key: 'helion', values: { company: 'Helion Energy', approach: 'FRC Pulsed', funding: '$577M', target: '2028' } },
          { key: 'tae', values: { company: 'TAE Technologies', approach: 'Beam-Driven FRC', funding: '$1.2B', target: '2030s' } },
          { key: 'zap', values: { company: 'Zap Energy', approach: 'Z-Pinch', funding: '$200M', target: '2030s' } },
        ],
        styleHints: { density: 'comfortable', zebraRows: true },
      },
    },
    frame: 120, // After all row animations complete (~frame 40 + margin)
  },
  {
    visualType: 'QUOTE',
    label: 'Quotes',
    description: 'Notable statements with attribution, elegantly presented',
    segment: {
      segmentId: 'showcase-quote',
      order: 2,
      speaker: 'Host',
      text: '',
      startTime: 0,
      duration: 5,
      visualType: 'QUOTE',
      metadata: {
        quoteText: 'We have put the sun in a bottle. Now the question is whether we can make it shine on demand.',
        quoteAuthor: 'Dr. Mark Henderson, ITER Deputy Director-General',
      },
    },
    frame: 60,
  },
  {
    visualType: 'COMPARISON',
    label: 'Comparisons',
    description: 'Side-by-side analysis of competing ideas or approaches',
    segment: {
      segmentId: 'showcase-comparison',
      order: 3,
      speaker: 'Expert',
      text: '',
      startTime: 0,
      duration: 5,
      visualType: 'COMPARISON',
      metadata: {
        leftLabel: 'Nuclear Fission',
        rightLabel: 'Nuclear Fusion',
        leftItems: ['Uranium fuel (finite)', 'Radioactive waste (10,000+ yrs)', 'Meltdown risk', 'Proven at scale'],
        rightItems: ['Hydrogen fuel (abundant)', 'Minimal waste (100 yrs)', 'Inherently safe', 'Not yet at scale'],
      },
    },
    frame: 90,
  },
  {
    visualType: 'TIMELINE',
    label: 'Timelines',
    description: 'Chronological events that bring history and progress to life',
    segment: {
      segmentId: 'showcase-timeline',
      order: 4,
      speaker: 'Host',
      text: '',
      startTime: 0,
      duration: 5,
      visualType: 'TIMELINE',
      metadata: {
        events: [
          { year: '1958', label: 'First Tokamak', description: 'Soviet scientists build the first tokamak reactor' },
          { year: '1997', label: 'JET Record', description: 'JET produces 16 MW of fusion power in the UK' },
          { year: '2022', label: 'NIF Ignition', description: 'US National Ignition Facility achieves fusion ignition' },
          { year: '2025', label: 'ITER Assembly', description: 'ITER tokamak assembly nears completion in France' },
          { year: '2030s', label: 'Commercial Era', description: 'First commercial fusion plants expected online' },
        ],
      },
    },
    frame: 120,
  },
  {
    visualType: 'DIAGRAM',
    label: 'Diagrams',
    description: 'Conceptual diagrams that explain systems and processes',
    segment: {
      segmentId: 'showcase-diagram',
      order: 5,
      speaker: 'Expert',
      text: '',
      startTime: 0,
      duration: 5,
      visualType: 'DIAGRAM',
      metadata: {
        svgContent: `<svg viewBox="0 0 600 400" xmlns="http://www.w3.org/2000/svg"><rect width="600" height="400" fill="#FEFCF8"/><text x="300" y="40" text-anchor="middle" font-family="Inter,sans-serif" font-size="22" font-weight="bold" fill="#1A1A1A">Tokamak Fusion Reactor</text><ellipse cx="300" cy="200" rx="200" ry="100" stroke="#1E3A5F" stroke-width="4" fill="none"/><ellipse cx="300" cy="200" rx="130" ry="60" stroke="#D97706" stroke-width="3" fill="rgba(217,119,6,0.08)"/><text x="300" y="205" text-anchor="middle" font-family="Inter,sans-serif" font-size="16" fill="#D97706" font-weight="600">Plasma (150 million C)</text><text x="300" y="80" text-anchor="middle" font-family="Inter,sans-serif" font-size="13" fill="#6B7280">Magnetic Confinement</text><line x1="300" y1="88" x2="300" y2="100" stroke="#6B7280" stroke-width="2"/><text x="100" y="350" text-anchor="middle" font-family="Inter,sans-serif" font-size="14" fill="#1A1A1A">Deuterium</text><text x="500" y="350" text-anchor="middle" font-family="Inter,sans-serif" font-size="14" fill="#1A1A1A">Tritium</text><line x1="100" y1="335" x2="170" y2="270" stroke="#6B7280" stroke-width="2" stroke-dasharray="6"/><line x1="500" y1="335" x2="430" y2="270" stroke="#6B7280" stroke-width="2" stroke-dasharray="6"/><text x="300" y="380" text-anchor="middle" font-family="Inter,sans-serif" font-size="12" fill="#6B7280">Target: Q=10 (10x more energy out than in)</text></svg>`,
      },
    },
    frame: 140, // After clip-path reveal completes (60% of 150 frames = frame 90)
  },
  {
    visualType: 'TEXT_CARD',
    label: 'Key Takeaways',
    description: 'Summary cards that highlight the most important points',
    segment: {
      segmentId: 'showcase-textcard',
      order: 6,
      speaker: 'Host',
      text: '',
      startTime: 0,
      duration: 5,
      visualType: 'TEXT_CARD',
      metadata: {
        headline: 'Why Fusion Energy Matters',
        bullets: [
          'Virtually unlimited fuel from seawater',
          'Zero carbon emissions during operation',
          'No long-lived radioactive waste',
          'Inherently safe — no meltdown risk',
        ],
        statValue: 10,
        statLabel: 'x more energy per kg than fission',
      },
    },
    frame: 90,
  },
  {
    visualType: 'SOURCE_FIGURE',
    label: 'Source Figures',
    description: 'Actual charts and images from source material with attribution',
    segment: {
      segmentId: 'showcase-source-figure',
      order: 7,
      speaker: 'Expert',
      text: '',
      startTime: 0,
      duration: 5,
      visualType: 'SOURCE_FIGURE',
      metadata: {
        figureUrl: 'https://www.iter.org/img/resize-900-90/www/content/com/Lists/ITER%20Newsline/Attachments/2177/tokamak_complex_2022.jpg',
        sourceLabel: 'ITER Organization, iter.org',
        caption: 'ITER tokamak complex — the largest fusion experiment in the world',
      },
    },
    frame: 60,
  },
];

async function renderStill(segment: VideoSegment, frame: number): Promise<Buffer> {
  if (!REMOTION_URL) throw new Error('REMOTION_URL not configured');

  const response = await fetch(`${REMOTION_URL}/still`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segment, frame }),
    signal: AbortSignal.timeout(STILL_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Still render failed: ${response.status} — ${text}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function generateShowcaseStills(opts?: { imageModel?: string }): Promise<ShowcaseResult> {
  const items: ShowcaseItem[] = [];
  const failures: Array<{ visualType: string; error: string }> = [];

  // 1. Render programmatic types via /still
  for (const entry of CURATED_SEGMENTS) {
    try {
      logger.info('Rendering showcase still', { visualType: entry.visualType });
      const buffer = await renderStill(entry.segment, entry.frame ?? 60);
      const key = `showcase/${entry.visualType.toLowerCase()}.png`;
      const url = await uploadFile(key, buffer, 'image/png');
      const credits = entry.visualType === 'SOURCE_FIGURE'
        ? (entry.segment.metadata as Record<string, unknown>)?.sourceLabel as string | undefined
        : undefined;
      items.push({
        visualType: entry.visualType,
        label: entry.label,
        description: entry.description,
        imageUrl: url,
        ...(credits && { credits }),
      });
    } catch (err) {
      const message = (err as Error).message;
      logger.error('Failed to render showcase still', { visualType: entry.visualType, error: message });
      failures.push({ visualType: entry.visualType, error: message });
    }
  }

  // 2. AI_ILLUSTRATION via image provider (platform key)
  try {
    logger.info('Generating showcase AI illustration');
    const { FalImageProvider } = await import('./providers/image/fal.provider');
    const falKey = process.env.FAL_KEY;
    if (falKey) {
      const provider = new FalImageProvider(falKey, opts?.imageModel);
      const buffer = await provider.generateImage({
        prompt: 'Inside a fusion reactor, glowing plasma contained by magnetic fields, editorial illustration style, warm amber and deep navy tones, clean lines, no text, no real people',
        width: 1280,
        height: 720,
      });
      const url = await uploadFile('showcase/ai_illustration.png', buffer, 'image/png');
      items.push({
        visualType: 'AI_ILLUSTRATION',
        label: 'AI Illustrations',
        description: 'Rich editorial illustrations generated from your content',
        imageUrl: url,
      });
    }
  } catch (err) {
    const message = (err as Error).message;
    logger.error('Failed to generate showcase AI illustration', { error: message });
    failures.push({ visualType: 'AI_ILLUSTRATION', error: message });
  }

  // 3. STOCK_FOOTAGE — search Pexels, download a frame
  try {
    logger.info('Fetching showcase stock footage');
    const { searchStockVideo, downloadStockAsset } = await import('./stock-footage');
    const result = await searchStockVideo('fusion reactor plasma energy');
    if (result) {
      const videoBuffer = await downloadStockAsset(result.url);
      // Extract first frame via FFmpeg (seek to 1s to skip any black intro)
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const { writeFile, readFile, unlink, mkdtemp } = await import('fs/promises');
      const { join } = await import('path');
      const { tmpdir } = await import('os');
      const execFileAsync = promisify(execFile);
      const tmpDir = await mkdtemp(join(tmpdir(), 'showcase-frame-'));
      const inputPath = join(tmpDir, 'input.mp4');
      const outputPath = join(tmpDir, 'frame.png');
      await writeFile(inputPath, videoBuffer);
      await execFileAsync('ffmpeg', ['-y', '-ss', '1', '-i', inputPath, '-frames:v', '1', '-q:v', '2', outputPath]);
      const frameBuffer = await readFile(outputPath);
      await Promise.allSettled([unlink(inputPath), unlink(outputPath)]);
      const { rmdir } = await import('fs/promises');
      await rmdir(tmpDir).catch(() => {});
      const url = await uploadFile('showcase/stock_footage.png', frameBuffer, 'image/png');
      items.push({
        visualType: 'STOCK_FOOTAGE',
        label: 'Stock Footage',
        description: 'Real-world video clips matched to your content',
        imageUrl: url,
        credits: `Photo by ${result.photographer} on Pexels`,
      });
    }
  } catch (err) {
    const message = (err as Error).message;
    logger.error('Failed to fetch showcase stock footage', { error: message });
    failures.push({ visualType: 'STOCK_FOOTAGE', error: message });
  }

  // 4. MAP_OVERLAY via Mapbox
  try {
    logger.info('Generating showcase map overlay');
    const { generateMapImage } = await import('./map-image');
    const buffer = await generateMapImage(
      {
        name: 'ITER Facility',
        aliases: ['ITER'],
        coordinates: [5.7583, 43.7074] as [number, number],
        modernRegion: 'Saint-Paul-lès-Durance, France',
        source: 'geonames' as const,
        confidence: 1,
      },
      'satellite',
    );
    const url = await uploadFile('showcase/map_overlay.png', buffer, 'image/png');
    items.push({
      visualType: 'MAP_OVERLAY',
      label: 'Map Overlays',
      description: 'Geographic locations rendered on beautiful maps',
      imageUrl: url,
    });
  } catch (err) {
    const message = (err as Error).message;
    logger.error('Failed to generate showcase map', { error: message });
    failures.push({ visualType: 'MAP_OVERLAY', error: message });
  }

  logger.info('Showcase generation complete', {
    count: String(items.length),
    failures: String(failures.length),
  });
  return { items, failures };
}

/**
 * Preview what the showcase generation will use — models, providers, and costs.
 * Call before generating to inform the admin.
 */
export async function getShowcaseCostPreview(): Promise<ShowcaseCostPreview> {
  const { getAutoModelConfig } = await import('./auto-model-config');
  const { fetchFalImageModels, formatCost } = await import('./video-cost-estimator');
  const config = await getAutoModelConfig();
  const imageModel = config.proImageModel ?? 'fal-flux-1-schnell';

  // Get live pricing from pricetoken
  let models: ImageModelOption[] = [];
  try {
    const imageModels = await fetchFalImageModels();
    models = imageModels.map((m) => ({
      modelId: m.modelId,
      displayName: m.modelId.replace('fal-', '').replace(/-/g, ' '),
      pricePerImage: m.pricePerImage,
      formattedPrice: formatCost(m.pricePerImage),
    }));
  } catch {
    // Empty models list — UI will show "pricing unavailable"
  }

  return {
    programmatic: {
      count: CURATED_SEGMENTS.length,
      cost: 'Free (Remotion sidecar, no external API)',
    },
    aiIllustration: {
      defaultModel: imageModel,
      provider: 'fal.ai',
      available: !!process.env.FAL_KEY,
      models,
    },
    stockFootage: {
      provider: 'Pexels',
      available: !!process.env.PEXELS_API_KEY,
      cost: 'Free (Pexels API)',
    },
    mapOverlay: {
      provider: 'Mapbox',
      available: !!process.env.MAPBOX_ACCESS_TOKEN,
      cost: 'Free tier (static image)',
    },
  };
}
