/**
 * Visual classifier — single AI call to classify all segments in a podcast
 * with visual types and generation metadata for video production.
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
  | 'MAP_OVERLAY';

export interface ClassifiedSegment {
  segmentId: string;
  order: number;
  visualType: VisualTypeString;
  prompt: string | null;
  metadata: Record<string, unknown> | null;
  endStatePrompt: string | null;
}

const classificationItemSchema = z.object({
  order: z.number(),
  visualType: z.enum([
    'AI_ILLUSTRATION',
    'STOCK_FOOTAGE',
    'DATA_CHART',
    'QUOTE',
    'COMPARISON',
    'TIMELINE',
    'DIAGRAM',
    'TEXT_CARD',
    'MAP_OVERLAY',
  ]),
  prompt: z.string().nullable(),
  metadata: z.union([z.record(z.unknown()), z.string(), z.null()]),
  endStatePrompt: z.string().nullable().optional(),
});

const classificationSchema = z.object({
  segments: z.array(classificationItemSchema),
});

const SYSTEM_PROMPT = `You are a video producer. Given podcast segments, assign each one a visual type for a video overlay.

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

RULES:
1. Every segment gets exactly one visual type.
2. Ensure visual variety — don't assign the same type to more than 3 consecutive segments.
3. Use AI_ILLUSTRATION for vivid narrative moments, abstract concepts, and scene-setting.
4. Use STOCK_FOOTAGE for real-world topics (nature, cities, technology in action).
5. Use DATA_CHART when numbers, statistics, or trends are discussed.
6. Use QUOTE when a notable quote or key statement is highlighted.
7. Use TEXT_CARD as a general fallback for explanatory content.
8. Never generate likenesses of real, identifiable people in AI_ILLUSTRATION prompts.
9. For AI_ILLUSTRATION and STOCK_FOOTAGE segments, also provide "endStatePrompt": a description of how the scene should look AFTER the narration concludes — the final visual state. This should differ meaningfully from the opening prompt (e.g., if the prompt shows a city at dawn, the endStatePrompt might show it at midday with bustling activity). For other visual types, set endStatePrompt to null.

Return JSON: { "segments": [{ "order": number, "visualType": string, "prompt": string|null, "metadata": string|null, "endStatePrompt": string|null }] }
For metadata, return a JSON-encoded string (e.g. "{\"chartType\":\"bar\",\"title\":\"Revenue\"}"), not a raw object. Return null if no metadata is needed.`;

export async function classifySegmentVisuals(
  segments: SegmentInput[],
  podcastTitle: string,
  podcastTopic: string,
  opts?: { provider?: string; model?: string; apiKeyOverride?: string },
): Promise<{ classifications: ClassifiedSegment[]; inputTokens: number; outputTokens: number; model: string }> {
  const segmentList = segments
    .map((s) => `[${s.order}] ${s.speaker}: ${s.text.slice(0, 500)}${s.text.length > 500 ? '...' : ''} (${s.duration.toFixed(1)}s)`)
    .join('\n');

  const userMessage = `Podcast: "${podcastTitle}"
Topic: ${podcastTopic}

Segments:
${segmentList}

Classify each segment with a visual type. Return JSON only.`;

  const ai = createAIProvider(opts?.provider);
  const result = await ai.generateResponse(
    SYSTEM_PROMPT,
    [{ role: 'user', content: userMessage }],
    {
      maxTokens: 4096,
      model: opts?.model,
      apiKeyOverride: opts?.apiKeyOverride,
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
                  visualType: { type: 'string' },
                  prompt: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                  metadata: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                  endStatePrompt: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                },
                required: ['order', 'visualType', 'prompt', 'metadata', 'endStatePrompt'],
              },
            },
          },
          required: ['segments'],
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
        visualType: 'TEXT_CARD' as const,
        prompt: null,
        metadata: { headline: podcastTitle, bullets: [s.text.slice(0, 200)] },
        endStatePrompt: null,
      })),
    };
  }

  // Map classified segments back to segment IDs, parsing stringified metadata
  const orderToId = new Map(segments.map((s) => [s.order, s.segmentId]));
  const classifications: ClassifiedSegment[] = parsed.segments
    .filter((c) => orderToId.has(c.order))
    .map((c) => {
      let metadata: Record<string, unknown> | null = null;
      if (typeof c.metadata === 'string') {
        try { metadata = JSON.parse(c.metadata); } catch { metadata = null; }
      } else if (c.metadata && typeof c.metadata === 'object') {
        metadata = c.metadata as Record<string, unknown>;
      }
      return {
        segmentId: orderToId.get(c.order)!,
        order: c.order,
        visualType: c.visualType,
        prompt: c.prompt,
        metadata,
        endStatePrompt: c.endStatePrompt ?? null,
      };
    });

  // Fill in any segments that Claude missed
  for (const seg of segments) {
    if (!classifications.find((c) => c.segmentId === seg.segmentId)) {
      classifications.push({
        segmentId: seg.segmentId,
        order: seg.order,
        visualType: 'TEXT_CARD',
        prompt: null,
        metadata: { headline: podcastTitle, bullets: [seg.text.slice(0, 200)] },
        endStatePrompt: null,
      });
    }
  }

  classifications.sort((a, b) => a.order - b.order);

  return {
    classifications,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    model: result.model,
  };
}
