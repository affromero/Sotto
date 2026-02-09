import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { generateSpeech } from '@/lib/elevenlabs';
import { voicePreviewSchema } from '@/lib/validations';
import { checkRateLimit } from '@/lib/redis';

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rateLimit = await checkRateLimit(`voice-preview:${session.user.id}`, 10, 60);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again in a minute.' },
      { status: 429 }
    );
  }

  const body = await request.json();
  const parsed = voicePreviewSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { voiceId, text } = parsed.data;

  const audioBuffer = await generateSpeech({ text, voiceId });
  const uint8 = new Uint8Array(audioBuffer);

  return new NextResponse(uint8, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length.toString(),
    },
  });
}
