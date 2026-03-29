import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { z } from 'zod';
import { createAIProvider } from '@/lib/providers/ai';
import { createTtsProviderAsync } from '@/lib/providers/tts';
import { createSttProvider } from '@/lib/providers/stt';
import type { TtsProviderId } from '@/lib/providers/tts-registry';
import type { SttProviderId } from '@/lib/providers/stt-registry';
import type { AiProviderId } from '@/lib/providers/ai-registry';
import { getAiKey, getByokKey } from '@/lib/byok';
import { logUsage } from '@/lib/usage-logger';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { BRAND } from '@sotto/shared';
import {
  CARTESIA_VOICE_POOL,
  HUME_VOICE_POOL,
  FAL_VOICE_POOL,
  MINIMAX_VOICE_POOL,
  MISTRAL_VOICE_POOL,
} from '@/lib/providers/tts-voices';
import { FalImageProvider } from '@/lib/providers/image/fal.provider';
import { getVideoProviderMeta, videoModelRequiresFirstFrame, type VideoProviderId } from '@/lib/providers/video-registry';
import { getFalVideoEndpoint, getFalFrameParams, isFalWanModel } from '@/lib/providers/fal-endpoints';
import { MINIMAX_MODEL_MAP } from '@/lib/providers/video/minimax.provider';
import { getAvatarProviderMeta, type AvatarProviderId } from '@/lib/providers/avatar-registry';
import { getMusicProviderMeta, type MusicProviderId } from '@/lib/providers/music-registry';
import { listAvatars } from '@/lib/heygen';
import { submitFalLipSync, pollFalLipSync } from '@/lib/fal-lip-sync';
import { uploadFile, deleteFile } from '@/lib/r2';
import { randomUUID } from 'crypto';

const requestSchema = z.object({
  type: z.enum(['ai', 'tts', 'stt', 'image', 'video', 'avatar', 'music']),
  provider: z.string().min(1),
  model: z.string().min(1),
  keySource: z.enum(['platform', 'byok']).default('platform'),
});

// Stable test voice per TTS provider
const TTS_TEST_VOICES: Record<string, string> = {
  elevenlabs: '21m00Tcm4TlvDq8ikWAM', // Rachel — stable free voice
  openai: 'alloy',
  cartesia: CARTESIA_VOICE_POOL[0].id,
  hume: HUME_VOICE_POOL[0].id,
  fal: FAL_VOICE_POOL[0].id,
  replicate: FAL_VOICE_POOL[0].id,
  minimax: MINIMAX_VOICE_POOL[0].id,
  mistral: MISTRAL_VOICE_POOL[0].id,
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
    case 'cartesia':
      return { apiKey: process.env.CARTESIA_API_KEY };
    case 'hume':
      return { apiKey: process.env.HUME_API_KEY };
    case 'fal':
      return { apiKey: process.env.FAL_KEY };
    case 'minimax':
      return { apiKey: process.env.FAL_KEY };
    case 'replicate':
      return { apiKey: process.env.REPLICATE_API_TOKEN };
    case 'mistral':
      return { apiKey: process.env.MISTRAL_API_KEY };
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
    case 'elevenlabs':
      return process.env.ELEVENLABS_API_KEY;
    case 'together':
      return process.env.TOGETHER_API_KEY;
    case 'deepgram':
      return process.env.DEEPGRAM_API_KEY;
    case 'assemblyai':
      return process.env.ASSEMBLYAI_API_KEY;
    default:
      return undefined;
  }
}

/**
 * Generate real "Hello" audio from the first available TTS provider.
 * Tries providers in order: cheapest/fastest first.
 * Returns null if no TTS provider is available.
 */
const TTS_PROBE_ORDER: TtsProviderId[] = [
  'kittentts', 'openai', 'elevenlabs', 'cartesia', 'hume', 'fal', 'replicate', 'minimax', 'mistral',
];

async function generateTestAudio(): Promise<{ audio: Buffer; provider: string } | null> {
  for (const id of TTS_PROBE_ORDER) {
    const { apiKey, extraData } = getTtsPlatformKey(id);
    // Check if provider has required credentials
    if (id === 'kittentts') {
      if (!process.env.KITTENTTS_URL) continue;
    } else if (!apiKey) {
      continue;
    }

    try {
      const tts = await createTtsProviderAsync(id, apiKey, extraData);
      const voiceId = TTS_TEST_VOICES[id] ?? 'alloy';
      const audio = await withTimeout(
        tts.generateSpeech({ text: `${BRAND.name} — ${BRAND.tagline}`, voiceId }),
        5_000,
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
  if ((buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
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
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms)
    ),
  ]);
}

/** Generate an image via Fal FLUX Schnell and return the CDN URL. */
async function generateFalImageUrl(apiKey: string, prompt: string, size = 512): Promise<string> {
  const res = await fetch('https://fal.run/fal-ai/flux/schnell', {
    method: 'POST',
    headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, image_size: { width: size, height: size }, num_images: 1, enable_safety_checker: true }),
  });
  if (!res.ok) throw new Error(`Image generation failed (${res.status})`);
  const data = (await res.json()) as { images?: Array<{ url: string }> };
  const url = data?.images?.[0]?.url;
  if (!url) throw new Error('Image generation returned no URL');
  return url;
}

/** Resolve API key for image/video/avatar/music providers (BYOK from UserTtsKey or platform env). */
async function resolveProviderKey(
  adminId: string,
  provider: string,
  keySource: string,
  platformEnvVar: string
): Promise<{ apiKey: string | undefined; error?: string }> {
  if (keySource === 'byok') {
    const key = await getByokKey(adminId, provider);
    if (!key) return { apiKey: undefined, error: 'BYOK key not found for this provider' };
    return { apiKey: key };
  }
  const apiKey = process.env[platformEnvVar];
  if (!apiKey) return { apiKey: undefined, error: `Platform key not configured (${platformEnvVar})` };
  return { apiKey };
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
      const timeoutMs = provider === 'claude-code' ? 60_000 : 15_000;
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
      let extraData: Record<string, string> | undefined;

      if (keySource === 'byok') {
        if (provider === 'kittentts') {
          // KittenTTS has no BYOK concept — just needs KITTENTTS_URL set
          if (!process.env.KITTENTTS_URL) {
            return NextResponse.json({
              success: false,
              latencyMs: Date.now() - start,
              error: 'Platform API key not configured (check .env)',
            });
          }
        } else {
          const key = await getByokKey(adminId, provider as TtsProviderId);
          if (!key) {
            return NextResponse.json({
              success: false,
              latencyMs: Date.now() - start,
              error: 'BYOK key not found for this provider',
            });
          }
          apiKey = key;
        }
      } else {
        const platformData = getTtsPlatformKey(provider);
        apiKey = platformData.apiKey;
        extraData = platformData.extraData;

        if (provider === 'kittentts') {
          if (!process.env.KITTENTTS_URL) {
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
      }

      const voiceId = TTS_TEST_VOICES[provider] ?? 'alloy';
      const ttsProvider = await createTtsProviderAsync(
        provider as TtsProviderId,
        apiKey,
        extraData,
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
        if (provider === 'openai' || provider === 'together' || provider === 'deepgram' || provider === 'assemblyai') {
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

    if (type === 'image') {
      const { apiKey, error } = await resolveProviderKey(adminId, 'fal', keySource, 'FAL_KEY');
      if (!apiKey) {
        return NextResponse.json({ success: false, latencyMs: Date.now() - start, error });
      }

      const imageProvider = new FalImageProvider(apiKey, model);
      const imageBuffer = await withTimeout(
        imageProvider.generateImage({
          prompt: 'A warm golden podcast microphone, studio lighting',
          width: 256,
          height: 256,
        }),
        60_000
      );
      const base64 = imageBuffer.toString('base64');
      return NextResponse.json({
        success: true,
        latencyMs: Date.now() - start,
        imageData: `data:image/png;base64,${base64}`,
      });
    }

    if (type === 'video') {
      const meta = getVideoProviderMeta(provider as VideoProviderId);
      const { apiKey, error } = await resolveProviderKey(adminId, provider, keySource, meta.platformKeyEnv);
      if (!apiKey) {
        return NextResponse.json({ success: false, latencyMs: Date.now() - start, error });
      }

      // Fal video models — actual generation
      const falEndpoint = getFalVideoEndpoint(model);
      if (provider === 'fal' && falEndpoint) {
        const result = await withTimeout((async () => {
          const prompt = 'A golden podcast microphone floating in a warm studio, soft cinematic lighting';

          // Generate first-frame image if required
          let firstFrameUrl: string | undefined;
          if (videoModelRequiresFirstFrame(model)) {
            firstFrameUrl = await generateFalImageUrl(apiKey, 'A golden podcast microphone in a warm studio, cinematic lighting');
          }

          // Build request body
          const body: Record<string, unknown> = { prompt, aspect_ratio: '16:9' };
          if (isFalWanModel(model)) {
            body.num_frames = 81;
            body.resolution = '480p';
          } else {
            body.duration = '4s';
          }
          if (firstFrameUrl) {
            const frameParams = getFalFrameParams(model);
            body[frameParams.firstFrameParam] = firstFrameUrl;
          }

          // Submit to queue
          const submitRes = await fetch(`https://queue.fal.run/${falEndpoint}`, {
            method: 'POST',
            headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!submitRes.ok) {
            const text = await submitRes.text().catch(() => 'unknown');
            throw new Error(`Fal video submission failed (${submitRes.status}): ${text}`);
          }
          const submitData = (await submitRes.json()) as { request_id: string; status_url?: string; response_url?: string };
          const reqId = submitData.request_id;
          const fallbackBase = `https://queue.fal.run/${falEndpoint}/requests/${reqId}`;
          const statusUrl = submitData.status_url ?? `${fallbackBase}/status`;
          const resultUrl = submitData.response_url ?? (submitData.status_url ? submitData.status_url.replace(/\/status$/, '') : fallbackBase);

          // Poll for completion (up to 180s at 5s intervals)
          for (let i = 0; i < 36; i++) {
            await new Promise((r) => setTimeout(r, 5000));
            const pollRes = await fetch(statusUrl, { headers: { Authorization: `Key ${apiKey}` } });
            if (!pollRes.ok) continue;
            const status = (await pollRes.json()) as { status: string; error?: string; response_url?: string };

            if (status.status === 'COMPLETED') {
              const fetchUrl = status.response_url ?? resultUrl;
              const resResult = await fetch(fetchUrl, { headers: { Authorization: `Key ${apiKey}` } });
              if (!resResult.ok) throw new Error(`Fal result fetch failed (${resResult.status})`);
              const resultData = (await resResult.json()) as { video?: { url: string } };
              const videoUrl = resultData?.video?.url;
              if (!videoUrl) throw new Error('Fal video returned no URL');
              return { videoUrl };
            }
            if (status.status === 'FAILED') {
              throw new Error(`Fal video generation failed: ${status.error || 'unknown'}`);
            }
          }
          throw new Error('Fal video generation timed out');
        })(), 180_000);

        return NextResponse.json({
          success: true,
          latencyMs: Date.now() - start,
          videoUrl: result.videoUrl,
          response: 'Video generated',
        });
      }

      // MiniMax video models — actual generation
      const minimaxMapping = MINIMAX_MODEL_MAP[model];
      if (provider === 'minimax' && minimaxMapping) {
        const result = await withTimeout((async () => {
          const prompt = 'A golden podcast microphone floating in a warm studio, soft cinematic lighting';

          // Generate first-frame image if required (uses FAL_KEY)
          let firstFrameImage: string | undefined;
          if (minimaxMapping.requiresFirstFrame) {
            const falKey = process.env.FAL_KEY;
            if (!falKey) throw new Error('FAL_KEY required for first-frame image generation');
            firstFrameImage = await generateFalImageUrl(falKey, 'A golden podcast microphone in a warm studio, cinematic lighting');
          }

          const body: Record<string, unknown> = {
            model: minimaxMapping.apiModel,
            prompt,
            prompt_optimizer: true,
            duration: 6,
            resolution: minimaxMapping.resolution,
          };
          if (firstFrameImage) body.first_frame_image = firstFrameImage;

          const submitRes = await fetch('https://api.minimax.io/v1/video_generation', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!submitRes.ok) {
            const text = await submitRes.text().catch(() => 'unknown');
            throw new Error(`MiniMax video submission failed (${submitRes.status}): ${text}`);
          }
          const submitData = (await submitRes.json()) as { task_id: string; base_resp: { status_code: number; status_msg: string } };
          if (submitData.base_resp.status_code !== 0) throw new Error(`MiniMax submit error: ${submitData.base_resp.status_msg}`);

          const taskId = submitData.task_id;

          // Poll for completion (up to 180s at 10s intervals)
          for (let i = 0; i < 18; i++) {
            await new Promise((r) => setTimeout(r, 10000));
            const pollRes = await fetch(`https://api.minimax.io/v1/query/video_generation?task_id=${taskId}`, {
              headers: { Authorization: `Bearer ${apiKey}` },
            });
            if (!pollRes.ok) continue;
            const status = (await pollRes.json()) as { status: string; file_id?: string; base_resp: { status_code: number; status_msg: string } };

            if (status.status === 'Success' && status.file_id) {
              // Retrieve download URL
              const fileRes = await fetch(`https://api.minimax.io/v1/files/retrieve?file_id=${status.file_id}`, {
                headers: { Authorization: `Bearer ${apiKey}` },
              });
              if (!fileRes.ok) throw new Error(`MiniMax file retrieve failed (${fileRes.status})`);
              const fileData = (await fileRes.json()) as { file: { download_url: string }; base_resp: { status_code: number; status_msg: string } };
              if (fileData.base_resp.status_code !== 0) throw new Error(`MiniMax file error: ${fileData.base_resp.status_msg}`);
              if (!fileData.file?.download_url) throw new Error('MiniMax returned no download URL');
              return { videoUrl: fileData.file.download_url };
            }
            if (status.status === 'Fail') {
              throw new Error(`MiniMax video generation failed: ${status.base_resp.status_msg}`);
            }
          }
          throw new Error('MiniMax video generation timed out');
        })(), 180_000);

        return NextResponse.json({
          success: true,
          latencyMs: Date.now() - start,
          videoUrl: result.videoUrl,
          response: 'Video generated',
        });
      }

      // Unknown providers — fall back to key validation
      const valid = await withTimeout(meta.auth.validate({ apiKey }), 10_000);
      return NextResponse.json({
        success: valid,
        latencyMs: Date.now() - start,
        response: valid ? 'API key valid' : 'API key invalid',
        error: valid ? undefined : 'API key validation failed',
      });
    }

    if (type === 'avatar') {
      const meta = getAvatarProviderMeta(provider as AvatarProviderId);
      const { apiKey, error } = await resolveProviderKey(adminId, provider, keySource, meta.platformKeyEnv);
      if (!apiKey) {
        return NextResponse.json({ success: false, latencyMs: Date.now() - start, error });
      }

      // HeyGen: list avatars to verify key + show count
      if (provider === 'heygen') {
        const avatars = await withTimeout(listAvatars(apiKey), 15_000);
        return NextResponse.json({
          success: true,
          latencyMs: Date.now() - start,
          response: `${avatars.length} avatars available`,
          avatarCount: avatars.length,
        });
      }

      // Fal: generate portrait + lip-sync video
      if (provider === 'fal') {
        const result = await withTimeout((async () => {
          // Generate portrait image
          const imageUrl = await generateFalImageUrl(
            apiKey,
            'Professional headshot portrait of a friendly podcast host, warm studio lighting, neutral background, looking at camera, photorealistic',
          );

          // Generate test audio
          const testAudio = await generateTestAudio();
          if (!testAudio) {
            return { fallback: true } as const;
          }

          // Upload audio to R2 for public URL
          const mime = detectAudioMime(testAudio.audio);
          const ext = mime === 'audio/wav' ? 'wav' : mime === 'audio/ogg' ? 'ogg' : mime === 'audio/flac' ? 'flac' : 'mp3';
          const r2Key = `admin-tests/${randomUUID()}.${ext}`;
          const audioUrl = await uploadFile(r2Key, testAudio.audio, mime);

          try {
            // Submit lip-sync
            const { LIP_SYNC_CONFIG } = await import('@/lib/providers/fal-endpoints');
            const prompt = LIP_SYNC_CONFIG[model]?.defaultPrompt;
            logger.info('Avatar test: submitting lip-sync', { model, imageUrl, audioUrl, prompt });
            const { statusUrl, resultUrl } = await submitFalLipSync({ modelId: model, imageUrl, audioUrl, apiKey, prompt });

            // Poll for result
            const lipSyncResult = await pollFalLipSync(statusUrl, resultUrl, apiKey, 150_000);

            return { videoUrl: lipSyncResult.videoUrl, model } as const;
          } finally {
            // Cleanup R2 temp file
            deleteFile(r2Key).catch(() => {});
          }
        })(), 180_000);

        if ('fallback' in result) {
          return NextResponse.json({
            success: true,
            latencyMs: Date.now() - start,
            response: 'Fal key valid (no TTS for full test)',
          });
        }

        return NextResponse.json({
          success: true,
          latencyMs: Date.now() - start,
          videoUrl: result.videoUrl,
          response: `Lip-sync via ${result.model}`,
        });
      }

      // Runway and others: auth validation only
      const valid = await withTimeout(meta.auth.validate({ apiKey }), 10_000);
      return NextResponse.json({
        success: valid,
        latencyMs: Date.now() - start,
        response: valid ? 'API key valid' : 'API key invalid',
        error: valid ? undefined : 'API key validation failed',
      });
    }

    if (type === 'music') {
      const meta = getMusicProviderMeta(provider as MusicProviderId);
      const { apiKey, error } = await resolveProviderKey(adminId, provider, keySource, meta.platformKeyEnv);
      if (!apiKey) {
        return NextResponse.json({ success: false, latencyMs: Date.now() - start, error });
      }

      const valid = await withTimeout(meta.auth.validate({ apiKey }), 10_000);
      return NextResponse.json({
        success: valid,
        latencyMs: Date.now() - start,
        response: valid ? 'API key valid' : 'API key invalid',
        error: valid ? undefined : 'API key validation failed',
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
