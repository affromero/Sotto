/**
 * Visual classifier — single AI call to classify all segments in a podcast
 * with visual types and generation metadata for video production.
 *
 * Supports multiple sub-visuals per segment: a 30s voice segment can have
 * different visual types for different portions (e.g., TEXT_CARD → MAP_OVERLAY → AI_ILLUSTRATION).
 */
import { createAIProvider } from './providers/ai';
import { logger } from './logger';
import { z } from 'zod';

export interface SegmentInput {
  segmentId: string;
  order: number;
  speaker: string;
  text: string;
  duration: number;
}

export type VisualTypeString =
  | 'AI_ILLUSTRATION'
  | 'STOCK_FOOTAGE'
  | 'DATA_CHART'
  | 'QUOTE'
  | 'COMPARISON'
  | 'TIMELINE'
  | 'DIAGRAM'
  | 'TEXT_CARD'
  | 'MAP_OVERLAY'
  | 'DATA_TABLE'
  | 'SOURCE_FIGURE';

export interface ClassifiedSubVisual {
  subOrder: number;
  startOffsetFraction: number; // 0.0-1.0 of segment duration
  durationFraction: number; // 0.0-1.0 of segment duration
  visualType: VisualTypeString;
  prompt: string | null;
  metadata: Record<string, unknown> | null;
  endStatePrompt: string | null;
}

export interface ClassifiedSegment {
  segmentId: string;
  order: number;
  subVisuals: ClassifiedSubVisual[];
}

export interface TransitionRecommendation {
  fromSegmentOrder: number;
  toSegmentOrder: number;
  reason: string;
}

const VISUAL_TYPE_ENUM = [
  'AI_ILLUSTRATION',
  'STOCK_FOOTAGE',
  'DATA_CHART',
  'QUOTE',
  'COMPARISON',
  'TIMELINE',
  'DIAGRAM',
  'TEXT_CARD',
  'MAP_OVERLAY',
  'DATA_TABLE',
  'SOURCE_FIGURE',
] as const;

const subVisualSchema = z.object({
  subOrder: z.number().int().min(0),
  startOffsetFraction: z.number().min(0).max(1),
  durationFraction: z.number().min(0).max(1),
  visualType: z.enum(VISUAL_TYPE_ENUM),
  prompt: z.string().nullable(),
  metadata: z.union([z.record(z.unknown()), z.string(), z.null()]),
  endStatePrompt: z.string().nullable().optional(),
});

const classificationItemSchema = z.object({
  order: z.number(),
  subVisuals: z.array(subVisualSchema).min(1),
});

// Legacy flat format (single visual per segment) for backward compat
const legacyClassificationItemSchema = z.object({
  order: z.number(),
  visualType: z.enum(VISUAL_TYPE_ENUM),
  prompt: z.string().nullable(),
  metadata: z.union([z.record(z.unknown()), z.string(), z.null()]),
  endStatePrompt: z.string().nullable().optional(),
});

const transitionRecommendationSchema = z.object({
  fromSegmentOrder: z.number().int(),
  toSegmentOrder: z.number().int(),
  reason: z.string(),
});

const classificationSchema = z.object({
  segments: z.array(z.union([classificationItemSchema, legacyClassificationItemSchema])),
  transitionRecommendations: z.array(transitionRecommendationSchema).optional().default([]),
});

const ZERO_COST_CONSTRAINT = `
IMPORTANT CONSTRAINT — ZERO-COST MODE:
You MUST NOT use AI_ILLUSTRATION. It is not available. Use TEXT_CARD, STOCK_FOOTAGE, DATA_CHART, DATA_TABLE, QUOTE, COMPARISON, TIMELINE, DIAGRAM, MAP_OVERLAY, or SOURCE_FIGURE instead.
For narrative/abstract moments that would normally be AI_ILLUSTRATION, use TEXT_CARD with a descriptive headline and bullets.
`;

const SYSTEM_PROMPT = `You are a video producer. Given podcast segments, assign each one visual types for a video overlay.

VISUAL TYPES:
- AI_ILLUSTRATION: Rich editorial illustration. Provide a detailed image prompt (style: editorial illustration, clean, warm tones, no real people likenesses).
- STOCK_FOOTAGE: Real-world video clip. Provide a short search query in prompt.
- DATA_CHART: Bar, line, or pie chart with fully descriptive labels. Provide metadata: { chartType, data: [{name: "descriptive label", ...values}], title: "Descriptive Chart Title — explain what the chart shows", xAxisLabel: "X-axis description with units", yAxisLabel: "Y-axis description with units" }. Use descriptive data key names (e.g., "Revenue ($M)" not "value"). For pie charts, xAxisLabel and yAxisLabel are optional.
- QUOTE: Notable quote. Provide metadata: { quoteText, quoteAuthor }.
- COMPARISON: Two-column comparison. Provide metadata: { leftLabel, rightLabel, leftItems: string[], rightItems: string[] }.
- TIMELINE: Chronological events. Provide metadata: { events: [{ year, label, description }] }.
- DIAGRAM: Conceptual diagram. Provide metadata: { svgContent } with a simple SVG string.
- TEXT_CARD: Key points summary. Provide metadata: { headline, bullets: string[], statValue?, statLabel? }.
- MAP_OVERLAY: Geographic content — specific locations, historical places, battle sites, trade routes, geographic features. Provide a search-friendly place description in prompt. Provide metadata: { places: [{ name, yearHint? }], preset: "vintage"|"satellite"|"cinematic" }.
- SOURCE_FIGURE: An actual figure, chart, or screenshot extracted from the source material. Use when verified source figures are listed and the segment references the same content. Provide metadata: { figureUrl: "the URL from the available source figures list", sourceLabel: "attribution text e.g. Figure 3, Smith et al. 2024", caption: "figure description" }. Prefer SOURCE_FIGURE over AI_ILLUSTRATION when a matching source figure exists.
- DATA_TABLE: Tabular data — exact-value lookups, rankings, league tables, benchmark matrices, before/after numeric inventories, or any case where the viewer should scan rows and compare precise cells. Use DATA_TABLE when exact numbers or labels matter more than visual shape; use DATA_CHART for trends/proportions instead. Keep to <= 5 columns and <= 8 rows. Provide metadata: { headers: { title?, subtitle?, sourceLabel? }, columns: [{ key, label, align?, widthPercent?, isNumeric? }], rows: [{ key, values: { [columnKey]: string|number }, toneByColumnKey?, isSummary? }], styleHints?: { density?, zebraRows?, showGridLines?, emphasizeFirstColumn?, maxVisibleRows? }, highlightCells?: [{ rowKey, columnKey, tone?, pulse? }], sortIndicators?: [{ columnKey, direction: "asc"|"desc" }] }.

SUB-VISUAL RULES:
1. Each segment can have ONE or MORE sub-visuals that divide it into visual portions.
2. Segments under 20 seconds: use a single sub-visual.
3. Segments 20-45 seconds: use 1-2 sub-visuals. Split only if the content shifts to a clearly different idea or topic.
4. Segments over 45 seconds: identify each distinct idea, argument, or topic in the text.
   Create one sub-visual per idea. A quick stat mention (one sentence) = short durationFraction.
   A deep explanation (several sentences) = longer durationFraction. Scale proportionally to text
   devoted to each idea. No upper cap — a 3-minute monologue covering 8 ideas = 8 sub-visuals.
5. Sub-visual startOffsetFraction and durationFraction values must sum to exactly 1.0 for each segment.
6. Each sub-visual's startOffsetFraction must equal the sum of all preceding sub-visuals' durationFraction values.
7. Ensure visual variety — avoid the same visual type in consecutive sub-visuals within a segment.

MAP DETECTION:
8. When the speaker text mentions specific geographic locations, cities, countries, regions, or routes, PROACTIVELY use a MAP_OVERLAY sub-visual for that portion — even alongside other visual types. For example, "The Silk Road stretched from Xi'an to Constantinople" should get a MAP_OVERLAY sub-visual for that portion.

GENERAL RULES:
9. Ensure visual variety across segments — don't assign the same type to more than 3 consecutive sub-visuals.
10. Use AI_ILLUSTRATION for vivid narrative moments, abstract concepts, and scene-setting.
11. Use STOCK_FOOTAGE for real-world topics (nature, cities, technology in action).
12. Use DATA_CHART when numbers, statistics, or trends are discussed — prefer DATA_TABLE when exact values matter more than the shape of the trend.
12b. Use DATA_TABLE for rankings, league tables, benchmarks, pricing comparisons, or any content where the viewer needs to scan rows and compare precise cell values.
13. Use QUOTE when a notable quote or key statement is highlighted.
14. Use TEXT_CARD as a general fallback for explanatory content.
15. Never generate likenesses of real, identifiable people in AI_ILLUSTRATION prompts.
16. For AI_ILLUSTRATION and STOCK_FOOTAGE sub-visuals, also provide "endStatePrompt": a description of how the scene should look AFTER the narration concludes. For other visual types, set endStatePrompt to null.

TRANSITION RECOMMENDATIONS:
17. Evaluate each boundary between consecutive segments. Recommend an AI video transition when:
    - The topic shifts significantly (e.g., new subject, different era, different domain)
    - The mood or tone changes (e.g., serious → lighthearted, data → narrative)
    - The visual shifts from abstract to concrete or vice versa
    - There is a geographic or temporal change
18. Do NOT recommend transitions when:
    - The same point continues across the boundary
    - It is a mid-sentence break between segments
    - The visuals are closely related (same type, similar content)
19. Include a short reason for each recommendation.

Return JSON: { "segments": [{ "order": number, "subVisuals": [{ "subOrder": 0, "startOffsetFraction": 0.0, "durationFraction": 0.5, "visualType": string, "prompt": string|null, "metadata": string|null, "endStatePrompt": string|null }] }], "transitionRecommendations": [{ "fromSegmentOrder": number, "toSegmentOrder": number, "reason": string }] }
For metadata, return a JSON-encoded string (e.g. "{\\"chartType\\":\\"bar\\",\\"title\\":\\"Revenue\\"}"), not a raw object. Return null if no metadata is needed.`;

function parseMetadata(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (raw && typeof raw === 'object') {
    return raw as Record<string, unknown>;
  }
  return null;
}

function isLegacyItem(item: z.infer<typeof classificationSchema>['segments'][number]): item is z.infer<typeof legacyClassificationItemSchema> {
  return 'visualType' in item && !('subVisuals' in item);
}

function wrapLegacyAsSubVisual(item: z.infer<typeof legacyClassificationItemSchema>): ClassifiedSubVisual {
  return {
    subOrder: 0,
    startOffsetFraction: 0,
    durationFraction: 1,
    visualType: item.visualType,
    prompt: item.prompt,
    metadata: parseMetadata(item.metadata),
    endStatePrompt: item.endStatePrompt ?? null,
  };
}

export interface StructuredSourceData {
  tables?: { caption: string | null; headers: string[]; rows: string[][]; sourceLabel: string | null }[];
  figures?: { url: string; caption: string | null; altText: string | null; sourceLabel: string | null; mimeType: string }[];
  keyStatistics?: { label: string; value: string; unit: string | null; context: string | null }[];
}

export async function classifySegmentVisuals(
  segments: SegmentInput[],
  podcastTitle: string,
  podcastTopic: string,
  opts: { provider: string; model: string; apiKeyOverride?: string; structuredData?: StructuredSourceData; zeroCostVideo?: boolean },
): Promise<{ classifications: ClassifiedSegment[]; transitionRecommendations: TransitionRecommendation[]; inputTokens: number; outputTokens: number; model: string }> {
  const segmentList = segments
    .map((s) => `[${s.order}] ${s.speaker}: ${s.text} (${s.duration.toFixed(1)}s)`)
    .join('\n');

  const structuredSections: string[] = [];

  if (opts.structuredData?.tables && opts.structuredData.tables.length > 0) {
    const tableBlocks = opts.structuredData.tables.map((t, i) => {
      const label = t.caption || `Table ${i + 1}`;
      const header = t.headers.join(' | ');
      const rows = t.rows.slice(0, 20).map((r) => r.join(' | ')).join('\n');
      return `[${label}]\n${header}\n${rows}`;
    });
    structuredSections.push(`\nAvailable Source Tables (use exact values for DATA_TABLE/DATA_CHART):\n${tableBlocks.join('\n\n')}`);
  }

  if (opts.structuredData?.figures && opts.structuredData.figures.length > 0) {
    // Exclude data URIs from the prompt — they'd explode token count
    const httpFigures = opts.structuredData.figures.filter((f) => !f.url.startsWith('data:'));
    if (httpFigures.length > 0) {
      const figureLines = httpFigures.map((f, i) => {
        const label = f.caption || f.altText || `Figure ${i + 1}`;
        return `[Figure ${i + 1}: "${label}"] URL: ${f.url}`;
      });
      structuredSections.push(`\nAvailable Source Figures (use SOURCE_FIGURE when segment references these):\n${figureLines.join('\n')}`);
    }
  }

  const structuredBlock = structuredSections.length > 0 ? `\n${structuredSections.join('\n')}` : '';

  const userMessage = `Podcast: "${podcastTitle}"
Topic: ${podcastTopic}

Segments:
${segmentList}
${structuredBlock}
Classify each segment with sub-visuals. Return JSON only.`;

  const systemPrompt = opts.zeroCostVideo
    ? SYSTEM_PROMPT.replace(/- AI_ILLUSTRATION:.*?\n/, '').replace(/10\. Use AI_ILLUSTRATION.*?\n/, '10. Use TEXT_CARD for vivid narrative moments, abstract concepts, and scene-setting.\n') + ZERO_COST_CONSTRAINT
    : SYSTEM_PROMPT;

  const ai = createAIProvider(opts.provider);
  const result = await ai.generateResponse(
    systemPrompt,
    [{ role: 'user', content: userMessage }],
    {
      maxTokens: 8192,
      model: opts.model,
      apiKeyOverride: opts.apiKeyOverride,
      skipModeration: true,
      jsonSchema: {
        name: 'visual_classification',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            segments: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  order: { type: 'number' },
                  subVisuals: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        subOrder: { type: 'number' },
                        startOffsetFraction: { type: 'number' },
                        durationFraction: { type: 'number' },
                        visualType: { type: 'string' },
                        prompt: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                        metadata: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                        endStatePrompt: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                      },
                      required: ['subOrder', 'startOffsetFraction', 'durationFraction', 'visualType', 'prompt', 'metadata', 'endStatePrompt'],
                    },
                  },
                },
                required: ['order', 'subVisuals'],
              },
            },
            transitionRecommendations: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  fromSegmentOrder: { type: 'number' },
                  toSegmentOrder: { type: 'number' },
                  reason: { type: 'string' },
                },
                required: ['fromSegmentOrder', 'toSegmentOrder', 'reason'],
              },
            },
          },
          required: ['segments', 'transitionRecommendations'],
        },
      },
    },
  );

  let parsed: z.infer<typeof classificationSchema>;
  try {
    const json = JSON.parse(result.content);
    parsed = classificationSchema.parse(json);
  } catch (err) {
    logger.error('Failed to parse visual classification response', {
      error: err instanceof Error ? err.message : String(err),
      response: result.content.slice(0, 500),
    });
    // Fallback: assign TEXT_CARD to all segments
    parsed = {
      segments: segments.map((s) => ({
        order: s.order,
        subVisuals: [{
          subOrder: 0,
          startOffsetFraction: 0,
          durationFraction: 1,
          visualType: 'TEXT_CARD' as const,
          prompt: null,
          metadata: { headline: podcastTitle, bullets: [s.text.slice(0, 200)] },
          endStatePrompt: null,
        }],
      })),
      transitionRecommendations: [],
    };
  }

  // Map classified segments back to segment IDs
  const orderToId = new Map(segments.map((s) => [s.order, s.segmentId]));
  const classifications: ClassifiedSegment[] = parsed.segments
    .filter((c) => orderToId.has(c.order))
    .map((c) => {
      // Handle legacy flat format (single visual per segment)
      if (isLegacyItem(c)) {
        return {
          segmentId: orderToId.get(c.order)!,
          order: c.order,
          subVisuals: [wrapLegacyAsSubVisual(c)],
        };
      }

      // New multi-visual format
      const subVisuals: ClassifiedSubVisual[] = c.subVisuals.map((sv) => ({
        subOrder: sv.subOrder,
        startOffsetFraction: sv.startOffsetFraction,
        durationFraction: sv.durationFraction,
        visualType: sv.visualType,
        prompt: sv.prompt,
        metadata: parseMetadata(sv.metadata),
        endStatePrompt: sv.endStatePrompt ?? null,
      }));

      // Validate fractions sum to ~1.0
      const fractionSum = subVisuals.reduce((sum, sv) => sum + sv.durationFraction, 0);
      if (Math.abs(fractionSum - 1.0) > 0.05) {
        logger.warn('Sub-visual duration fractions do not sum to 1.0, normalizing', {
          order: String(c.order),
          fractionSum: String(fractionSum),
        });
        // Normalize fractions
        for (const sv of subVisuals) {
          sv.durationFraction = sv.durationFraction / fractionSum;
        }
        // Recalculate startOffsets
        let offset = 0;
        for (const sv of subVisuals) {
          sv.startOffsetFraction = offset;
          offset += sv.durationFraction;
        }
      }

      return {
        segmentId: orderToId.get(c.order)!,
        order: c.order,
        subVisuals,
      };
    });

  // Fill in any segments that the AI missed
  for (const seg of segments) {
    if (!classifications.find((c) => c.segmentId === seg.segmentId)) {
      classifications.push({
        segmentId: seg.segmentId,
        order: seg.order,
        subVisuals: [{
          subOrder: 0,
          startOffsetFraction: 0,
          durationFraction: 1,
          visualType: 'TEXT_CARD',
          prompt: null,
          metadata: { headline: podcastTitle, bullets: [seg.text.slice(0, 200)] },
          endStatePrompt: null,
        }],
      });
    }
  }

  // Defense-in-depth: strip AI_ILLUSTRATION in zero-cost mode
  if (opts?.zeroCostVideo) {
    for (const cls of classifications) {
      for (const sv of cls.subVisuals) {
        if (sv.visualType === 'AI_ILLUSTRATION') {
          const seg = segments.find((s) => s.segmentId === cls.segmentId);
          sv.visualType = 'TEXT_CARD';
          sv.metadata = { headline: seg?.text.slice(0, 60) ?? podcastTitle, bullets: [] };
          sv.prompt = null;
          sv.endStatePrompt = null;
        }
      }
    }
  }

  classifications.sort((a, b) => a.order - b.order);

  return {
    classifications,
    transitionRecommendations: parsed.transitionRecommendations ?? [],
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    model: result.model,
  };
}
