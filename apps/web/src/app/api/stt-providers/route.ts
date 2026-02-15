import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getAiKey, getByokKey } from '@/lib/byok';

interface SttProviderInfo {
  id: string;
  displayName: string;
  description: string;
}

const STT_PROVIDERS: SttProviderInfo[] = [
  {
    id: 'openai',
    displayName: 'OpenAI Whisper',
    description: 'Fast and accurate speech recognition',
  },
  {
    id: 'elevenlabs',
    displayName: 'ElevenLabs Scribe',
    description: 'High-quality transcription with word-level timestamps',
  },
];

export async function GET() {
  const session = await auth();

  let configuredProviders: string[] = [];

  if (session?.user?.id) {
    const userId = session.user.id;

    // OpenAI Whisper: check BYOK OpenAI key or platform key
    const hasOpenAi =
      (await getAiKey(userId, 'openai')) !== null || !!process.env.OPENAI_API_KEY;
    if (hasOpenAi) configuredProviders.push('openai');

    // ElevenLabs Scribe: check BYOK ElevenLabs key or platform key
    const hasElevenLabs =
      (await getByokKey(userId, 'elevenlabs')) !== null || !!process.env.ELEVENLABS_API_KEY;
    if (hasElevenLabs) configuredProviders.push('elevenlabs');
  }

  return NextResponse.json({ providers: STT_PROVIDERS, configuredProviders });
}
