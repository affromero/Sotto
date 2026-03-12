import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { generateSpeech } from '@/lib/elevenlabs';
import { voicePreviewSchema } from '@/lib/validations';
import { checkRateLimit } from '@/lib/redis';
import { getProviderMeta, type TtsProviderId } from '@/lib/providers/tts-registry';
import { logUsage } from '@/lib/usage-logger';
import { getByokKey } from '@/lib/byok';
import { createTtsProviderAsync } from '@/lib/providers/tts';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const rateLimit = await checkRateLimit(`voice-preview:${session.user.id}`, 10, 60);
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
  const providerName: TtsProviderId = (provider || 'elevenlabs') as TtsProviderId;

  try {
    if (provider && provider !== 'elevenlabs') {
      // Multi-provider preview: use BYOK key or platform key
      const ttsProviderId = provider as TtsProviderId;
      const byokKey = await getByokKey(session.user.id, ttsProviderId);
      const platformKey = provider === 'hume' ? process.env.HUME_API_KEY
        : provider === 'cartesia' ? process.env.CARTESIA_API_KEY
        : undefined;
      const apiKey = byokKey || platformKey;

      if (!apiKey) {
        return errorResponse(`No ${provider} API key available`, 400);
      }

      const ttsProvider = await createTtsProviderAsync(ttsProviderId, apiKey);
      audioBuffer = await ttsProvider.generateSpeech({ text, voiceId });
    } else {
      // Default: ElevenLabs — use BYOK key; platform key only for admins without BYOK
      const [elByokKey, user] = await Promise.all([
        getByokKey(session.user.id, 'elevenlabs'),
        prisma.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { role: true } }),
      ]);
      const isAdmin = user.role === 'ADMIN' || user.role === 'SYSTEM';
      const apiKey = elByokKey ?? (isAdmin ? undefined : null);
      if (apiKey === null) {
        return errorResponse('Add your ElevenLabs API key in Settings to preview voices.', 400);
      }
      audioBuffer = await generateSpeech({ text, voiceId, apiKeyOverride: apiKey ?? undefined });
    }
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
    userId: session.user.id,
  });

  const uint8 = new Uint8Array(audioBuffer);

  return new NextResponse(uint8, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length.toString(),
    },
  });
}
