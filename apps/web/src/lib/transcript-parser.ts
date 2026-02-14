import { generateResponse } from './claude';
import { logger } from './logger';
import type { TranscriptionResult } from './providers/stt';

/**
 * Parsed segment with speaker diarization
 */
export interface ParsedSegment {
  speaker: 'HOST' | 'EXPERT';
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
export async function diarizeSpeakers(
  segments: TranscriptionResult['segments'],
  apiKeyOverride?: string
): Promise<ParsedSegment[]> {
  if (segments.length === 0) {
    return [];
  }

  logger.info('Running speaker diarization via Claude', { segments: String(segments.length) });

  const transcriptText = segments.map((s, i) => `[${i}] ${s.text}`).join('\n');

  const systemPrompt = `You are a speaker diarization assistant for Sotto podcasts. You will receive a transcript where segments are numbered [0], [1], etc. Your task is to identify two speakers (HOST and EXPERT) and assign each segment to one of them.

Rules:
1. The HOST typically introduces topics, asks questions, and guides the conversation
2. The EXPERT typically provides answers, explanations, and expert knowledge
3. You MUST assign each segment to either HOST or EXPERT
4. Return ONLY a JSON array of speaker assignments, one per line: [{"index": 0, "speaker": "HOST"}, {"index": 1, "speaker": "EXPERT"}, ...]
5. Do NOT include any explanation or markdown formatting, just the raw JSON array`;

  const userPrompt = `Transcript segments:\n${transcriptText}\n\nAssign each segment index to either HOST or EXPERT as a JSON array.`;

  const response = await generateResponse(systemPrompt, [{ role: 'user', content: userPrompt }], {
    maxTokens: 4096,
    apiKeyOverride,
  });

  const jsonMatch = response.content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    logger.error('Failed to parse speaker assignments from Claude', {
      response: response.content.slice(0, 200),
    });
    throw new Error('Failed to parse speaker assignments');
  }

  const assignments = JSON.parse(jsonMatch[0]) as Array<{ index: number; speaker: string }>;

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
