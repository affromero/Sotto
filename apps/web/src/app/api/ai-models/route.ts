import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { listAiProviders } from '@/lib/byok';
import { getAllAiProviderMeta, getAiProviderMeta, type AiProviderId } from '@/lib/providers/ai-registry';
import { getAutoModelConfig, resolveIncludedModels } from '@/lib/auto-model-config';
import { isClaudeAvailable } from '@/lib/claude-code-client';
import { prisma } from '@/lib/prisma';

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
    isClaudeAvailable(),
  ]);
  const validKeys = aiKeys.filter((k) => k.isValid);
  const claudeCodeModels = claudeAvailable ? CLAUDE_CODE_MODELS : [];
  const userPlan = (user?.plan ?? 'FREE') as 'FREE' | 'PRO';
  const isByok = validKeys.length > 0;

  // No BYOK AI key
  if (!isByok) {
    const autoConfig = await getAutoModelConfig();
    const tierConfig = userPlan === 'PRO' ? autoConfig.pro : autoConfig.free;

    // Admins: respect adminViewMode toggle
    if (isAdmin) {
      const proView = autoConfig.adminViewMode === 'PRO';

      if (proView) {
        const { freeModels, proModels } = resolveIncludedModels(autoConfig);
        const freeSet = new Set(freeModels);
        const proSet = new Set(proModels);

        const platformModels = getAllAiProviderMeta()
          .filter((p) => p.id !== 'claude-code' && process.env[PLATFORM_PROVIDER_ENV[p.id] ?? ''])
          .flatMap((p) =>
            p.models
              .filter((m) => proSet.has(m.id))
              .map((m) => ({
                id: m.id,
                displayName: m.displayName,
                tier: m.tier,
                requiredPlan: freeSet.has(m.id) ? ('FREE' as const) : ('PRO' as const),
                isDefault: false,
                group: p.displayName,
                hint: p.displayName,
              }))
          );

        return NextResponse.json({
          provider: tierConfig.aiProvider,
          readOnly: false,
          userPlan: 'PRO',
          isByok: false,
          adminViewMode: autoConfig.adminViewMode,
          models: sortModels(platformModels),
        }, { headers: CACHE_HEADERS });
      }

      const platformModels = getAllAiProviderMeta()
        .filter((p) => process.env[PLATFORM_PROVIDER_ENV[p.id] ?? ''])
        .flatMap((p) =>
          p.models.map((m) => ({
            id: m.id,
            displayName: m.displayName,
            tier: m.tier,
            requiredPlan: m.requiredPlan,
            isDefault: false,
            group: p.displayName,
            hint: p.displayName,
          }))
        );

      return NextResponse.json({
        provider: tierConfig.aiProvider,
        readOnly: false,
        userPlan: 'PRO',
        isByok: false,
        adminViewMode: autoConfig.adminViewMode,
        models: sortModels([...platformModels, ...claudeCodeModels]),
      }, { headers: CACHE_HEADERS });
    }

    // Free/Pro non-BYOK: filter to only included models with dynamic requiredPlan
    const { freeModels, proModels } = resolveIncludedModels(autoConfig);
    const freeSet = new Set(freeModels);
    const proSet = new Set(proModels);

    const platformModels = getAllAiProviderMeta()
      .filter((p) => p.id !== 'claude-code' && process.env[PLATFORM_PROVIDER_ENV[p.id] ?? ''])
      .flatMap((p) =>
        p.models
          .filter((m) => proSet.has(m.id))
          .map((m) => ({
            id: m.id,
            displayName: m.displayName,
            tier: m.tier,
            requiredPlan: freeSet.has(m.id) ? ('FREE' as const) : ('PRO' as const),
            isDefault: false,
            group: p.displayName,
            hint: p.displayName,
          }))
      );

    return NextResponse.json({
      provider: tierConfig.aiProvider,
      readOnly: false,
      userPlan,
      isByok: false,
      models: sortModels([...platformModels, ...claudeCodeModels]),
    }, { headers: CACHE_HEADERS });
  }

  // BYOK keys present — filter through AutoModelConfig (same as non-BYOK)
  // Admins in free view bypass the filter and see all models
  const seenProviders = new Set<string>();
  const uniqueKeys = validKeys.filter((key) => {
    if (seenProviders.has(key.provider)) return false;
    seenProviders.add(key.provider);
    return true;
  });
  const defaultProvider = getAiProviderMeta(uniqueKeys[0].provider as AiProviderId);

  const autoConfig = await getAutoModelConfig();
  const adminFreeView = isAdmin && autoConfig.adminViewMode !== 'PRO';

  if (adminFreeView) {
    // Admin free view: show all BYOK provider models unfiltered
    const byokModels = uniqueKeys.flatMap((key) => {
      const p = getAiProviderMeta(key.provider as AiProviderId);
      return p.models.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        tier: m.tier,
        requiredPlan: m.requiredPlan,
        isDefault: false,
        group: p.displayName,
        hint: p.displayName,
      }));
    });

    return NextResponse.json({
      provider: defaultProvider.id,
      readOnly: false,
      userPlan,
      isByok: true,
      adminViewMode: autoConfig.adminViewMode,
      models: sortModels([...byokModels, ...claudeCodeModels]),
    }, { headers: CACHE_HEADERS });
  }

  // Everyone else (including admin PRO view): filter to AutoModelConfig included models
  const { freeModels, proModels } = resolveIncludedModels(autoConfig);
  const freeSet = new Set(freeModels);
  const proSet = new Set(proModels);

  const byokModels = uniqueKeys.flatMap((key) => {
    const p = getAiProviderMeta(key.provider as AiProviderId);
    return p.models
      .filter((m) => proSet.has(m.id))
      .map((m) => ({
        id: m.id,
        displayName: m.displayName,
        tier: m.tier,
        requiredPlan: freeSet.has(m.id) ? ('FREE' as const) : ('PRO' as const),
        isDefault: false,
        group: p.displayName,
        hint: p.displayName,
      }));
  });

  return NextResponse.json({
    provider: defaultProvider.id,
    readOnly: false,
    userPlan,
    isByok: true,
    models: sortModels([...byokModels, ...claudeCodeModels]),
  }, { headers: CACHE_HEADERS });
}
