import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getAllProviderMeta } from '@/lib/providers/tts-registry';
import { listByokProviders } from '@/lib/byok';

export async function GET() {
  const session = await auth();

  const allProviders = getAllProviderMeta().map((meta) => ({
    id: meta.id,
    displayName: meta.displayName,
    qualityTier: meta.qualityTier,
    supportsSfx: meta.supportsSfx,
    supportsVoiceCloning: meta.supportsVoiceCloning,
    supportsStreaming: meta.supportsStreaming,
    authFields: meta.auth.fields.map((f) => ({
      key: f.key,
      label: f.label,
      placeholder: f.placeholder,
    })),
  }));

  // If authenticated, also include which providers the user has keys for
  let configuredProviders: string[] = [];
  if (session?.user?.id) {
    const keys = await listByokProviders(session.user.id);
    configuredProviders = keys.filter((k) => k.isValid).map((k) => k.provider);
  }

  return NextResponse.json({ providers: allProviders, configuredProviders });
}
