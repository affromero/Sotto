import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { voicePreviewSchema } from '@/lib/validations';
import { checkRateLimit } from '@/lib/redis';
import { getProviderMeta, type TtsProviderId } from '@/lib/providers/tts-registry';
import { logUsage } from '@/lib/usage-logger';
import { getByokKey } from '@/lib/byok';
import { createTtsProviderAsync } from '@/lib/providers/tts';
import { errorResponse } from '@/lib/api-response';

function getPlatformPreviewKey(provider: TtsProviderId): string | undefined {
  switch (provider) {
    case 'elevenlabs': return process.env.ELEVENLABS_API_KEY;
    case 'openai': return process.env.OPENAI_API_KEY;
    case 'cartesia': return process.env.CARTESIA_API_KEY;
    case 'hume': return process.env.HUME_API_KEY;
    case 'fal': return process.env.FAL_KEY;
    case 'replicate': return process.env.REPLICATE_API_TOKEN;
    case 'minimax': return process.env.FAL_KEY;
    case 'mistral': return process.env.MISTRAL_API_KEY;
  }
}

export async function POST(request: NextRequest) {
  const authed = await authenticateRequest(request);
  if (!authed) {
    return errorResponse('Unauthorized', 401);
  }
  const userId = authed.userId;

  const rateLimit = await checkRateLimit(`voice-preview:${userId}`, 10, 60);
  if (!rateLimit.allowed) {
    return errorResponse('Rate limit exceeded. Try again in a minute.', 429);
  }

  const body = await request.json();
  const parsed = voicePreviewSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { voiceId, text, provider } = parsed.data;

  let audioBuffer: Buffer;
  const providerName: TtsProviderId = provider;

  try {
    const byokKey = await getByokKey(userId, providerName);
    const apiKey = byokKey || getPlatformPreviewKey(providerName);

    if (!apiKey) {
      return errorResponse(`No ${providerName} API key available`, 400);
    }

    const ttsProvider = await createTtsProviderAsync(providerName, apiKey);
    audioBuffer = await ttsProvider.generateSpeech({ text, voiceId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    const isInvalidId = msg.includes('422') || msg.toLowerCase().includes('pattern') || msg.toLowerCase().includes('invalid_uid');
    return errorResponse(isInvalidId ? 'Invalid voice ID format.' : 'Failed to generate preview.', 400);
  }

  const meta = getProviderMeta(providerName);
  logUsage({
    service: providerName,
    category: 'voice_preview',
    inputTokens: text.length,
    totalCost: (text.length / 1000) * meta.platformCostPerKChar,
    userId,
  });

  const uint8 = new Uint8Array(audioBuffer);

  return new NextResponse(uint8, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length.toString(),
    },
  });
}
