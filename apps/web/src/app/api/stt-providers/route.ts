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
  {
    id: 'together',
    displayName: 'Together AI Whisper',
    description: 'Cheap Whisper transcription at $0.0015/min',
  },
  {
    id: 'deepgram',
    displayName: 'Deepgram',
    description: 'Nova-3 — high accuracy STT with $200 free credits',
  },
  {
    id: 'assemblyai',
    displayName: 'AssemblyAI',
    description: 'Universal-2 — 99 languages with $50 free credits',
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

    // Together AI Whisper: BYOK key, or platform key (admin only)
    const hasTogether =
      (await getAiKey(userId, 'together')) !== null ||
      (isAdmin && !!process.env.TOGETHER_API_KEY);
    if (hasTogether) configuredProviders.push('together');

    // Deepgram: BYOK key, or platform key (admin only)
    const hasDeepgram =
      (await getAiKey(userId, 'deepgram')) !== null ||
      (isAdmin && !!process.env.DEEPGRAM_API_KEY);
    if (hasDeepgram) configuredProviders.push('deepgram');

    // AssemblyAI: BYOK key, or platform key (admin only)
    const hasAssemblyAi =
      (await getAiKey(userId, 'assemblyai')) !== null ||
      (isAdmin && !!process.env.ASSEMBLYAI_API_KEY);
    if (hasAssemblyAi) configuredProviders.push('assemblyai');
  }

  return NextResponse.json({ providers: STT_PROVIDERS, configuredProviders });
}
