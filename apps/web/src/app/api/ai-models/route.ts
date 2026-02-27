import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { listAiProviders } from '@/lib/byok';
import { getAllAiProviderMeta, getAiProviderMeta, type AiProviderId } from '@/lib/providers/ai-registry';
import { resolveAutoModel } from '@/lib/auto-model-config';
import { isClaudeAvailable } from '@/lib/claude-code-client';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
// Env var names for each platform-level AI provider key
const PLATFORM_PROVIDER_ENV: Partial<Record<AiProviderId, string>> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
};

const CLAUDE_CODE_MODELS = [
  { id: 'claude-code:haiku', displayName: 'Haiku 4.5', tier: 'fast', requiredPlan: 'FREE' as const, isDefault: false, group: 'Claude Code (Local)' },
  { id: 'claude-code:sonnet', displayName: 'Sonnet 4.6', tier: 'balanced', requiredPlan: 'PRO' as const, isDefault: false, group: 'Claude Code (Local)' },
  { id: 'claude-code:opus', displayName: 'Opus 4.6', tier: 'best', requiredPlan: 'PRO' as const, isDefault: false, group: 'Claude Code (Local)' },
];

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const isAdmin = session.user.role === 'ADMIN';
  const [aiKeys, claudeAvailable, user] = await Promise.all([
    listAiProviders(session.user.id),
    isAdmin ? isClaudeAvailable() : Promise.resolve(false),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { plan: true } }),
  ]);
  const validKeys = aiKeys.filter((k) => k.isValid);
  const claudeCodeModels = claudeAvailable ? CLAUDE_CODE_MODELS : [];
  const userPlan = (user?.plan ?? 'FREE') as 'FREE' | 'PRO';
  const isByok = validKeys.length > 0;

  // No BYOK AI key
  if (!isByok) {
    const autoConfig = await resolveAutoModel(userPlan);

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
            group: `${p.displayName} (API)`,
          }))
        );

      return NextResponse.json({
        provider: autoConfig.aiProvider,
        readOnly: false,
        userPlan: 'PRO',
        isByok: false,
        models: [...platformModels, ...claudeCodeModels],
      });
    }

    // Free/Pro non-BYOK: show all platform models so users see what's available
    // Pro models are locked for free users (client handles disabling via requiredPlan + userPlan)
    const platformModels = getAllAiProviderMeta()
      .filter((p) => p.id !== 'groq' && p.id !== 'claude-code' && process.env[PLATFORM_PROVIDER_ENV[p.id] ?? ''])
      .flatMap((p) =>
        p.models.map((m) => ({
          id: m.id,
          displayName: m.displayName,
          tier: m.tier,
          requiredPlan: m.requiredPlan,
          isDefault: false,
          group: `${p.displayName} (API)`,
        }))
      );

    return NextResponse.json({
      provider: autoConfig.aiProvider,
      readOnly: false,
      userPlan,
      isByok: false,
      models: platformModels,
    });
  }

  // BYOK keys present — show models for every valid provider, grouped by provider name
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
      group: `${p.displayName} (API)`,
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
