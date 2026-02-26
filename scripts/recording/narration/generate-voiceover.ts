/* eslint-disable no-console */
/**
 * Generate voiceover audio segments using Hume TTS (Vince Douglas voice).
 *
 * For each narration segment, calls the Hume API to generate speech,
 * saves as individual MP3 files named by flow and segment index.
 *
 * Rate limiting: 6-second delay between API calls with exponential backoff retry.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { FlowNarration, NarrationSegment } from './scripts';

// Vince Douglas — confident presenter, chosen for marketing narration
const VINCE_DOUGLAS_VOICE_ID = 'ee96fb5f-ec1a-4f41-a9ba-6d119e64c8fd';

interface HumeTtsResponse {
  generations: Array<{
    audio: string; // base64-encoded audio
    duration: number;
    file_type: string;
    snippet_id: string;
  }>;
}

const MAX_RETRIES = 4;
const BASE_DELAY_MS = 6000;

async function generateSegment(
  text: string,
  apiKey: string
): Promise<{ audioBase64: string; durationSec: number }> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch('https://api.hume.ai/v0/tts', {
      method: 'POST',
      headers: {
        'X-Hume-Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        utterances: [{
          text,
          description: 'Confident, warm, professional narrator. Clear and engaging.',
          voice: { provider: 'HUME_AI', id: VINCE_DOUGLAS_VOICE_ID },
        }],
        format: { type: 'mp3' },
      }),
    });

    if (response.status === 429) {
      if (attempt === MAX_RETRIES) {
        throw new Error('Hume TTS rate limit exceeded after all retries');
      }
      const backoff = BASE_DELAY_MS * Math.pow(2, attempt);
      console.log(`    Rate limited — retrying in ${(backoff / 1000).toFixed(0)}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await sleep(backoff);
      continue;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Hume TTS failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as HumeTtsResponse;
    if (!data.generations || data.generations.length === 0) {
      throw new Error('Hume TTS returned no generations');
    }

    return {
      audioBase64: data.generations[0].audio,
      durationSec: data.generations[0].duration,
    };
  }

  throw new Error('Unreachable');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface VoiceoverResult {
  flowName: string;
  segments: Array<{
    index: number;
    startAt: number;
    text: string;
    audioPath: string;
    durationSec: number;
  }>;
}

export async function generateFlowVoiceover(
  narration: FlowNarration,
  outputDir: string,
  apiKey: string
): Promise<VoiceoverResult> {
  const flowDir = path.join(outputDir, narration.flowName);
  fs.mkdirSync(flowDir, { recursive: true });

  const result: VoiceoverResult = {
    flowName: narration.flowName,
    segments: [],
  };

  for (let i = 0; i < narration.segments.length; i++) {
    const segment: NarrationSegment = narration.segments[i];
    const audioPath = path.join(flowDir, `segment-${String(i).padStart(2, '0')}.mp3`);

    // Skip if already generated (idempotent)
    if (fs.existsSync(audioPath)) {
      // Get duration from existing file via ffprobe
      const { execFileSync } = await import('child_process');
      const durStr = execFileSync('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'csv=p=0',
        audioPath,
      ]).toString().trim();

      console.log(`  [${narration.flowName}] Segment ${i} — cached (${durStr}s)`);
      result.segments.push({
        index: i,
        startAt: segment.startAt,
        text: segment.text,
        audioPath,
        durationSec: parseFloat(durStr),
      });
      continue;
    }

    console.log(`  [${narration.flowName}] Segment ${i} @ ${segment.startAt}s: "${segment.text}"`);

    const { audioBase64, durationSec } = await generateSegment(segment.text, apiKey);

    // Write audio file
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    fs.writeFileSync(audioPath, audioBuffer);

    console.log(`    → ${audioPath} (${durationSec.toFixed(2)}s)`);

    result.segments.push({
      index: i,
      startAt: segment.startAt,
      text: segment.text,
      audioPath,
      durationSec,
    });

    // Rate limit: wait between API calls
    if (i < narration.segments.length - 1) {
      await sleep(BASE_DELAY_MS);
    }
  }

  return result;
}
