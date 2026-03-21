import { uploadFile } from './r2';
import { logger } from './logger';
import type { VideoSegment } from '@sotto/video';

const REMOTION_URL = process.env.REMOTION_URL;

export interface ShowcaseItem {
  visualType: string;
  label: string;
  description: string;
  url: string;
  mediaType: 'image' | 'video';
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
    description: 'Found investment figures in a Nature Energy paper and rendered them as an animated bar chart with exact values',
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
    description: 'Extracted a comparison table from the paper and rendered it with funding data, approach types, and target dates',
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
    description: 'Identified a key statement from ITER Deputy Director-General and presented it with proper attribution',
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
    description: 'The hosts compared fission vs fusion — the system structured their points into a side-by-side visual',
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
    description: 'Detected historical milestones mentioned in the conversation and arranged them chronologically',
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
    description: 'Generated a diagram to illustrate how a tokamak reactor works, based on the technical explanation in the script',
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
    description: 'Summarized the main arguments from the discussion into a bullet-point card with a headline stat',
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
    description: 'Pulled an actual figure from the source paper and displayed it with proper attribution — not an AI re-interpretation',
    segment: {
      segmentId: 'showcase-source-figure',
      order: 7,
      speaker: 'Expert',
      text: '',
      startTime: 0,
      duration: 5,
      visualType: 'SOURCE_FIGURE',
      metadata: {
        figureUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1280&h=720&fit=crop',
        sourceLabel: 'NASA Earth Observatory',
        caption: 'Global energy distribution — visualizing where fusion could transform power grids',
      },
    },
    frame: 60,
  },
];

const CLIP_TIMEOUT_MS = 60000;
const SHOWCASE_CLIP_SECONDS = 5;

async function renderClip(segment: VideoSegment, durationSeconds = SHOWCASE_CLIP_SECONDS): Promise<Buffer> {
  if (!REMOTION_URL) throw new Error('REMOTION_URL not configured');

  const response = await fetch(`${REMOTION_URL}/clip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segment, durationSeconds, quality: 'full' }),
    signal: AbortSignal.timeout(CLIP_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Clip render failed: ${response.status} — ${text}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function generateShowcaseClips(opts?: { imageModel?: string }): Promise<ShowcaseResult> {
  const items: ShowcaseItem[] = [];
  const failures: Array<{ visualType: string; error: string }> = [];

  // 1. Render programmatic types as animated clips via /clip
  for (const entry of CURATED_SEGMENTS) {
    try {
      logger.info('Rendering showcase clip', { visualType: entry.visualType });
      const buffer = await renderClip(entry.segment);
      const key = `showcase/${entry.visualType.toLowerCase()}.mp4`;
      const url = await uploadFile(key, buffer, 'video/mp4');
      const credits = entry.visualType === 'SOURCE_FIGURE'
        ? (entry.segment.metadata as Record<string, unknown>)?.sourceLabel as string | undefined
        : undefined;
      items.push({
        visualType: entry.visualType,
        label: entry.label,
        description: entry.description,
        url,
        mediaType: 'video',
        ...(credits && { credits }),
      });
    } catch (err) {
      const message = (err as Error).message;
      logger.error('Failed to render showcase still', { visualType: entry.visualType, error: message });
      failures.push({ visualType: entry.visualType, error: message });
    }
  }

  // 2. AI_ILLUSTRATION — generate image then render as clip with Ken Burns
  try {
    logger.info('Generating showcase AI illustration');
    const { FalImageProvider } = await import('./providers/image/fal.provider');
    const falKey = process.env.FAL_KEY;
    if (falKey) {
      const selectedModel = opts?.imageModel;
      logger.info('Generating AI illustration', { model: selectedModel ?? 'default (fal-flux-1-schnell)' });
      const provider = new FalImageProvider(falKey, selectedModel);
      const imageBuffer = await provider.generateImage({
        prompt: 'Inside a fusion reactor, glowing plasma contained by magnetic fields, editorial illustration style, warm amber and deep navy tones, clean lines, no text, no real people',
        width: 1280,
        height: 720,
      });
      // Upload image first, then render as clip with Ken Burns via ImageSlide
      const imageUrl = await uploadFile('showcase/ai_illustration_src.png', imageBuffer, 'image/png');
      const clipBuffer = await renderClip({
        segmentId: 'showcase-ai',
        order: 0,
        speaker: 'Host',
        text: '',
        startTime: 0,
        duration: SHOWCASE_CLIP_SECONDS,
        visualType: 'AI_ILLUSTRATION',
        assetUrl: imageUrl,
        assetType: 'image/png',
      });
      const clipUrl = await uploadFile('showcase/ai_illustration.mp4', clipBuffer, 'video/mp4');
      items.push({
        visualType: 'AI_ILLUSTRATION',
        label: 'AI Illustrations',
        description: 'Created an editorial illustration of plasma containment inside a reactor, matching the segment where hosts describe the process',
        url: clipUrl,
        mediaType: 'video',
      });
    }
  } catch (err) {
    const message = (err as Error).message;
    logger.error('Failed to generate showcase AI illustration', { error: message });
    failures.push({ visualType: 'AI_ILLUSTRATION', error: message });
  }

  // 3. STOCK_FOOTAGE — search Pexels, upload actual video clip
  try {
    logger.info('Fetching showcase stock footage');
    const { searchStockVideo, downloadStockAsset } = await import('./stock-footage');
    const result = await searchStockVideo('fusion reactor plasma energy');
    if (result) {
      const videoBuffer = await downloadStockAsset(result.url);
      const url = await uploadFile('showcase/stock_footage.mp4', videoBuffer, 'video/mp4');
      items.push({
        visualType: 'STOCK_FOOTAGE',
        label: 'Stock Footage',
        description: 'Found relevant stock footage of energy infrastructure to accompany the discussion on power generation',
        url,
        mediaType: 'video',
        credits: `Video by ${result.photographer} on Pexels`,
      });
    }
  } catch (err) {
    const message = (err as Error).message;
    logger.error('Failed to fetch showcase stock footage', { error: message });
    failures.push({ visualType: 'STOCK_FOOTAGE', error: message });
  }

  // 4. MAP_OVERLAY — generate globe-to-location zoom frames, render as animated clip
  try {
    logger.info('Generating showcase map with globe zoom');
    const { generateMapZoomFrames } = await import('./map-image');
    const place = {
      name: 'ITER Facility',
      aliases: ['ITER'],
      coordinates: [5.7583, 43.7074] as [number, number],
      modernRegion: 'Saint-Paul-lès-Durance, France',
      source: 'geonames' as const,
      confidence: 1,
    };
    const zoomFrames = await generateMapZoomFrames(place, 'satellite');
    const clipBuffer = await renderClip({
      segmentId: 'showcase-map',
      order: 0,
      speaker: 'Host',
      text: '',
      startTime: 0,
      duration: SHOWCASE_CLIP_SECONDS,
      visualType: 'MAP_OVERLAY',
      metadata: {
        places: [place],
        preset: 'satellite',
        zoomFrames,
      },
    }, SHOWCASE_CLIP_SECONDS);
    const url = await uploadFile('showcase/map_overlay.mp4', clipBuffer, 'video/mp4');
    items.push({
      visualType: 'MAP_OVERLAY',
      label: 'Map Overlays',
      description: 'Globe-to-location zoom on geographic references',
      url,
      mediaType: 'video',
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
 * Regenerate a single visual type within a showcase set.
 * Returns the updated item or throws on failure.
 */
export async function regenerateShowcaseItem(
  visualType: string,
  opts?: { imageModel?: string },
): Promise<ShowcaseItem> {
  // Find the curated segment for this type
  const entry = CURATED_SEGMENTS.find((s) => s.visualType === visualType);

  if (entry) {
    // Programmatic type — re-render via /clip
    const buffer = await renderClip(entry.segment);
    const key = `showcase/${entry.visualType.toLowerCase()}.mp4`;
    const url = await uploadFile(key, buffer, 'video/mp4');
    const credits = entry.visualType === 'SOURCE_FIGURE'
      ? (entry.segment.metadata as Record<string, unknown>)?.sourceLabel as string | undefined
      : undefined;
    return {
      visualType: entry.visualType,
      label: entry.label,
      description: entry.description,
      url,
      mediaType: 'video',
      ...(credits && { credits }),
    };
  }

  // External types — AI_ILLUSTRATION, STOCK_FOOTAGE, MAP_OVERLAY
  if (visualType === 'AI_ILLUSTRATION') {
    const { FalImageProvider } = await import('./providers/image/fal.provider');
    const falKey = process.env.FAL_KEY;
    if (!falKey) throw new Error('FAL_KEY not configured');
    const provider = new FalImageProvider(falKey, opts?.imageModel);
    const imageBuffer = await provider.generateImage({
      prompt: 'Inside a fusion reactor, glowing plasma contained by magnetic fields, editorial illustration style, warm amber and deep navy tones, clean lines, no text, no real people',
      width: 1280, height: 720,
    });
    const imageUrl = await uploadFile('showcase/ai_illustration_src.png', imageBuffer, 'image/png');
    const clipBuffer = await renderClip({
      segmentId: 'showcase-ai', order: 0, speaker: 'Host', text: '', startTime: 0,
      duration: SHOWCASE_CLIP_SECONDS, visualType: 'AI_ILLUSTRATION', assetUrl: imageUrl, assetType: 'image/png',
    });
    const clipUrl = await uploadFile('showcase/ai_illustration.mp4', clipBuffer, 'video/mp4');
    return { visualType: 'AI_ILLUSTRATION', label: 'AI Illustrations', description: 'Created an editorial illustration of plasma containment inside a reactor, matching the segment where hosts describe the process', url: clipUrl, mediaType: 'video' };
  }

  if (visualType === 'STOCK_FOOTAGE') {
    const { searchStockVideo, downloadStockAsset } = await import('./stock-footage');
    const result = await searchStockVideo('fusion reactor plasma energy');
    if (!result) throw new Error('No stock footage found');
    const videoBuffer = await downloadStockAsset(result.url);
    const url = await uploadFile('showcase/stock_footage.mp4', videoBuffer, 'video/mp4');
    return { visualType: 'STOCK_FOOTAGE', label: 'Stock Footage', description: 'Found relevant stock footage of energy infrastructure to accompany the discussion on power generation', url, mediaType: 'video', credits: `Video by ${result.photographer} on Pexels` };
  }

  if (visualType === 'MAP_OVERLAY') {
    const { generateMapZoomFrames } = await import('./map-image');
    const place = { name: 'ITER Facility', aliases: ['ITER'], coordinates: [5.7583, 43.7074] as [number, number], modernRegion: 'Saint-Paul-les-Durance, France', source: 'geonames' as const, confidence: 1 };
    const zoomFrames = await generateMapZoomFrames(place, 'satellite');
    const clipBuffer = await renderClip({
      segmentId: 'showcase-map', order: 0, speaker: 'Host', text: '', startTime: 0,
      duration: SHOWCASE_CLIP_SECONDS, visualType: 'MAP_OVERLAY',
      metadata: { places: [place], preset: 'satellite', zoomFrames },
    }, SHOWCASE_CLIP_SECONDS);
    const url = await uploadFile('showcase/map_overlay.mp4', clipBuffer, 'video/mp4');
    return { visualType: 'MAP_OVERLAY', label: 'Map Overlays', description: 'Globe-to-location zoom on geographic references', url, mediaType: 'video' };
  }

  throw new Error(`Unknown visual type: ${visualType}`);
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
