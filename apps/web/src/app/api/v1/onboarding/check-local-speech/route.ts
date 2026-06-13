import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { DEFAULT_LOCAL_STT_BASE_URL, DEFAULT_LOCAL_TTS_BASE_URL } from '@/app/welcome/providerMap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHECK_TIMEOUT_MS = 8000;
const LOCAL_TTS_PROVIDERS = new Set(['kokoro', 'local']);
const LOCAL_STT_PROVIDERS = new Set(['whisper', 'local']);

const checkLocalSpeechSchema = z.object({
  tts: z.object({
    provider: z.string().trim().max(64),
    baseUrl: z.string().trim().max(512).optional(),
  }),
  stt: z.object({
    provider: z.string().trim().max(64),
    baseUrl: z.string().trim().max(512).optional(),
  }),
});

interface CheckResult {
  id: 'tts' | 'stt';
  label: string;
  url: string;
  ok: boolean;
  detail: string;
}

function endpointBase(raw: string | undefined, fallback: string): string {
  const value = (raw ?? '').trim() || fallback;
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Endpoint must use http or https.');
  }
  return url.toString().replace(/\/+$/, '');
}

function endpoint(base: string, path: string): string {
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

async function snippet(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  return text.trim().slice(0, 160);
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
}

function silentWav(): ArrayBuffer {
  const sampleRate = 16_000;
  const seconds = 0.6;
  const sampleCount = Math.floor(sampleRate * seconds);
  const dataSize = sampleCount * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset: number, value: string) {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  return buffer;
}

async function checkTts(baseUrl: string): Promise<CheckResult> {
  const label = 'Text to speech';

  try {
    const health = await fetchWithTimeout(endpoint(baseUrl, '/health'));
    if (!health.ok) {
      return {
        id: 'tts',
        label,
        url: baseUrl,
        ok: false,
        detail: `/health returned ${health.status}: ${await snippet(health)}`,
      };
    }

    const voices = await fetchWithTimeout(endpoint(baseUrl, '/voices'));
    if (!voices.ok) {
      return {
        id: 'tts',
        label,
        url: baseUrl,
        ok: false,
        detail: `/voices returned ${voices.status}: ${await snippet(voices)}`,
      };
    }

    const data = (await voices.json().catch(() => null)) as {
      voices?: Array<{ id?: unknown }>;
    } | null;
    const voiceId = data?.voices?.find((voice) => typeof voice.id === 'string')?.id;
    if (!voiceId) {
      return {
        id: 'tts',
        label,
        url: baseUrl,
        ok: false,
        detail: '/voices did not return any usable voice ids.',
      };
    }

    const speech = await fetchWithTimeout(endpoint(baseUrl, '/tts'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Sotto local speech check.', voice: voiceId, language: 'en' }),
    });
    if (!speech.ok) {
      return {
        id: 'tts',
        label,
        url: baseUrl,
        ok: false,
        detail: `/tts returned ${speech.status}: ${await snippet(speech)}`,
      };
    }

    const bytes = await speech.arrayBuffer();
    return {
      id: 'tts',
      label,
      url: baseUrl,
      ok: bytes.byteLength > 0,
      detail:
        bytes.byteLength > 0
          ? 'Ready: /health, /voices, and /tts passed.'
          : '/tts returned empty audio.',
    };
  } catch (error: unknown) {
    return {
      id: 'tts',
      label,
      url: baseUrl,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkStt(baseUrl: string): Promise<CheckResult> {
  const label = 'Speech to text';
  const path = new URL(baseUrl).pathname.replace(/\/+$/, '');
  if (!path.endsWith('/v1')) {
    return {
      id: 'stt',
      label,
      url: baseUrl,
      ok: false,
      detail: 'Use an OpenAI-compatible base URL that includes /v1.',
    };
  }

  try {
    const body = new FormData();
    body.append('model', 'whisper-1');
    body.append('response_format', 'json');
    body.append('file', new Blob([silentWav()], { type: 'audio/wav' }), 'sotto-check.wav');

    const response = await fetchWithTimeout(endpoint(baseUrl, '/audio/transcriptions'), {
      method: 'POST',
      body,
    });

    if (!response.ok) {
      return {
        id: 'stt',
        label,
        url: baseUrl,
        ok: false,
        detail: `/audio/transcriptions returned ${response.status}: ${await snippet(response)}`,
      };
    }

    return {
      id: 'stt',
      label,
      url: baseUrl,
      ok: true,
      detail: 'Ready: /audio/transcriptions accepted a test WAV.',
    };
  } catch (error: unknown) {
    return {
      id: 'stt',
      label,
      url: baseUrl,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function POST(request: NextRequest) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);

    const parsed = checkLocalSpeechSchema.safeParse(await request.json());
    if (!parsed.success) return errorResponse(parsed.error.issues[0].message, 400);

    const checks: CheckResult[] = [];
    const { tts, stt } = parsed.data;

    if (LOCAL_TTS_PROVIDERS.has(tts.provider)) {
      checks.push(await checkTts(endpointBase(tts.baseUrl, DEFAULT_LOCAL_TTS_BASE_URL)));
    }

    if (LOCAL_STT_PROVIDERS.has(stt.provider)) {
      checks.push(await checkStt(endpointBase(stt.baseUrl, DEFAULT_LOCAL_STT_BASE_URL)));
    }

    return NextResponse.json({
      ok: checks.every((check) => check.ok),
      checks,
    });
  } catch (error: unknown) {
    logger.error('Failed to check local speech endpoints', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to check local speech endpoints', 500);
  }
}
