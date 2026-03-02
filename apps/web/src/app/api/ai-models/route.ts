import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { listAiProviders } from '@/lib/byok';
import { getAllAiProviderMeta, getAiProviderMeta, type AiProviderId } from '@/lib/providers/ai-registry';
import { getAutoModelConfig, resolveIncludedModels } from '@/lib/auto-model-config';
import { isClaudeAvailable } from '@/lib/claude-code-client';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';

const TIER_GROUP_LABELS: Record<string, string> = {
  fast: 'Quick generation',
  balanced: 'Balanced',
  best: 'Best quality',
  max: 'Max',
};

// Env var names for each platform-level AI provider key
const PLATFORM_PROVIDER_ENV: Partial<Record<AiProviderId, string>> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
};

const CLAUDE_CODE_MODELS = getAiProviderMeta('claude-code').models.map(m => ({
  id: `claude-code:${m.id}`,
  displayName: m.displayName,
  tier: m.tier,
  requiredPlan: m.requiredPlan,
  isDefault: false,
  group: 'Claude Code (Local)',
}));

export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const user = await prisma.user.findUnique({
    where: { id: authResult.userId },
    select: { plan: true, role: true },
  });
  const isAdmin = user?.role === 'ADMIN';
  const [aiKeys, claudeAvailable] = await Promise.all([
    listAiProviders(authResult.userId),
    isAdmin ? isClaudeAvailable() : Promise.resolve(false),
  ]);
  const validKeys = aiKeys.filter((k) => k.isValid);
  const claudeCodeModels = claudeAvailable ? CLAUDE_CODE_MODELS : [];
  const userPlan = (user?.plan ?? 'FREE') as 'FREE' | 'PRO';
  const isByok = validKeys.length > 0;

  // No BYOK AI key
  if (!isByok) {
    const autoConfig = await getAutoModelConfig();
    const tierConfig = userPlan === 'PRO' ? autoConfig.pro : autoConfig.free;

    // Admins see all platform-configured API providers (from env vars) + Claude Code local
    if (isAdmin) {
      const platformModels = getAllAiProviderMeta()
        .filter((p) => p.id !== 'groq' && process.env[PLATFORM_PROVIDER_ENV[p.id] ?? ''])
        .flatMap((p) =>
          p.models.map((m) => ({
            id: m.id,
            displayName: m.displayName,
            tier: m.tier,
            requiredPlan: m.requiredPlan,
            isDefault: false,
            group: TIER_GROUP_LABELS[m.tier] ?? m.tier,
            hint: p.displayName,
          }))
        );

      return NextResponse.json({
        provider: tierConfig.aiProvider,
        readOnly: false,
        userPlan: 'PRO',
        isByok: false,
        models: [...platformModels, ...claudeCodeModels],
      });
    }

    // Free/Pro non-BYOK: filter to only included models with dynamic requiredPlan
    const { freeModels, proModels } = resolveIncludedModels(autoConfig);
    const freeSet = new Set(freeModels);
    const proSet = new Set(proModels);

    const platformModels = getAllAiProviderMeta()
      .filter((p) => p.id !== 'groq' && p.id !== 'claude-code' && process.env[PLATFORM_PROVIDER_ENV[p.id] ?? ''])
      .flatMap((p) =>
        p.models
          .filter((m) => proSet.has(m.id))
          .map((m) => ({
            id: m.id,
            displayName: m.displayName,
            tier: m.tier,
            requiredPlan: freeSet.has(m.id) ? ('FREE' as const) : ('PRO' as const),
            isDefault: false,
            group: TIER_GROUP_LABELS[m.tier] ?? m.tier,
            hint: p.displayName,
          }))
      );

    return NextResponse.json({
      provider: tierConfig.aiProvider,
      readOnly: false,
      userPlan,
      isByok: false,
      models: platformModels,
    });
  }

  // BYOK keys present — show models for every valid provider, grouped by quality tier
  // Deduplicate by provider (take first valid key per provider) and exclude Groq (STT-only)
  const seenProviders = new Set<string>();
  const uniqueKeys = validKeys.filter((key) => {
    if (key.provider === 'groq' || seenProviders.has(key.provider)) return false;
    seenProviders.add(key.provider);
    return true;
  });
  const defaultProvider = getAiProviderMeta(uniqueKeys[0].provider as AiProviderId);
  const byokModels = uniqueKeys.flatMap((key) => {
    const p = getAiProviderMeta(key.provider as AiProviderId);
    return p.models.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      tier: m.tier,
      requiredPlan: m.requiredPlan,
      isDefault: false,
      group: TIER_GROUP_LABELS[m.tier] ?? m.tier,
      hint: p.displayName,
    }));
  });

  return NextResponse.json({
    provider: defaultProvider.id,
    readOnly: false,
    userPlan,
    isByok: true,
    models: isAdmin ? [...byokModels, ...claudeCodeModels] : byokModels,
  });
}
