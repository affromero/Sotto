import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { listAiProviders } from '@/lib/byok';
import { getAllAiProviderMeta, getAiProviderMeta, type AiProviderId } from '@/lib/providers/ai-registry';
import { getAutoModelConfig, resolveIncludedModels } from '@/lib/auto-model-config';
import { isClaudeAvailable } from '@/lib/claude-code-client';

import { errorResponse } from '@/lib/api-response';

const CACHE_HEADERS = { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=300' };

/** Sort models: providers alphabetically by group, models alphabetically within each provider. */
function sortModels<T extends { group: string; displayName: string }>(models: T[]): T[] {
  return [...models].sort((a, b) => a.group.localeCompare(b.group) || a.displayName.localeCompare(b.displayName));
}

// Derive env var names from registry — no manual map needed
const PLATFORM_PROVIDER_ENV: Partial<Record<AiProviderId, string>> = {};
for (const p of getAllAiProviderMeta()) {
  if (p.platformEnvKey) PLATFORM_PROVIDER_ENV[p.id] = p.platformEnvKey;
}

const CLAUDE_CODE_MODELS = getAiProviderMeta('claude-code').models.map(m => ({
  id: `claude-code:${m.id}`,
  displayName: m.displayName,
  tier: m.tier,
  isDefault: false,
  group: 'Claude Code (Local)',
}));

export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const [aiKeys, claudeAvailable, autoConfig] = await Promise.all([
    listAiProviders(authResult.userId),
    isClaudeAvailable(),
    getAutoModelConfig(),
  ]);
  const validKeys = aiKeys.filter((k) => k.isValid);
  const claudeCodeModels = claudeAvailable ? CLAUDE_CODE_MODELS : [];
  const isByok = validKeys.length > 0;
  const includedModelIds = new Set(resolveIncludedModels(autoConfig));
  const modelsById = new Map<string, {
    id: string;
    displayName: string;
    tier: string;
    isDefault: boolean;
    group: string;
    hint: string;
  }>();

  for (const provider of getAllAiProviderMeta()) {
    if (provider.id === 'claude-code' || provider.id === 'local') continue;
    if (!process.env[PLATFORM_PROVIDER_ENV[provider.id] ?? '']) continue;
    for (const model of provider.models) {
      if (!includedModelIds.has(model.id)) continue;
      modelsById.set(model.id, {
        id: model.id,
        displayName: model.displayName,
        tier: model.tier,
        isDefault: model.id === autoConfig.model.aiModel,
        group: provider.displayName,
        hint: provider.displayName,
      });
    }
  }

  for (const key of validKeys) {
    const provider = getAiProviderMeta(key.provider as AiProviderId);
    for (const model of provider.models) {
      modelsById.set(model.id, {
        id: model.id,
        displayName: model.displayName,
        tier: model.tier,
        isDefault: key.provider === autoConfig.model.aiProvider && model.id === autoConfig.model.aiModel,
        group: provider.displayName,
        hint: provider.displayName,
      });
    }
  }

  return NextResponse.json({
    provider: validKeys[0]?.provider ?? autoConfig.model.aiProvider,
    readOnly: false,
    isByok,
    models: sortModels([...modelsById.values(), ...claudeCodeModels]),
  }, { headers: CACHE_HEADERS });
}
