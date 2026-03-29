import { execSync } from 'child_process';
import { auth } from '@/lib/auth';
import { listByokProviders, listAiProviders } from '@/lib/byok';
import { getAllAiProviderMeta } from '@/lib/providers/ai-registry';
import { getAllProviderMeta } from '@/lib/providers/tts-registry';
import { getAllSttProviderMeta } from '@/lib/providers/stt-registry';
import { getPlatformTtsKey } from '@/lib/tts-generation';
import { getAllImageProviderMeta } from '@/lib/providers/image-registry';
import { getAllVideoProviderMeta } from '@/lib/providers/video-registry';
import { getAllAvatarProviderMeta } from '@/lib/providers/avatar-registry';
import { getAllMusicProviderMeta } from '@/lib/providers/music-registry';
import { ModelTestPanel } from './ModelTestPanel';
import styles from './page.module.css';

function isClaudeCliAvailable(): boolean {
  try {
    execSync('claude --version', { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

export type TestableProvider = {
  category: 'ai' | 'tts' | 'stt' | 'image' | 'video' | 'avatar' | 'music';
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  tier: string;
  hasPlatformKey: boolean;
  hasByokKey: boolean;
  disabled?: boolean;
  disabledReason?: string;
};

function hasPlatformKey(category: TestableProvider['category'], providerId: string): boolean {
  if (category === 'ai') {
    switch (providerId) {
      case 'anthropic': return !!process.env.ANTHROPIC_API_KEY;
      case 'openai': return !!process.env.OPENAI_API_KEY;
      case 'google': return !!process.env.GOOGLE_AI_API_KEY;
      case 'claude-code': return isClaudeCliAvailable();
      default: return false;
    }
  }
  if (category === 'tts') {
    return !!getPlatformTtsKey(providerId as import('@/lib/providers/tts-registry').TtsProviderId);
  }
  if (category === 'stt') {
    switch (providerId) {
      case 'openai': return !!process.env.OPENAI_API_KEY;
      case 'elevenlabs': return !!process.env.ELEVENLABS_API_KEY;
      case 'together': return !!process.env.TOGETHER_API_KEY;
      case 'deepgram': return !!process.env.DEEPGRAM_API_KEY;
      case 'assemblyai': return !!process.env.ASSEMBLYAI_API_KEY;
      default: return false;
    }
  }
  if (category === 'image') {
    return !!process.env.FAL_KEY;
  }
  if (category === 'video') {
    switch (providerId) {
      case 'fal': return !!process.env.FAL_KEY;
      case 'minimax': return !!process.env.MINIMAX_API_KEY;
      default: return false;
    }
  }
  if (category === 'avatar') {
    switch (providerId) {
      case 'heygen': return !!process.env.HEYGEN_API_KEY;
      case 'fal': return !!process.env.FAL_KEY;
      case 'runway': return !!process.env.RUNWAY_API_KEY;
      default: return false;
    }
  }
  if (category === 'music') {
    switch (providerId) {
      case 'suno': return !!process.env.SUNO_API_KEY;
      case 'elevenlabs': return !!process.env.ELEVENLABS_API_KEY;
      default: return false;
    }
  }
  return false;
}

function hasByokKey(
  category: TestableProvider['category'],
  providerId: string,
  aiSet: Set<string>,
  ttsSet: Set<string>
): boolean {
  if (category === 'ai') return aiSet.has(providerId);
  if (category === 'tts') return ttsSet.has(providerId);
  if (category === 'stt') {
    if (providerId === 'openai' || providerId === 'together' || providerId === 'deepgram' || providerId === 'assemblyai') return aiSet.has(providerId);
    if (providerId === 'elevenlabs') return ttsSet.has('elevenlabs');
  }
  // Image, video, avatar, music — BYOK keys stored in UserTtsKey
  if (category === 'image') return ttsSet.has('fal');
  if (category === 'video') return ttsSet.has(providerId);
  if (category === 'avatar') return ttsSet.has(providerId);
  if (category === 'music') return ttsSet.has(providerId);
  return false;
}

export default async function AdminModelsPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const [aiKeys, ttsKeys] = await Promise.all([
    listAiProviders(userId),
    listByokProviders(userId),
  ]);

  const aiByokSet = new Set(aiKeys.map((k) => k.provider as string));
  const ttsByokSet = new Set(ttsKeys.map((k) => k.provider as string));

  function withKeyFlags(
    raw: Omit<TestableProvider, 'hasPlatformKey' | 'hasByokKey'>[]
  ): TestableProvider[] {
    return raw
      .map((p) => ({
        ...p,
        hasPlatformKey: hasPlatformKey(p.category, p.providerId),
        hasByokKey: hasByokKey(p.category, p.providerId, aiByokSet, ttsByokSet),
      }))
      .filter((p) => p.hasPlatformKey || p.hasByokKey);
  }

  const aiProviders = withKeyFlags(
    getAllAiProviderMeta().flatMap((p) =>
      p.models.map((m) => ({
        category: 'ai' as const,
        providerId: p.id,
        providerName: p.displayName,
        modelId: m.id,
        modelName: m.displayName,
        tier: m.tier,
      }))
    )
  );

  const ttsProviders = withKeyFlags(
    getAllProviderMeta().flatMap((p) =>
      p.models.map((m) => ({
        category: 'tts' as const,
        providerId: p.id,
        providerName: p.displayName,
        modelId: m.id,
        modelName: m.displayName,
        tier: m.tier,
      }))
    )
  );

  const sttProviders = withKeyFlags(
    getAllSttProviderMeta().flatMap((p) =>
      p.models.map((m) => ({
        category: 'stt' as const,
        providerId: p.id,
        providerName: p.displayName,
        modelId: m.id,
        modelName: m.displayName,
        tier: m.tier,
      }))
    )
  );

  const imageProviders = withKeyFlags(
    getAllImageProviderMeta().flatMap((p) =>
      p.models.map((m) => ({
        category: 'image' as const,
        providerId: p.id,
        providerName: p.displayName,
        modelId: m.id,
        modelName: m.displayName,
        tier: m.tier,
      }))
    )
  );

  const videoProviders = withKeyFlags(
    getAllVideoProviderMeta().flatMap((p) =>
      p.models.map((m) => ({
        category: 'video' as const,
        providerId: p.id,
        providerName: p.displayName,
        modelId: m.id,
        modelName: m.displayName,
        tier: m.tier,
      }))
    )
  );

  const avatarProviders = withKeyFlags(
    getAllAvatarProviderMeta().flatMap((p) =>
      p.models.map((m) => ({
        category: 'avatar' as const,
        providerId: p.id,
        providerName: p.displayName,
        modelId: m.id,
        modelName: m.displayName,
        tier: m.tier,
        disabled: p.disabled,
        disabledReason: p.disabledReason,
      }))
    )
  );

  const musicProviders = withKeyFlags(
    getAllMusicProviderMeta().flatMap((p) =>
      p.models.map((m) => ({
        category: 'music' as const,
        providerId: p.id,
        providerName: p.displayName,
        modelId: m.id,
        modelName: m.displayName,
        tier: m.costPerTrack < 0.08 ? 'standard' : 'high',
      }))
    )
  );

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Model Tester</h1>
        <p className={styles.subtitle}>
          Smoke-test all provider models — shows only providers with configured keys
        </p>
      </div>

      <ModelTestPanel
        aiProviders={aiProviders}
        ttsProviders={ttsProviders}
        sttProviders={sttProviders}
        imageProviders={imageProviders}
        videoProviders={videoProviders}
        avatarProviders={avatarProviders}
        musicProviders={musicProviders}
      />
    </div>
  );
}
