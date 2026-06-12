import { auth } from '@/lib/auth';
import { getTestableProviders } from '@/lib/admin/testable-providers';
import { ModelTestPanel } from './ModelTestPanel';
import styles from './page.module.css';

export default async function AdminModelsPage() {
  const session = await auth();
  const userId = session!.user!.id!;
  const { ai, tts, stt } = await getTestableProviders(userId);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Model Tester</h1>
        <p className={styles.subtitle}>
          Smoke-test all provider models. Shows only providers with configured keys.
        </p>
      </div>

      <ModelTestPanel aiProviders={ai} ttsProviders={tts} sttProviders={stt} />
    </div>
  );
}
