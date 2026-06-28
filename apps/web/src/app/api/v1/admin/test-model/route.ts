import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { z } from 'zod';
import { createAIProvider } from '@/lib/providers/ai';
import { createTtsProviderAsync } from '@/lib/providers/tts';
import { createSttProvider } from '@/lib/providers/stt';
import { getProviderIds, type TtsProviderId } from '@/lib/providers/tts-registry';
import type { SttProviderId } from '@/lib/providers/stt-registry';
import type { AiProviderId } from '@/lib/providers/ai-registry';
import { getAiKey, getByokKey } from '@/lib/byok';
import { logUsage } from '@/lib/usage-logger';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { BRAND } from '@sotto/shared';
import { getTestVoiceId } from '@/lib/providers/tts-voices';
import { getPlatformTtsKey } from '@/lib/tts-generation';

const requestSchema = z.object({
  type: z.enum(['ai', 'tts', 'stt']),
  provider: z.string().min(1),
  model: z.string().min(1),
  keySource: z.enum(['platform', 'byok']).default('platform'),
});

// Voice IDs and platform keys are derived from the registry — no manual updates needed.
// See: getTestVoiceId() in tts-voices.ts, getPlatformTtsKey() in tts-generation.ts

function getSttPlatformKey(provider: string): string | undefined {
  switch (provider) {
    case 'openai':
      return process.env.OPENAI_API_KEY;
    case 'elevenlabs':
      return process.env.ELEVENLABS_API_KEY;
    case 'together':
      return process.env.TOGETHER_API_KEY;
    case 'deepgram':
      return process.env.DEEPGRAM_API_KEY;
    case 'assemblyai':
      return process.env.ASSEMBLYAI_API_KEY;
    case 'local':
      return process.env.STT_API_KEY?.trim() || 'local';
    default:
      return undefined;
  }
}

/**
 * Generate real "Hello" audio from the first available TTS provider.
 * Tries providers in order: cheapest/fastest first.
 * Returns null if no TTS provider is available.
 */
/** All TTS providers. Auto-populated from registry. */
const TTS_PROBE_ORDER: TtsProviderId[] = getProviderIds();

async function generateTestAudio(): Promise<{ audio: Buffer; provider: string } | null> {
  for (const id of TTS_PROBE_ORDER) {
    const apiKey = getPlatformTtsKey(id);
    if (!apiKey) continue;

    try {
      const tts = await createTtsProviderAsync(id, apiKey);
      const voiceId = getTestVoiceId(id);
      const audio = await withTimeout(
        tts.generateSpeech({ text: `${BRAND.name} — ${BRAND.tagline}`, voiceId }),
        5_000
      );
      return { audio, provider: id };
    } catch {
      // Provider failed — try next
    }
  }
  return null;
}

/** Detect audio MIME type from buffer magic bytes. */
function detectAudioMime(buf: Buffer): string {
  if (buf.length < 4) return 'audio/mpeg';
  // WAV: RIFF header
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return 'audio/wav';
  // OGG: OggS header
  if (buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) return 'audio/ogg';
  // FLAC: fLaC header
  if (buf[0] === 0x66 && buf[1] === 0x4c && buf[2] === 0x61 && buf[3] === 0x43) return 'audio/flac';
  // MP3: ID3 tag or sync word
  if (
    (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) ||
    (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)
  )
    return 'audio/mpeg';
  return 'audio/mpeg';
}

function classifyError(error: Error): string {
  const msg = error.message;
  const lower = msg.toLowerCase();

  if (msg === 'timeout' || lower.includes('timed out') || error.name === 'AbortError') {
    return 'Timed out';
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
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

export async function POST(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json();
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    logger.warn('test-model validation failed', { body, issues: parsed.error.issues });
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { type, provider, model, keySource } = parsed.data;
  const start = Date.now();

  try {
    if (type === 'ai') {
      let apiKeyOverride: string | undefined;

      if (keySource === 'byok') {
        const keyData = await getAiKey(adminId, provider as AiProviderId);
        if (!keyData) {
          return NextResponse.json({
            success: false,
            latencyMs: Date.now() - start,
            error: 'BYOK key not found for this provider',
          });
        }
        apiKeyOverride = keyData.apiKey;
      }

      const aiProvider = createAIProvider(provider);
      const timeoutMs = provider === 'claude-code' || provider === 'codex' ? 60_000 : 15_000;
      const result = await withTimeout(
        aiProvider.generateResponse('', [{ role: 'user', content: 'Say hello in one word.' }], {
          model,
          maxTokens: 20,
          skipModeration: true,
          apiKeyOverride,
        }),
        timeoutMs
      );
      logUsage({
        service: provider,
        model: result.model,
        category: 'admin_test',
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        userId: adminId,
      });
      return NextResponse.json({
        success: true,
        latencyMs: Date.now() - start,
        response: result.content.slice(0, 60),
      });
    }

    if (type === 'tts') {
      let apiKey: string | undefined;

      if (keySource === 'byok') {
        const key = await getByokKey(adminId, provider as TtsProviderId);
        if (!key) {
          return NextResponse.json({
            success: false,
            latencyMs: Date.now() - start,
            error: 'BYOK key not found for this provider',
          });
        }
        apiKey = key;
      } else {
        apiKey = getPlatformTtsKey(provider as TtsProviderId);

        if (!apiKey) {
          return NextResponse.json({
            success: false,
            latencyMs: Date.now() - start,
            error: 'Platform API key not configured (check .env)',
          });
        }
      }

      const voiceId = getTestVoiceId(provider as TtsProviderId);
      const ttsProvider = await createTtsProviderAsync(
        provider as TtsProviderId,
        apiKey,
        undefined,
        model
      );

      const audioBuffer = await withTimeout(
        ttsProvider.generateSpeech({ text: `${BRAND.name} — ${BRAND.tagline}`, voiceId }),
        30_000
      );

      const base64 = audioBuffer.toString('base64');
      const mime = detectAudioMime(audioBuffer);
      return NextResponse.json({
        success: true,
        latencyMs: Date.now() - start,
        audioData: `data:${mime};base64,${base64}`,
      });
    }

    if (type === 'stt') {
      let sttKey: string | undefined;

      if (keySource === 'byok') {
        if (provider === 'local') {
          sttKey = process.env.STT_API_KEY?.trim() || 'local';
        } else if (
          provider === 'openai' ||
          provider === 'together' ||
          provider === 'deepgram' ||
          provider === 'assemblyai'
        ) {
          const keyData = await getAiKey(adminId, provider as AiProviderId);
          if (!keyData) {
            return NextResponse.json({
              success: false,
              latencyMs: Date.now() - start,
              error: 'BYOK key not found for this provider',
            });
          }
          sttKey = keyData.apiKey;
        } else if (provider === 'elevenlabs') {
          const key = await getByokKey(adminId, 'elevenlabs');
          if (!key) {
            return NextResponse.json({
              success: false,
              latencyMs: Date.now() - start,
              error: 'BYOK key not found for this provider',
            });
          }
          sttKey = key;
        }
      } else {
        sttKey = getSttPlatformKey(provider);
        if (!sttKey) {
          return NextResponse.json({
            success: false,
            latencyMs: Date.now() - start,
            error: 'Platform API key not configured (check .env)',
          });
        }
      }

      const sttProvider = createSttProvider(provider as SttProviderId, sttKey!, model);

      // Generate real "Hello" audio from the first available TTS provider
      const testAudio = await generateTestAudio();
      const audioBuffer = testAudio?.audio;
      const ttsSource = testAudio?.provider;

      if (!audioBuffer) {
        return NextResponse.json({
          success: false,
          latencyMs: Date.now() - start,
          error: 'No TTS provider available to generate test audio',
        });
      }

      const result = await withTimeout(sttProvider.transcribe(audioBuffer), 15_000);
      return NextResponse.json({
        success: true,
        latencyMs: Date.now() - start,
        transcript: result.text || '(empty transcript)',
        ttsSource,
      });
    }

    return errorResponse('Invalid type', 400);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return NextResponse.json({
      success: false,
      latencyMs: Date.now() - start,
      error: classifyError(err),
    });
  }
}
