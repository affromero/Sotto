import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { listAiProviders } from '@/lib/byok';
import { getAllAiProviderMeta, getAiProviderMeta, type AiProviderId } from '@/lib/providers/ai-registry';
import { getFreeTierConfig } from '@/lib/free-tier-config';
import { isClaudeAvailable } from '@/lib/claude-code-client';

import { errorResponse } from '@/lib/api-response';
// Env var names for each platform-level AI provider key
const PLATFORM_PROVIDER_ENV: Partial<Record<AiProviderId, string>> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
};

const CLAUDE_CODE_MODELS = [
  { id: 'claude-code:haiku', displayName: 'Haiku 4.5', tier: 'fast', isDefault: false, group: 'Claude Code (Local)' },
  { id: 'claude-code:sonnet', displayName: 'Sonnet 4.6', tier: 'balanced', isDefault: false, group: 'Claude Code (Local)' },
  { id: 'claude-code:opus', displayName: 'Opus 4.6', tier: 'best', isDefault: false, group: 'Claude Code (Local)' },
];

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const isAdmin = session.user.role === 'ADMIN';
  const [aiKeys, claudeAvailable] = await Promise.all([
    listAiProviders(session.user.id),
    isAdmin ? isClaudeAvailable() : Promise.resolve(false),
  ]);
  const validKeys = aiKeys.filter((k) => k.isValid);
  const claudeCodeModels = claudeAvailable ? CLAUDE_CODE_MODELS : [];

  // No BYOK AI key
  if (validKeys.length === 0) {
    const config = await getFreeTierConfig();

    // Admins see all platform-configured API providers (from env vars) + Claude Code local
    if (isAdmin) {
      const platformModels = getAllAiProviderMeta()
        .filter((p) => p.id !== 'groq' && process.env[PLATFORM_PROVIDER_ENV[p.id] ?? ''])
        .flatMap((p) =>
          p.models.map((m) => ({
            id: m.id,
            displayName: m.displayName,
            tier: m.tier,
            isDefault: m.id === config.aiModel && config.aiProvider === p.id,
            group: `${p.displayName} (API)`,
          }))
        );

      return NextResponse.json({
        provider: config.aiProvider,
        readOnly: false,
        models: [...platformModels, ...claudeCodeModels],
      });
    }

    // Non-admins: single free-tier model, read-only
    const provider = getAiProviderMeta(config.aiProvider);
    const freeTierModel = provider.models.find((m) => m.id === config.aiModel);
    const models = freeTierModel
      ? [{ id: freeTierModel.id, displayName: freeTierModel.displayName, tier: freeTierModel.tier, isDefault: true }]
      : [];

    return NextResponse.json({ provider: provider.id, readOnly: true, models });
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
      isDefault: m.id === defaultProvider.defaultModel && key.provider === uniqueKeys[0].provider,
      group: `${p.displayName} (API)`,
    }));
  });

  return NextResponse.json({
    provider: defaultProvider.id,
    readOnly: false,
    models: isAdmin ? [...byokModels, ...claudeCodeModels] : byokModels,
  });
}
