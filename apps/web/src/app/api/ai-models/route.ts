import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { listAiProviders } from '@/lib/byok';
import { getAiProviderMeta, type AiProviderId } from '@/lib/providers/ai-registry';
import { getFreeTierConfig } from '@/lib/free-tier-config';

const CLAUDE_CODE_MODELS = [
  { id: 'claude-code:haiku', displayName: 'Haiku 4.5', tier: 'fast', isDefault: false, group: 'Claude Code (Local)' },
  { id: 'claude-code:sonnet', displayName: 'Sonnet 4.5', tier: 'balanced', isDefault: false, group: 'Claude Code (Local)' },
  { id: 'claude-code:opus', displayName: 'Opus 4.6', tier: 'best', isDefault: false, group: 'Claude Code (Local)' },
];

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const isAdmin = session.user.role === 'ADMIN';
  const aiKeys = await listAiProviders(session.user.id);
  const validKeys = aiKeys.filter((k) => k.isValid);

  // No BYOK AI key
  if (validKeys.length === 0) {
    const config = await getFreeTierConfig();
    const provider = getAiProviderMeta(config.aiProvider);
    const freeTierModel = provider.models.find((m) => m.id === config.aiModel);

    const models = freeTierModel
      ? [{ id: freeTierModel.id, displayName: freeTierModel.displayName, tier: freeTierModel.tier, isDefault: true }]
      : [];

    // Admins get claude-code models even without BYOK keys, and dropdown stays interactive
    if (isAdmin) {
      return NextResponse.json({
        provider: provider.id,
        readOnly: false,
        models: [...models, ...CLAUDE_CODE_MODELS],
      });
    }

    return NextResponse.json({
      provider: provider.id,
      readOnly: true,
      models,
    });
  }

  // Return models for the user's BYOK AI provider
  const primaryKey = validKeys[0];
  const provider = getAiProviderMeta(primaryKey.provider as AiProviderId);

  const byokModels = provider.models.map((m) => ({
    id: m.id,
    displayName: m.displayName,
    tier: m.tier,
    isDefault: m.id === provider.defaultModel,
  }));

  return NextResponse.json({
    provider: provider.id,
    readOnly: false,
    models: isAdmin ? [...byokModels, ...CLAUDE_CODE_MODELS] : byokModels,
  });
}
