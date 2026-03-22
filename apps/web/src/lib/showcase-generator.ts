import { uploadFile } from './r2';
import { logger } from './logger';
import { createAIProvider } from './providers/ai';
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

interface GeneratedSegment {
  visualType: string;
  label: string;
  description: string;
  segment: VideoSegment;
}

const SHOWCASE_PROMPT = `You are a researcher creating rich, factual sample data for a podcast video showcase. Given a topic, generate compelling content for 8 visual types. The data should be impressive, insightful, and demonstrate deep knowledge of the topic. Use REAL data, REAL people, REAL dates, and REAL organizations.

Return a JSON object:

1. "dataChart": A striking data visualization that reveals an important trend or comparison.
   { "title": string (compelling, specific — not generic), "xAxisLabel": string, "yAxisLabel": string, "chartType": "bar", "data": [{"name": string, "value": number}] (5-6 items with realistic numbers that tell a story — show contrast, growth, or surprising gaps) }
   "description": Explain what source this data was extracted from and why it matters.

2. "dataTable": A comparison or ranking that invites row-by-row scanning.
   { "headers": {"title": string, "sourceLabel": string (real publication + year)}, "columns": [{"key": string, "label": string, "align": "left"|"right"|"center", "widthPercent": number, "isNumeric": boolean}] (4 columns), "rows": [{"key": string, "values": {[columnKey]: string}}] (4-5 rows with specific, verifiable data), "styleHints": {"density": "comfortable", "zebraRows": true} }
   "description": What table was found in the source and what it reveals.

3. "quote": A powerful, real quote that captures the essence of the topic.
   { "quoteText": string (REAL quote from a REAL person — memorable, under 25 words), "quoteAuthor": string (full name, specific title/role) }
   "description": Who said this, when, and why it matters to the topic.

4. "comparison": A meaningful side-by-side that highlights a key tension or choice.
   { "leftLabel": string, "rightLabel": string, "leftItems": string[] (4 concise points), "rightItems": string[] (4 concise contrasting points) }
   "description": What the hosts debated and why this comparison illuminates the topic.

5. "timeline": Key milestones that show how the topic evolved — real dates, real events.
   { "events": [{"year": string, "label": string (3-4 words), "description": string (one vivid sentence)}] (5 events spanning significant time) }
   "description": The arc this timeline reveals about the topic.

6. "diagram": A conceptual model that explains how something works in the topic.
   { "title": string, "centerLabel": string (the core concept), "topLabel": string (input/driver), "bottomLeftLabel": string (component A), "bottomRightLabel": string (component B), "subtitle": string (the key insight) }
   "description": What system or process the diagram explains.

7. "textCard": The most important takeaways — punchy, memorable, with a headline stat.
   { "headline": string (5-8 words, compelling), "bullets": string[] (4 items, each 5-8 words, each a standalone insight), "statValue": number (a striking number), "statLabel": string (what the number means, 3-5 words) }
   "description": Why these are the key takeaways from the discussion.

8. "sourceFigure": A description of a real figure that would exist in a source paper/report.
   { "caption": string (specific, descriptive — what the figure shows), "sourceLabel": string (real journal/org + year) }
   "description": That this is an actual figure extracted from the source, shown with attribution.

9. "aiIllustration": An image generation prompt for this topic.
   { "prompt": string (detailed scene description for an editorial illustration — vivid, specific to this topic, no real people likenesses, warm tones) }
   "description": What scene was illustrated and why it matches the discussion.

10. "stockFootage": A search query for finding relevant video clips.
    { "searchQuery": string (2-4 words, specific enough to find relevant footage on Pexels) }
    "description": What real-world footage was found to accompany the narration.

11. "mapOverlay": A specific real geographic location relevant to the topic.
    { "placeName": string (specific place — a city, facility, landmark), "latitude": number, "longitude": number, "region": string (country or area) }
    "description": Why this location is significant to the topic.

CRITICAL: All data must be factually plausible and specific. No placeholder or generic content. Every number, name, date, and organization should be real or realistically derived from actual sources. For mapOverlay, use REAL coordinates of a REAL place relevant to the topic.

Return ONLY valid JSON, no markdown fences.`;

interface ExternalHints {
  aiPrompt: string;
  stockQuery: string;
  aiDescription: string;
  stockDescription: string;
  mapPlace: { name: string; lat: number; lng: number; region: string };
  mapDescription: string;
}

async function generateShowcaseMetadata(topic: string): Promise<{ segments: GeneratedSegment[]; hints: ExternalHints }> {
  const ai = createAIProvider();
  const result = await ai.generateResponse(
    SHOWCASE_PROMPT,
    [{ role: 'user', content: `Topic: ${topic}` }],
    { maxTokens: 4096, skipModeration: true },
  );

  let parsed: Record<string, unknown>;
  try {
    const cleaned = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse LLM showcase metadata: ${result.content.substring(0, 200)}`);
  }

  const chart = parsed.dataChart as Record<string, unknown>;
  const table = parsed.dataTable as Record<string, unknown>;
  const quote = parsed.quote as Record<string, unknown>;
  const comparison = parsed.comparison as Record<string, unknown>;
  const timeline = parsed.timeline as Record<string, unknown>;
  const diagram = parsed.diagram as Record<string, unknown>;
  const textCard = parsed.textCard as Record<string, unknown>;
  const sourceFigure = parsed.sourceFigure as Record<string, unknown>;
  const aiIllustration = parsed.aiIllustration as Record<string, unknown> | undefined;
  const stockFootage = parsed.stockFootage as Record<string, unknown> | undefined;
  const mapOverlay = parsed.mapOverlay as Record<string, unknown> | undefined;

  // Build SVG from diagram fields
  const d = diagram;
  const svgContent = `<svg viewBox="0 0 600 400" xmlns="http://www.w3.org/2000/svg"><rect width="600" height="400" fill="#1E3A5F" rx="20"/><text x="300" y="50" text-anchor="middle" font-family="Inter,sans-serif" font-size="22" font-weight="bold" fill="white">${d.title ?? topic}</text><circle cx="300" cy="200" r="80" fill="none" stroke="#D97706" stroke-width="4"/><circle cx="300" cy="200" r="50" fill="rgba(217,119,6,0.2)" stroke="#D97706" stroke-width="2"/><text x="300" y="205" text-anchor="middle" fill="#D97706" font-size="14" font-family="Inter,sans-serif" font-weight="600">${d.centerLabel ?? ''}</text><text x="300" y="90" text-anchor="middle" fill="#9CA3AF" font-size="13" font-family="Inter,sans-serif">${d.topLabel ?? ''}</text><text x="120" y="350" text-anchor="middle" fill="white" font-size="14" font-family="Inter,sans-serif">${d.bottomLeftLabel ?? ''}</text><text x="480" y="350" text-anchor="middle" fill="white" font-size="14" font-family="Inter,sans-serif">${d.bottomRightLabel ?? ''}</text><line x1="120" y1="335" x2="200" y2="280" stroke="#6B7280" stroke-width="2" stroke-dasharray="6"/><line x1="480" y1="335" x2="400" y2="280" stroke="#6B7280" stroke-width="2" stroke-dasharray="6"/><text x="300" y="380" text-anchor="middle" fill="#6B7280" font-size="12" font-family="Inter,sans-serif">${d.subtitle ?? ''}</text></svg>`;

  // Source figure uses a generic relevant image
  const figureUrl = `https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1280&h=720&fit=crop`;

  const hints: ExternalHints = {
    aiPrompt: (aiIllustration?.prompt as string) ?? `Editorial illustration about ${topic}, warm amber and deep navy tones, clean lines, no text, no real people likenesses`,
    aiDescription: (aiIllustration?.description as string) ?? `Created an editorial illustration for the ${topic} discussion`,
    stockQuery: (stockFootage?.searchQuery as string) ?? topic,
    stockDescription: (stockFootage?.description as string) ?? `Found relevant footage for ${topic}`,
    mapPlace: {
      name: (mapOverlay?.placeName as string) ?? topic,
      lat: (mapOverlay?.latitude as number) ?? 30,
      lng: (mapOverlay?.longitude as number) ?? 0,
      region: (mapOverlay?.region as string) ?? '',
    },
    mapDescription: (mapOverlay?.description as string) ?? `Location relevant to ${topic}`,
  };

  const segments: GeneratedSegment[] = [
    {
      visualType: 'DATA_CHART',
      label: 'Data Charts',
      description: (chart.description as string) ?? 'Extracted numerical data and rendered as an animated chart',
      segment: { segmentId: 'showcase-chart', order: 0, speaker: 'Host', text: '', startTime: 0, duration: 5, visualType: 'DATA_CHART', metadata: { chartType: chart.chartType ?? 'bar', title: chart.title, xAxisLabel: chart.xAxisLabel, yAxisLabel: chart.yAxisLabel, data: chart.data } },
    },
    {
      visualType: 'DATA_TABLE',
      label: 'Data Tables',
      description: (table.description as string) ?? 'Structured data into a comparison table',
      segment: { segmentId: 'showcase-table', order: 1, speaker: 'Expert', text: '', startTime: 0, duration: 5, visualType: 'DATA_TABLE', metadata: { headers: table.headers, columns: table.columns, rows: table.rows, styleHints: table.styleHints ?? { density: 'comfortable', zebraRows: true } } },
    },
    {
      visualType: 'QUOTE',
      label: 'Quotes',
      description: (quote.description as string) ?? 'Identified a notable quote and presented it with attribution',
      segment: { segmentId: 'showcase-quote', order: 2, speaker: 'Host', text: '', startTime: 0, duration: 5, visualType: 'QUOTE', metadata: { quoteText: quote.quoteText, quoteAuthor: quote.quoteAuthor } },
    },
    {
      visualType: 'COMPARISON',
      label: 'Comparisons',
      description: (comparison.description as string) ?? 'Structured a comparison discussed by the hosts',
      segment: { segmentId: 'showcase-comparison', order: 3, speaker: 'Expert', text: '', startTime: 0, duration: 5, visualType: 'COMPARISON', metadata: { leftLabel: comparison.leftLabel, rightLabel: comparison.rightLabel, leftItems: comparison.leftItems, rightItems: comparison.rightItems } },
    },
    {
      visualType: 'TIMELINE',
      label: 'Timelines',
      description: (timeline.description as string) ?? 'Arranged key events chronologically',
      segment: { segmentId: 'showcase-timeline', order: 4, speaker: 'Host', text: '', startTime: 0, duration: 5, visualType: 'TIMELINE', metadata: { events: timeline.events } },
    },
    {
      visualType: 'DIAGRAM',
      label: 'Diagrams',
      description: (diagram.description as string) ?? 'Generated a conceptual diagram from the discussion',
      segment: { segmentId: 'showcase-diagram', order: 5, speaker: 'Expert', text: '', startTime: 0, duration: 5, visualType: 'DIAGRAM', metadata: { svgContent } },
    },
    {
      visualType: 'TEXT_CARD',
      label: 'Key Takeaways',
      description: (textCard.description as string) ?? 'Summarized key points into a card',
      segment: { segmentId: 'showcase-textcard', order: 6, speaker: 'Host', text: '', startTime: 0, duration: 5, visualType: 'TEXT_CARD', metadata: { headline: textCard.headline, bullets: textCard.bullets, statValue: textCard.statValue, statLabel: textCard.statLabel } },
    },
    {
      visualType: 'SOURCE_FIGURE',
      label: 'Source Figures',
      description: (sourceFigure.description as string) ?? 'Displayed an actual figure from the source with attribution',
      segment: { segmentId: 'showcase-source-figure', order: 7, speaker: 'Expert', text: '', startTime: 0, duration: 5, visualType: 'SOURCE_FIGURE', metadata: { figureUrl, sourceLabel: sourceFigure.sourceLabel, caption: sourceFigure.caption } },
    },
  ];

  return { segments, hints };
}

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

export async function generateShowcaseClips(opts?: { imageModel?: string; topic?: string }): Promise<ShowcaseResult> {
  const items: ShowcaseItem[] = [];
  const failures: Array<{ visualType: string; error: string }> = [];
  const cacheBust = Date.now();

  const topic = opts?.topic || 'Technology';

  // Generate all metadata from the topic via LLM
  logger.info('Generating showcase metadata via LLM', { topic });
  const { segments: generatedSegments, hints } = await generateShowcaseMetadata(topic);

  // 1. Render programmatic types as animated clips via /clip
  for (const entry of generatedSegments) {
    try {
      logger.info('Rendering showcase clip', { visualType: entry.visualType });
      const buffer = await renderClip(entry.segment);
      const key = `showcase/${entry.visualType.toLowerCase()}-${cacheBust}.mp4`;
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
        prompt: hints.aiPrompt,
        width: 1280,
        height: 720,
      });
      // Upload image first, then render as clip with Ken Burns via ImageSlide
      const imageUrl = await uploadFile(`showcase/ai_illustration_src-${cacheBust}.png`, imageBuffer, 'image/png');
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
      const clipUrl = await uploadFile(`showcase/ai_illustration-${cacheBust}.mp4`, clipBuffer, 'video/mp4');
      items.push({
        visualType: 'AI_ILLUSTRATION',
        label: 'AI Illustrations',
        description: hints.aiDescription,
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
    const result = await searchStockVideo(hints.stockQuery);
    if (result) {
      const videoBuffer = await downloadStockAsset(result.url);
      const url = await uploadFile(`showcase/stock_footage-${cacheBust}.mp4`, videoBuffer, 'video/mp4');
      items.push({
        visualType: 'STOCK_FOOTAGE',
        label: 'Stock Footage',
        description: hints.stockDescription,
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
      name: hints.mapPlace.name,
      aliases: [],
      coordinates: [hints.mapPlace.lng, hints.mapPlace.lat] as [number, number],
      modernRegion: hints.mapPlace.region,
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
    const url = await uploadFile(`showcase/map_overlay-${cacheBust}.mp4`, clipBuffer, 'video/mp4');
    items.push({
      visualType: 'MAP_OVERLAY',
      label: 'Map Overlays',
      description: hints.mapDescription,
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
  opts?: { imageModel?: string; topic?: string },
): Promise<ShowcaseItem> {
  const cacheBust = Date.now();
  const topic = opts?.topic || 'Technology';

  // Generate fresh metadata for this single type via LLM
  const { segments: generatedSegments } = await generateShowcaseMetadata(topic);
  const entry = generatedSegments.find((s: GeneratedSegment) => s.visualType === visualType);

  if (entry) {
    const buffer = await renderClip(entry.segment);
    const key = `showcase/${entry.visualType.toLowerCase()}-${cacheBust}.mp4`;
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
      prompt: `Editorial illustration about ${topic}, warm amber and deep navy tones, clean lines, no text, no real people likenesses`,
      width: 1280, height: 720,
    });
    const imageUrl = await uploadFile(`showcase/ai_illustration_src-${cacheBust}.png`, imageBuffer, 'image/png');
    const clipBuffer = await renderClip({
      segmentId: 'showcase-ai', order: 0, speaker: 'Host', text: '', startTime: 0,
      duration: SHOWCASE_CLIP_SECONDS, visualType: 'AI_ILLUSTRATION', assetUrl: imageUrl, assetType: 'image/png',
    });
    const clipUrl = await uploadFile(`showcase/ai_illustration-${cacheBust}.mp4`, clipBuffer, 'video/mp4');
    return { visualType: 'AI_ILLUSTRATION', label: 'AI Illustrations', description: `Created an editorial illustration matching the podcast discussion about ${topic}`, url: clipUrl, mediaType: 'video' };
  }

  if (visualType === 'STOCK_FOOTAGE') {
    const { searchStockVideo, downloadStockAsset } = await import('./stock-footage');
    const result = await searchStockVideo(topic);
    if (!result) throw new Error('No stock footage found');
    const videoBuffer = await downloadStockAsset(result.url);
    const url = await uploadFile(`showcase/stock_footage-${cacheBust}.mp4`, videoBuffer, 'video/mp4');
    return { visualType: 'STOCK_FOOTAGE', label: 'Stock Footage', description: `Found relevant stock footage to accompany the discussion about ${topic}`, url, mediaType: 'video', credits: `Video by ${result.photographer} on Pexels` };
  }

  if (visualType === 'MAP_OVERLAY') {
    const { generateMapZoomFrames } = await import('./map-image');
    // Use a generic notable location — could be improved with LLM-picked location
    const place = { name: topic, aliases: [], coordinates: [0, 30] as [number, number], modernRegion: '', source: 'geonames' as const, confidence: 0.5 };
    const zoomFrames = await generateMapZoomFrames(place, 'satellite');
    const clipBuffer = await renderClip({
      segmentId: 'showcase-map', order: 0, speaker: 'Host', text: '', startTime: 0,
      duration: SHOWCASE_CLIP_SECONDS, visualType: 'MAP_OVERLAY',
      metadata: { places: [place], preset: 'satellite', zoomFrames },
    }, SHOWCASE_CLIP_SECONDS);
    const url = await uploadFile(`showcase/map_overlay-${cacheBust}.mp4`, clipBuffer, 'video/mp4');
    return { visualType: 'MAP_OVERLAY', label: 'Map Overlays', description: `Globe-to-location zoom on a geographic reference from the ${topic} discussion`, url, mediaType: 'video' };
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
      count: 8,
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
