import { generateResponse } from './llm';
import { loadPrompt } from './prompt-loader';
import { logUsage } from './usage-logger';
import { logger } from './logger';
import type { TranscriptionResult } from './providers/stt';

const DIARIZATION_SYSTEM_PROMPT = loadPrompt('import/transcript-diarization.md');

/**
 * Parsed segment with speaker diarization
 */
export interface ParsedSegment {
  speaker: string;
  text: string;
  startTime?: number;
  endTime?: number;
  order: number;
}

/**
 * Parse transcript text in SRT, VTT, or plain text format
 * Returns segments with timestamps if available
 */
export async function parseTranscript(
  text: string,
  format?: 'srt' | 'vtt' | 'text'
): Promise<ParsedSegment[]> {
  const detectedFormat = format ?? detectFormat(text);

  logger.info('Parsing transcript', { format: detectedFormat });

  switch (detectedFormat) {
    case 'srt':
      return parseSrt(text);
    case 'vtt':
      return parseVtt(text);
    case 'text':
    default:
      return parseText(text);
  }
}

/**
 * Auto-detect transcript format
 */
function detectFormat(text: string): 'srt' | 'vtt' | 'text' {
  const trimmed = text.trim();

  if (trimmed.startsWith('WEBVTT')) {
    return 'vtt';
  }

  if (/^\d+\s*\n\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/m.test(trimmed)) {
    return 'srt';
  }

  return 'text';
}

/**
 * Parse SRT format
 * Format:
 * 1
 * 00:00:00,000 --> 00:00:05,000
 * Text here
 *
 * 2
 * 00:00:05,000 --> 00:00:10,000
 * More text
 */
function parseSrt(text: string): ParsedSegment[] {
  const blocks = text.split(/\n\s*\n/).filter((b) => b.trim());
  const segments: ParsedSegment[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i].split('\n').filter((l) => l.trim());
    if (lines.length < 3) continue;

    const timestampLine = lines[1];
    const match = timestampLine.match(
      /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/
    );

    if (!match) continue;

    const startTime =
      parseInt(match[1]) * 3600 +
      parseInt(match[2]) * 60 +
      parseInt(match[3]) +
      parseInt(match[4]) / 1000;
    const endTime =
      parseInt(match[5]) * 3600 +
      parseInt(match[6]) * 60 +
      parseInt(match[7]) +
      parseInt(match[8]) / 1000;

    const textContent = lines.slice(2).join(' ').trim();

    segments.push({
      speaker: 'HOST',
      text: textContent,
      startTime,
      endTime,
      order: i,
    });
  }

  logger.info('Parsed SRT transcript', { segments: String(segments.length) });
  return segments;
}

/**
 * Parse VTT format
 * Format:
 * WEBVTT
 *
 * 00:00:00.000 --> 00:00:05.000
 * Text here
 *
 * 00:00:05.000 --> 00:00:10.000
 * More text
 */
function parseVtt(text: string): ParsedSegment[] {
  const lines = text.split('\n');
  const segments: ParsedSegment[] = [];
  let order = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(
      /(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/
    );

    if (!match) continue;

    const startTime =
      parseInt(match[1]) * 3600 +
      parseInt(match[2]) * 60 +
      parseInt(match[3]) +
      parseInt(match[4]) / 1000;
    const endTime =
      parseInt(match[5]) * 3600 +
      parseInt(match[6]) * 60 +
      parseInt(match[7]) +
      parseInt(match[8]) / 1000;

    const textLines: string[] = [];
    for (let j = i + 1; j < lines.length && lines[j].trim(); j++) {
      textLines.push(lines[j].trim());
    }

    segments.push({
      speaker: 'HOST',
      text: textLines.join(' '),
      startTime,
      endTime,
      order: order++,
    });
  }

  logger.info('Parsed VTT transcript', { segments: String(segments.length) });
  return segments;
}

/**
 * Parse plain text format
 * Split by paragraphs (double newlines) or sentences
 */
function parseText(text: string): ParsedSegment[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const segments = paragraphs.map((para, i) => ({
    speaker: 'HOST' as const,
    text: para,
    order: i,
  }));

  logger.info('Parsed plain text transcript', { segments: String(segments.length) });
  return segments;
}

/**
 * Use Claude to assign HOST/EXPERT roles to transcript segments
 * Whisper doesn't provide speaker diarization, so we use LLM for this
 */
function extractFirstJsonArray(text: string): string {
  const trimmed = text.trim();
  try { JSON.parse(trimmed); return trimmed; } catch {}
  const start = text.indexOf('[');
  if (start === -1) throw new Error('No JSON array found in response');
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '[') depth++;
    if (ch === ']' && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error('Unbalanced JSON in response');
}

export async function diarizeSpeakers(
  segments: TranscriptionResult['segments'],
  apiKeyOverride?: string
): Promise<ParsedSegment[]> {
  if (segments.length === 0) {
    return [];
  }

  logger.info('Running speaker diarization via Claude', { segments: String(segments.length) });

  const transcriptText = segments.map((s, i) => `[${i}] ${s.text}`).join('\n');

  const userPrompt = `Transcript segments:\n${transcriptText}\n\nAssign each segment index to either HOST or EXPERT as a JSON array.`;

  const response = await generateResponse(DIARIZATION_SYSTEM_PROMPT, [{ role: 'user', content: userPrompt }], {
    maxTokens: 4096,
    apiKeyOverride,
  });

  logUsage({
    service: 'anthropic',
    model: response.model,
    category: 'diarization',
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    metadata: { segmentCount: segments.length },
  });

  let assignments: Array<{ index: number; speaker: string }>;
  try {
    assignments = JSON.parse(extractFirstJsonArray(response.content));
  } catch {
    logger.error('Failed to parse speaker assignments from Claude', {
      response: response.content.slice(0, 200),
    });
    throw new Error('Failed to parse speaker assignments');
  }

  const parsedSegments: ParsedSegment[] = segments.map((seg, i) => {
    const assignment = assignments.find((a) => a.index === i);
    const speaker = assignment?.speaker === 'EXPERT' ? 'EXPERT' : 'HOST';

    return {
      speaker,
      text: seg.text,
      startTime: seg.start,
      endTime: seg.end,
      order: i,
    };
  });

  const hostCount = parsedSegments.filter((s) => s.speaker === 'HOST').length;
  const expertCount = parsedSegments.filter((s) => s.speaker === 'EXPERT').length;

  logger.info('Speaker diarization complete', {
    totalSegments: String(parsedSegments.length),
    hostSegments: String(hostCount),
    expertSegments: String(expertCount),
  });

  return parsedSegments;
}
