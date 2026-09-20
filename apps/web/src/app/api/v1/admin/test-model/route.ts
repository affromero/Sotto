import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { z } from 'zod';
import { createAIProvider } from '@/lib/providers/ai';
import { createSttProvider, sttProviderRules } from '@/lib/providers/stt';
import { getProviderIds, type TtsProviderId } from '@/lib/providers/tts-registry';
import type { SttProviderId } from '@/lib/providers/stt-registry';
import type { AiProviderId } from '@/lib/providers/ai-registry';
import { authenticateRequest } from '@/lib/api-keys';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import {
  captureSottoExecutionCredential,
  sottoExecutionCredentialFields,
} from '@/lib/sidedoor/credentials/runtime/credential-execution';
import {
  createSottoProviderTransport,
  type SottoProviderExecution,
} from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { prismaUnfiltered } from '@/lib/prisma';
import { logUsage } from '@/lib/usage-logger';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { BRAND } from '@sotto/shared';
import { getTestVoiceId } from '@/lib/providers/tts-voices';
import { getServerInfra, infra } from '@/lib/server-config';
import { capturedLearningAiOptions, resolveCapturedLearningAiForProvider } from '@/lib/learning-ai';
import { resolveTtsProvider } from '@/lib/providers/tts';

const requestSchema = z.object({
  type: z.enum(['ai', 'tts', 'stt']),
  provider: z.string().min(1),
  model: z.string().min(1),
});

/**
 * Generate real "Hello" audio from the first available TTS provider.
 * Tries providers in order: cheapest/fastest first.
 * Returns null if no TTS provider is available.
 */
/** All TTS providers. Auto-populated from registry. */
const TTS_PROBE_ORDER: TtsProviderId[] = getProviderIds();

async function generateTestAudio(
  execution: SottoProviderExecution
): Promise<{ audio: Buffer; provider: string } | null> {
  for (const id of TTS_PROBE_ORDER) {
    try {
      const resolved = await resolveTtsProvider({
        userId: execution.userId,
        execution,
        episodeId: 'admin-provider-test',
        requestedProvider: id,
      });
      const tts = resolved.provider;
      const voiceId = getTestVoiceId(id);
      const audio = await withTimeout(
        tts.generateSpeech({
          text: `${BRAND.name}, ${BRAND.tagline}`,
          voiceId,
          signal: AbortSignal.any([
            ...(execution.signal ? [execution.signal] : []),
            AbortSignal.timeout(5_000),
          ]),
        }),
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

  if (
    msg === 'timeout' ||
    lower.includes('timed out') ||
    error.name === 'AbortError' ||
    ('status' in error && error.status === 408)
  ) {
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
    return 'Saved provider credential is not configured';
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
  const deadline = Promise.withResolvers<never>();
  const timer = setTimeout(() => deadline.reject(new Error('timeout')), ms);
  try {
    return await Promise.race([promise, deadline.promise]);
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }
  const original = await authenticateRequest(request);
  if (!original || !original.isOwner || original.userId !== adminId)
    return errorResponse('Forbidden', 403);
  const execution: SottoProviderExecution = {
    userId: adminId,
    signal: request.signal,
    authorize: async (database) => {
      await requireOriginalSottoAdmission(database, request, original);
      return { userId: adminId };
    },
  };

  const body = await request.json();
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    logger.warn('test-model validation failed', { body, issues: parsed.error.issues });
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { type, provider, model } = parsed.data;
  await getServerInfra();
  const start = Date.now();

  try {
    if (type === 'ai') {
      const captured = await resolveCapturedLearningAiForProvider(
        adminId,
        provider as AiProviderId,
        model,
        execution,
        true
      );
      const aiProvider = createAIProvider(provider);
      const timeoutMs = provider === 'claude-code' || provider === 'codex' ? 60_000 : 15_000;
      const result = await withTimeout(
        aiProvider.generateResponse('', [{ role: 'user', content: 'Say hello in one word.' }], {
          ...(await capturedLearningAiOptions(captured)),
          maxTokens: 20,
          skipModeration: true,
        }),
        timeoutMs
      );
      await logUsage({
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
      const voiceId = getTestVoiceId(provider as TtsProviderId);
      const resolved = await resolveTtsProvider({
        userId: adminId,
        execution,
        episodeId: 'admin-provider-test',
        requestedProvider: provider as TtsProviderId,
        requestedModel: model,
      });
      const ttsProvider = resolved.provider;

      const audioBuffer = await withTimeout(
        ttsProvider.generateSpeech({
          text: `${BRAND.name}, ${BRAND.tagline}`,
          voiceId,
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
        }),
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
      const sttProviderId = provider as SttProviderId;
      const saved =
        provider === 'local'
          ? null
          : await sottoTransaction(prismaUnfiltered, (database) =>
              captureSottoExecutionCredential(
                database,
                execution.authorize,
                'stt',
                provider,
                true,
                request.signal
              )
            );
      execution.credential = saved;
      const sttKey =
        provider === 'local'
          ? 'local'
          : saved
            ? sottoExecutionCredentialFields(saved).apiKey
            : undefined;
      if (!sttKey) throw new Error(`No saved credential is available for ${provider}`);
      const sttTransport = await createSottoProviderTransport(
        execution,
        sttProviderRules(sttProviderId, infra('sttBaseUrl'))
      );
      const sttProvider = createSttProvider(sttProviderId, sttKey!, model, sttTransport);

      // Generate real "Hello" audio from the first available TTS provider
      const testAudio = await generateTestAudio(execution);
      const audioBuffer = testAudio?.audio;
      const ttsSource = testAudio?.provider;

      if (!audioBuffer) {
        return NextResponse.json({
          success: false,
          latencyMs: Date.now() - start,
          error: 'No TTS provider available to generate test audio',
        });
      }

      const result = await withTimeout(
        sttProvider.transcribe(audioBuffer, { signal: request.signal }),
        15_000
      );
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
