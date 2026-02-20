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
  {
    id: 'groq',
    displayName: 'Groq Whisper',
    description: 'Free, fast transcription powered by Groq',
  },
];

export async function GET() {
  const session = await auth();

  const configuredProviders: string[] = [];

  if (session?.user?.id) {
    const userId = session.user.id;
    const isAdmin = session.user.role === 'ADMIN';

    // OpenAI Whisper: BYOK key, or platform key (admin only)
    const hasOpenAi =
      (await getAiKey(userId, 'openai')) !== null ||
      (isAdmin && !!process.env.OPENAI_API_KEY);
    if (hasOpenAi) configuredProviders.push('openai');

    // ElevenLabs Scribe: BYOK key, or platform key (admin only)
    const hasElevenLabs =
      (await getByokKey(userId, 'elevenlabs')) !== null ||
      (isAdmin && !!process.env.ELEVENLABS_API_KEY);
    if (hasElevenLabs) configuredProviders.push('elevenlabs');

    // Groq Whisper: BYOK key, or platform key (admin only)
    const hasGroq =
      (await getAiKey(userId, 'groq')) !== null ||
      (isAdmin && !!process.env.GROQ_API_KEY);
    if (hasGroq) configuredProviders.push('groq');
  }

  return NextResponse.json({ providers: STT_PROVIDERS, configuredProviders });
}
