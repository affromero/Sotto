import { uploadFile } from './r2';
import { logger } from './logger';
import type { VideoSegment } from '@sotto/video';

const REMOTION_URL = process.env.REMOTION_URL;

interface ShowcaseItem {
  visualType: string;
  label: string;
  description: string;
  imageUrl: string;
}

interface ShowcaseResult {
  items: ShowcaseItem[];
  failures: Array<{ visualType: string; error: string }>;
}

const STILL_TIMEOUT_MS = 30000;
const EXTERNAL_TIMEOUT_MS = 60000;

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
    frame: 60,
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
        svgContent: `<svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg">
          <style>text{font-family:Inter,sans-serif;fill:#1A1A1A}circle,rect,line{stroke:#D97706;fill:none;stroke-width:2}</style>
          <text x="200" y="30" text-anchor="middle" font-size="16" font-weight="bold">Tokamak Fusion Reactor</text>
          <ellipse cx="200" cy="160" rx="150" ry="80" stroke="#1E3A5F" stroke-width="3" fill="none"/>
          <ellipse cx="200" cy="160" rx="100" ry="50" stroke="#D97706" stroke-width="2" fill="rgba(217,119,6,0.1)"/>
          <text x="200" y="165" text-anchor="middle" font-size="12" fill="#D97706">Plasma (150M°C)</text>
          <line x1="200" y1="70" x2="200" y2="90" stroke="#6B7280"/>
          <text x="200" y="65" text-anchor="middle" font-size="11" fill="#6B7280">Magnetic Confinement</text>
          <text x="80" y="270" text-anchor="middle" font-size="11">Deuterium</text>
          <text x="320" y="270" text-anchor="middle" font-size="11">Tritium</text>
          <line x1="80" y1="255" x2="130" y2="210" stroke="#6B7280" stroke-dasharray="4"/>
          <line x1="320" y1="255" x2="270" y2="210" stroke="#6B7280" stroke-dasharray="4"/>
          <text x="200" y="290" text-anchor="middle" font-size="10" fill="#6B7280">Energy output: 10x input power (Q=10 target)</text>
        </svg>`,
      },
    },
    frame: 60,
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
        figureUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/84/Binding_energy_curve_-_common_isotopes.svg/1280px-Binding_energy_curve_-_common_isotopes.svg.png',
        sourceLabel: 'Nuclear Physics Reference Data, IAEA',
        caption: 'Binding energy per nucleon — fusion releases energy by combining light elements',
      },
    },
    frame: 45,
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

export async function generateShowcaseStills(): Promise<ShowcaseResult> {
  const items: ShowcaseItem[] = [];
  const failures: Array<{ visualType: string; error: string }> = [];

  // 1. Render programmatic types via /still
  for (const entry of CURATED_SEGMENTS) {
    try {
      logger.info('Rendering showcase still', { visualType: entry.visualType });
      const buffer = await renderStill(entry.segment, entry.frame ?? 60);
      const key = `showcase/${entry.visualType.toLowerCase()}.png`;
      const url = await uploadFile(key, buffer, 'image/png');
      items.push({
        visualType: entry.visualType,
        label: entry.label,
        description: entry.description,
        imageUrl: url,
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
      const provider = new FalImageProvider(falKey);
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
