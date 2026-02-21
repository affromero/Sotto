import { auth } from '@/lib/auth';
import { listByokProviders, listAiProviders } from '@/lib/byok';
import { getAllAiProviderMeta } from '@/lib/providers/ai-registry';
import { getAllProviderMeta } from '@/lib/providers/tts-registry';
import { getAllSttProviderMeta } from '@/lib/providers/stt-registry';
import { ModelTestPanel } from './ModelTestPanel';
import styles from './page.module.css';

export type TestableProvider = {
  category: 'ai' | 'tts' | 'stt';
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  tier: string;
  hasPlatformKey: boolean;
  hasByokKey: boolean;
};

function hasPlatformKey(category: 'ai' | 'tts' | 'stt', providerId: string): boolean {
  if (category === 'ai') {
    switch (providerId) {
      case 'anthropic': return !!process.env.ANTHROPIC_API_KEY;
      case 'openai': return !!process.env.OPENAI_API_KEY;
      case 'groq': return !!process.env.GROQ_API_KEY;
      case 'claude-code': return process.env.AI_PROVIDER === 'claude-code';
      default: return false;
    }
  }
  if (category === 'tts') {
    switch (providerId) {
      case 'elevenlabs': return !!process.env.ELEVENLABS_API_KEY;
      case 'openai': return !!process.env.OPENAI_API_KEY;
      case 'playht': return !!(process.env.PLAYHT_API_KEY && process.env.PLAYHT_USER_ID);
      case 'cartesia': return !!process.env.CARTESIA_API_KEY;
      case 'hume': return !!process.env.HUME_API_KEY;
      case 'fal': return !!process.env.FAL_KEY;
      case 'replicate': return !!process.env.REPLICATE_API_TOKEN;
      case 'kittentts': return !!process.env.KITTENTTS_URL;
      default: return false;
    }
  }
  if (category === 'stt') {
    switch (providerId) {
      case 'openai': return !!process.env.OPENAI_API_KEY;
      case 'groq': return !!process.env.GROQ_API_KEY;
      case 'elevenlabs': return !!process.env.ELEVENLABS_API_KEY;
      default: return false;
    }
  }
  return false;
}

function hasByokKey(
  category: 'ai' | 'tts' | 'stt',
  providerId: string,
  aiSet: Set<string>,
  ttsSet: Set<string>
): boolean {
  if (category === 'ai') return aiSet.has(providerId);
  if (category === 'tts') return ttsSet.has(providerId);
  if (category === 'stt') {
    if (providerId === 'openai' || providerId === 'groq') return aiSet.has(providerId);
    if (providerId === 'elevenlabs') return ttsSet.has('elevenlabs');
  }
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

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Model Tester</h1>
        <p className={styles.subtitle}>
          Smoke-test all AI, TTS, and STT models — shows only providers with configured keys
        </p>
      </div>

      <ModelTestPanel
        aiProviders={aiProviders}
        ttsProviders={ttsProviders}
        sttProviders={sttProviders}
      />
    </div>
  );
}
