import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { generateSpeech } from '@/lib/elevenlabs';
import { voicePreviewSchema } from '@/lib/validations';
import { checkRateLimit } from '@/lib/redis';
import { getProviderMeta } from '@/lib/providers/tts-registry';
import { logUsage } from '@/lib/usage-logger';

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

  const { voiceId, text } = parsed.data;

  const audioBuffer = await generateSpeech({ text, voiceId });

  const meta = getProviderMeta('elevenlabs');
  logUsage({
    service: 'elevenlabs',
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
