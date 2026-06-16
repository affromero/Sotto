import { auth } from '@/lib/auth';
import { getAutoModelConfig } from '@/lib/auto-model-config';
import { getAllAiProviderMeta } from '@/lib/providers/ai-registry';
import { getAllProviderMeta } from '@/lib/providers/tts-registry';
import { getAllSttProviderMeta } from '@/lib/providers/stt-registry';
import { getTestableProviders } from '@/lib/admin/testable-providers';
import { Glyph } from '@/components/Glyph';
import { ProvidersTabs } from './ProvidersTabs';
import styles from '../../adminTheme.module.css';

export const metadata = { title: 'Providers & models · Sotto admin' };

export default async function AdminProvidersPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const [config, testable] = await Promise.all([
    getAutoModelConfig(),
    getTestableProviders(userId),
  ]);

  // STT-only providers live in the AI registry for the key store but are not
  // language models — keep them out of the "Language model" picker.
  const STT_ONLY_AI = new Set(['deepgram', 'assemblyai', 'together', 'gladia', 'speechmatics']);
  const aiProviders = getAllAiProviderMeta()
    .filter((p) => !STT_ONLY_AI.has(p.id))
    .map((p) => ({
      id: p.id,
      displayName: p.displayName,
      models: p.models.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        tier: m.tier,
        price: m.pricing
          ? `$${m.pricing.inputPerMTok}/$${m.pricing.outputPerMTok} per MTok`
          : undefined,
      })),
    }));

  const ttsProviders = getAllProviderMeta().map((p) => ({
    id: p.id,
    displayName: p.displayName,
    models: p.models.map((m) => ({ id: m.id, displayName: m.displayName, tier: m.tier })),
  }));

  const sttProviders = getAllSttProviderMeta().map((p) => ({
    id: p.id,
    displayName: p.displayName,
    models: p.models.map((m) => ({ id: m.id, displayName: m.displayName, tier: m.tier })),
  }));

  return (
    <>
      <div className={styles.adminHead}>
        <div>
          <h1>Providers &amp; models</h1>
          <div className={styles.ahSub}>
            Bring your own keys · choose defaults per task · test before you save
          </div>
        </div>
      </div>

      <ProvidersTabs
        autoModels={{ initialConfig: config, aiProviders, ttsProviders, sttProviders }}
        testable={{
          aiProviders: testable.ai,
          ttsProviders: testable.tts,
          sttProviders: testable.stt,
        }}
      />

      <div className={styles.note}>
        <div className={styles.noteTitle}>
          <Glyph name="lock" size={14} /> Platform operations
        </div>
        <p>
          A dedicated AI model runs internal tasks without learner context (handle screening,
          credential lookup, language detection). Set it in the model defaults above; it can be
          more capable than the learner-facing default.
        </p>
      </div>
    </>
  );
}
