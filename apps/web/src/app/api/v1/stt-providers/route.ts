import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { getSharedAiKey, getSharedByokKey } from '@/lib/byok';
import { getAutoModelConfig, resolveSttIncludedModels } from '@/lib/auto-model-config';
import { getAllSttProviderMeta } from '@/lib/providers/stt-registry';
import { getServerInfra } from '@/lib/server-config';

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
  {
    id: 'local',
    displayName: 'Local Whisper',
    description: 'OpenAI-compatible local Whisper server',
  },
];

interface SttModelOption {
  id: string;
  displayName: string;
  tier: string;
  supportedLanguages?: string[];
}

export async function GET(request: NextRequest) {
  const authed = await authenticateRequest(request);

  const configuredProviders: string[] = [];
  let isByok = false;

  if (authed) {
    const userId = authed.userId;

    // Check all provider keys in parallel
    const [openAiKey, elevenLabsKey, togetherKey, deepgramKey, assemblyAiKey, autoConfig, infra] =
      await Promise.all([
        getSharedAiKey(userId, 'openai'),
        getSharedByokKey(userId, 'elevenlabs'),
        getSharedAiKey(userId, 'together'),
        getSharedAiKey(userId, 'deepgram'),
        getSharedAiKey(userId, 'assemblyai'),
        getAutoModelConfig(),
        getServerInfra(),
      ]);

    const byokProviders = new Set<string>();

    if (openAiKey) configuredProviders.push('openai');
    if (openAiKey) byokProviders.add('openai');

    if (elevenLabsKey) configuredProviders.push('elevenlabs');
    if (elevenLabsKey) byokProviders.add('elevenlabs');

    if (togetherKey) configuredProviders.push('together');
    if (togetherKey) byokProviders.add('together');

    if (deepgramKey) configuredProviders.push('deepgram');
    if (deepgramKey) byokProviders.add('deepgram');

    if (assemblyAiKey) configuredProviders.push('assemblyai');
    if (assemblyAiKey) byokProviders.add('assemblyai');

    const hasLocal = infra.sttProvider === 'local' && !!infra.sttBaseUrl;
    if (hasLocal) configuredProviders.push('local');

    isByok = byokProviders.size > 0;
    const includedSet = new Set(resolveSttIncludedModels(autoConfig));
    const includedModels: SttModelOption[] = [];

    for (const provider of getAllSttProviderMeta()) {
      if (!configuredProviders.includes(provider.id)) continue;
      for (const model of provider.models) {
        const compositeId = `${provider.id}:${model.id}`;
        if (
          provider.id !== 'local' &&
          !includedSet.has(compositeId) &&
          !byokProviders.has(provider.id)
        )
          continue;
        includedModels.push({
          id: compositeId,
          displayName: `${provider.displayName} ${model.displayName}`,
          tier: model.tier,
          supportedLanguages: [...model.supportedLanguages],
        });
      }
    }

    return NextResponse.json(
      {
        providers: STT_PROVIDERS,
        configuredProviders,
        isByok,
        includedModels,
      },
      { headers: CACHE_HEADERS }
    );
  }

  return NextResponse.json(
    { providers: STT_PROVIDERS, configuredProviders },
    { headers: CACHE_HEADERS }
  );
}
