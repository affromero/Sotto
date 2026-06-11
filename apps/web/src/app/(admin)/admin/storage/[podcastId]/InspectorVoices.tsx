import type { TtsProviderMeta } from '@/lib/providers/tts-registry';
import styles from './page.module.css';

interface VoiceAssignment {
  speaker: string;
  voiceId: string | null;
  provider: string | null;
  resolvedName: string | null;
}

interface InspectorVoicesProps {
  voiceAssignments: VoiceAssignment[];
  providerMeta: TtsProviderMeta[];
}

export function InspectorVoices({
  voiceAssignments,
  providerMeta,
}: InspectorVoicesProps) {
  return (
    <>
      {/* Voice Assignments */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Voice Assignments ({voiceAssignments.length})</h2>
        {voiceAssignments.length === 0 ? (
          <p className={styles.empty}>No voice assignments.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Speaker</th>
                <th>Voice</th>
                <th>Provider</th>
                <th>Voice ID</th>
              </tr>
            </thead>
            <tbody>
              {voiceAssignments.map((v) => (
                <tr key={v.speaker}>
                  <td>{v.speaker}</td>
                  <td>{v.resolvedName ?? '—'}</td>
                  <td>{v.provider ?? '—'}</td>
                  <td><code>{v.voiceId ?? '—'}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Available TTS Providers */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Available TTS Providers ({providerMeta.length})</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Quality</th>
              <th>Models</th>
              <th>SFX</th>
              <th>Cloning</th>
              <th>Streaming</th>
              <th>Cost/1K chars</th>
            </tr>
          </thead>
          <tbody>
            {providerMeta.map((p) => (
              <tr key={p.id}>
                <td>{p.displayName}</td>
                <td>{p.qualityTier}</td>
                <td>{p.models.map((m) => m.displayName).join(', ')}</td>
                <td>{p.supportsSfx ? 'Yes' : 'No'}</td>
                <td>{p.supportsVoiceCloning ? 'Yes' : 'No'}</td>
                <td>{p.supportsStreaming ? 'Yes' : 'No'}</td>
                <td>${p.platformCostPerKChar.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
