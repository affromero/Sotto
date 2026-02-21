import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { z } from 'zod';
import { createAIProvider } from '@/lib/providers/ai';
import { createTtsProviderAsync } from '@/lib/providers/tts';
import { createSttProvider } from '@/lib/providers/stt';
import type { TtsProviderId } from '@/lib/providers/tts-registry';
import type { SttProviderId } from '@/lib/providers/stt-registry';
import {
  PLAYHT_VOICE_POOL,
  CARTESIA_VOICE_POOL,
  HUME_VOICE_POOL,
  FAL_VOICE_POOL,
} from '@/lib/providers/tts-voices';

const requestSchema = z.object({
  type: z.enum(['ai', 'tts', 'stt']),
  provider: z.string().min(1),
  model: z.string().min(1),
});

// Stable test voice per TTS provider
const TTS_TEST_VOICES: Record<string, string> = {
  elevenlabs: '21m00Tcm4TlvDq8ikWAM', // Rachel — stable free voice
  openai: 'alloy',
  playht: PLAYHT_VOICE_POOL[0].id,
  cartesia: CARTESIA_VOICE_POOL[0].id,
  hume: HUME_VOICE_POOL[0].id,
  fal: FAL_VOICE_POOL[0].id,
  replicate: FAL_VOICE_POOL[0].id,
  kittentts: 'bella',
};

function getTtsPlatformKey(provider: string): {
  apiKey?: string;
  extraData?: Record<string, string>;
} {
  switch (provider) {
    case 'elevenlabs':
      return { apiKey: process.env.ELEVENLABS_API_KEY };
    case 'openai':
      return { apiKey: process.env.OPENAI_API_KEY };
    case 'playht':
      return {
        apiKey: process.env.PLAYHT_API_KEY,
        extraData: process.env.PLAYHT_USER_ID
          ? { userId: process.env.PLAYHT_USER_ID }
          : undefined,
      };
    case 'cartesia':
      return { apiKey: process.env.CARTESIA_API_KEY };
    case 'hume':
      return { apiKey: process.env.HUME_API_KEY };
    case 'fal':
      return { apiKey: process.env.FAL_KEY };
    case 'replicate':
      return { apiKey: process.env.REPLICATE_API_TOKEN };
    case 'kittentts':
      return {}; // No key — sidecar at KITTENTTS_URL
    default:
      return {};
  }
}

function getSttPlatformKey(provider: string): string | undefined {
  switch (provider) {
    case 'openai':
      return process.env.OPENAI_API_KEY;
    case 'groq':
      return process.env.GROQ_API_KEY;
    case 'elevenlabs':
      return process.env.ELEVENLABS_API_KEY;
    default:
      return undefined;
  }
}

/** Minimal WAV: 44-byte header + 0.1s of silence (8 kHz, 16-bit, mono) */
function createSilenceWav(): Buffer {
  const sampleRate = 8000;
  const numSamples = 800; // 0.1s × 8000 Hz
  const dataSize = numSamples * 2; // 16-bit = 2 bytes/sample
  const buf = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  // Remaining bytes are zero (silence)
  return buf;
}

function classifyError(error: Error): string {
  const msg = error.message;
  const lower = msg.toLowerCase();

  if (msg === 'timeout' || lower.includes('timed out') || error.name === 'AbortError') {
    return 'Timed out after 15s';
  }
  if (
    lower.includes('not configured') ||
    lower.includes('api key not') ||
    lower.includes('no api key') ||
    lower.includes('is not set') ||
    lower.includes('requires an api key') ||
    lower.includes('not initialized') ||
    lower.includes('no elevenlabs api key')
  ) {
    return 'Platform API key not configured (check .env)';
  }
  if (
    lower.includes('401') ||
    lower.includes('unauthorized') ||
    lower.includes('authentication failed') ||
    lower.includes('invalid api key') ||
    lower.includes('invalid_api_key') ||
    lower.includes('403') ||
    lower.includes('forbidden')
  ) {
    return 'Authentication failed — check API key';
  }
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('rate-limit')) {
    return 'Rate limited by provider';
  }
  if (
    lower.includes('econnrefused') ||
    lower.includes('fetch failed') ||
    lower.includes('enotfound') ||
    lower.includes('network error') ||
    lower.includes('socket')
  ) {
    return `Network error: ${msg}`;
  }
  return msg;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms)
    ),
  ]);
}

export async function POST(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { type, provider, model } = parsed.data;
  const start = Date.now();

  try {
    if (type === 'ai') {
      const aiProvider = createAIProvider(provider);
      const result = await withTimeout(
        aiProvider.generateResponse('', [{ role: 'user', content: 'Say hello in one word.' }], {
          model,
          maxTokens: 20,
          skipModeration: true,
        }),
        15_000
      );
      return NextResponse.json({
        success: true,
        latencyMs: Date.now() - start,
        response: result.content.slice(0, 60),
      });
    }

    if (type === 'tts') {
      const { apiKey, extraData } = getTtsPlatformKey(provider);

      if (provider === 'kittentts') {
        if (!process.env.KITTENTTS_URL) {
          return NextResponse.json({
            success: false,
            latencyMs: Date.now() - start,
            error: 'Platform API key not configured (check .env)',
          });
        }
      } else if (provider === 'playht') {
        if (!apiKey || !extraData?.userId) {
          return NextResponse.json({
            success: false,
            latencyMs: Date.now() - start,
            error: 'Platform API key not configured (check .env)',
          });
        }
      } else if (!apiKey) {
        return NextResponse.json({
          success: false,
          latencyMs: Date.now() - start,
          error: 'Platform API key not configured (check .env)',
        });
      }

      const voiceId = TTS_TEST_VOICES[provider] ?? 'alloy';
      const ttsProvider = await createTtsProviderAsync(
        provider as TtsProviderId,
        apiKey,
        extraData,
        model
      );

      const audioBuffer = await withTimeout(
        ttsProvider.generateSpeech({ text: 'Hello.', voiceId }),
        15_000
      );

      const base64 = audioBuffer.toString('base64');
      return NextResponse.json({
        success: true,
        latencyMs: Date.now() - start,
        audioData: `data:audio/mpeg;base64,${base64}`,
      });
    }

    if (type === 'stt') {
      const platformKey = getSttPlatformKey(provider);
      if (!platformKey) {
        return NextResponse.json({
          success: false,
          latencyMs: Date.now() - start,
          error: 'Platform API key not configured (check .env)',
        });
      }

      const sttProvider = createSttProvider(provider as SttProviderId, platformKey, model);
      const wavBuffer = createSilenceWav();
      const result = await withTimeout(sttProvider.transcribe(wavBuffer), 15_000);
      return NextResponse.json({
        success: true,
        latencyMs: Date.now() - start,
        transcript: result.text || '(silence — API reachable)',
      });
    }

    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return NextResponse.json({
      success: false,
      latencyMs: Date.now() - start,
      error: classifyError(err),
    });
  }
}
