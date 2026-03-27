import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getAiKey, getByokKey } from '@/lib/byok';
import { getAutoModelConfig, resolveSttIncludedModels } from '@/lib/auto-model-config';
import { getAllSttProviderMeta } from '@/lib/providers/stt-registry';
import { prisma } from '@/lib/prisma';

const CACHE_HEADERS = { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=300' };

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

    // Check all provider keys in parallel
    const [openAiKey, elevenLabsKey, togetherKey, deepgramKey, assemblyAiKey] = await Promise.all([
      getAiKey(userId, 'openai'),
      getByokKey(userId, 'elevenlabs'),
      getAiKey(userId, 'together'),
      getAiKey(userId, 'deepgram'),
      getAiKey(userId, 'assemblyai'),
    ]);

    const hasOpenAi = openAiKey !== null || (isAdmin && !!process.env.OPENAI_API_KEY);
    if (hasOpenAi) configuredProviders.push('openai');

    const hasElevenLabs = elevenLabsKey !== null || (isAdmin && !!process.env.ELEVENLABS_API_KEY);
    if (hasElevenLabs) configuredProviders.push('elevenlabs');

    const hasTogether = togetherKey !== null || (isAdmin && !!process.env.TOGETHER_API_KEY);
    if (hasTogether) configuredProviders.push('together');

    const hasDeepgram = deepgramKey !== null || (isAdmin && !!process.env.DEEPGRAM_API_KEY);
    if (hasDeepgram) configuredProviders.push('deepgram');

    const hasAssemblyAi = assemblyAiKey !== null || (isAdmin && !!process.env.ASSEMBLYAI_API_KEY);
    if (hasAssemblyAi) configuredProviders.push('assemblyai');

    // Check if any BYOK keys exist (AI keys that double as STT keys)
    isByok = [hasOpenAi, hasElevenLabs, hasTogether, hasDeepgram, hasAssemblyAi].some(
      (v) => v && !isAdmin
    );

    // Non-BYOK users + admins in PRO view: include STT models filtered by included lists
    const autoConfig = (!isByok || isAdmin) ? await getAutoModelConfig() : null;
    const adminProView = isAdmin && autoConfig?.adminViewMode === 'PRO';

    if ((!isByok && !isAdmin) || adminProView) {
      const dbUser = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } });
      const userPlan = adminProView ? 'PRO' as const : (dbUser?.plan ?? 'FREE') as 'FREE' | 'PRO';
      const config = autoConfig ?? await getAutoModelConfig();
      const { freeSttModels, proSttModels } = resolveSttIncludedModels(config);
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
        ...(adminProView ? { adminViewMode: 'PRO' } : {}),
        includedModels,
      }, { headers: CACHE_HEADERS });
    }
  }

  return NextResponse.json({ providers: STT_PROVIDERS, configuredProviders }, { headers: CACHE_HEADERS });
}
