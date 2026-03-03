import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getAiKey, getByokKey } from '@/lib/byok';
import { getAutoModelConfig, resolveSttIncludedModels } from '@/lib/auto-model-config';
import { getAllSttProviderMeta } from '@/lib/providers/stt-registry';
import { prisma } from '@/lib/prisma';

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

interface SttModelOption {
  id: string;
  displayName: string;
  tier: string;
  requiredPlan: 'FREE' | 'PRO';
}

export async function GET() {
  const session = await auth();

  const configuredProviders: string[] = [];
  let isByok = false;

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

    // Check if any BYOK keys exist (AI keys that double as STT keys)
    isByok = [hasOpenAi, hasElevenLabs, hasTogether, hasDeepgram, hasAssemblyAi].some(
      (v) => v && !isAdmin
    );

    // Non-BYOK, non-admin: include STT models filtered by included lists
    if (!isByok && !isAdmin) {
      const dbUser = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } });
      const userPlan = (dbUser?.plan ?? 'FREE') as 'FREE' | 'PRO';
      const autoConfig = await getAutoModelConfig();
      const { freeSttModels, proSttModels } = resolveSttIncludedModels(autoConfig);
      const freeSet = new Set(freeSttModels);
      const proSet = new Set(proSttModels);

      const includedModels: SttModelOption[] = [];
      for (const provider of getAllSttProviderMeta()) {
        for (const model of provider.models) {
          const compositeId = `${provider.id}:${model.id}`;
          if (!proSet.has(compositeId)) continue;
          includedModels.push({
            id: compositeId,
            displayName: `${provider.displayName} ${model.displayName}`,
            tier: model.tier,
            requiredPlan: freeSet.has(compositeId) ? 'FREE' : 'PRO',
          });
        }
      }

      return NextResponse.json({
        providers: STT_PROVIDERS,
        configuredProviders,
        userPlan,
        isByok: false,
        includedModels,
      });
    }
  }

  return NextResponse.json({ providers: STT_PROVIDERS, configuredProviders });
}
