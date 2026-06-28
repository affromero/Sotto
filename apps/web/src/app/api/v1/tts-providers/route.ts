import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { getAllProviderMeta } from '@/lib/providers/tts-registry';
import { listByokProviders } from '@/lib/byok';

export async function GET(request: NextRequest) {
  const authed = await authenticateRequest(request);

  const allProviders = getAllProviderMeta().map((meta) => ({
    id: meta.id,
    displayName: meta.displayName,
    qualityTier: meta.qualityTier,
    supportsSfx: meta.supportsSfx,
    supportsStreaming: meta.supportsStreaming,
    languageDetection: meta.languageDetection,
    voicesAreCrossLingual: meta.voicesAreCrossLingual,
    models: meta.models.map((model) => ({
      id: model.id,
      displayName: model.displayName,
      tier: model.tier,
      supportedLanguages: [...model.supportedLanguages],
    })),
    authFields: meta.auth.fields.map((f) => ({
      key: f.key,
      label: f.label,
      placeholder: f.placeholder,
      type: f.type,
      optional: f.optional,
    })),
    usageAllowance: meta.usageAllowance,
  }));

  // If authenticated, also include which providers the user has keys for
  let configuredProviders: string[] = [];
  if (authed) {
    const userId = authed.userId;
    const keys = await listByokProviders(userId);
    configuredProviders = keys.filter((k) => k.isValid).map((k) => k.provider);
  }

  return NextResponse.json({ providers: allProviders, configuredProviders });
}
