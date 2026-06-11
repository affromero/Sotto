import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getAiKey, getByokKey } from '@/lib/byok';
import { getAutoModelConfig, resolveSttIncludedModels } from '@/lib/auto-model-config';
import { getAllSttProviderMeta } from '@/lib/providers/stt-registry';

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
}

export async function GET() {
  const session = await auth();

  const configuredProviders: string[] = [];
  let isByok = false;

  if (session?.user?.id) {
    const userId = session.user.id;

    // Check all provider keys in parallel
    const [openAiKey, elevenLabsKey, togetherKey, deepgramKey, assemblyAiKey, autoConfig] = await Promise.all([
      getAiKey(userId, 'openai'),
      getByokKey(userId, 'elevenlabs'),
      getAiKey(userId, 'together'),
      getAiKey(userId, 'deepgram'),
      getAiKey(userId, 'assemblyai'),
      getAutoModelConfig(),
    ]);

    const byokProviders = new Set<string>();

    const hasOpenAi = openAiKey !== null || !!process.env.OPENAI_API_KEY;
    if (hasOpenAi) configuredProviders.push('openai');
    if (openAiKey) byokProviders.add('openai');

    const hasElevenLabs = elevenLabsKey !== null || !!process.env.ELEVENLABS_API_KEY;
    if (hasElevenLabs) configuredProviders.push('elevenlabs');
    if (elevenLabsKey) byokProviders.add('elevenlabs');

    const hasTogether = togetherKey !== null || !!process.env.TOGETHER_API_KEY;
    if (hasTogether) configuredProviders.push('together');
    if (togetherKey) byokProviders.add('together');

    const hasDeepgram = deepgramKey !== null || !!process.env.DEEPGRAM_API_KEY;
    if (hasDeepgram) configuredProviders.push('deepgram');
    if (deepgramKey) byokProviders.add('deepgram');

    const hasAssemblyAi = assemblyAiKey !== null || !!process.env.ASSEMBLYAI_API_KEY;
    if (hasAssemblyAi) configuredProviders.push('assemblyai');
    if (assemblyAiKey) byokProviders.add('assemblyai');

    isByok = byokProviders.size > 0;
    const includedSet = new Set(resolveSttIncludedModels(autoConfig));
    const includedModels: SttModelOption[] = [];

    for (const provider of getAllSttProviderMeta()) {
      if (!configuredProviders.includes(provider.id)) continue;
      for (const model of provider.models) {
        const compositeId = `${provider.id}:${model.id}`;
        if (!includedSet.has(compositeId) && !byokProviders.has(provider.id)) continue;
        includedModels.push({
          id: compositeId,
          displayName: `${provider.displayName} ${model.displayName}`,
          tier: model.tier,
        });
      }
    }

    return NextResponse.json({
      providers: STT_PROVIDERS,
      configuredProviders,
      isByok,
      includedModels,
    }, { headers: CACHE_HEADERS });
  }

  return NextResponse.json({ providers: STT_PROVIDERS, configuredProviders }, { headers: CACHE_HEADERS });
}
