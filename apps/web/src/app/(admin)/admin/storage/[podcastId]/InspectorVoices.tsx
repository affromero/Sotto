import type { TtsProviderMeta } from '@/lib/providers/tts-registry';
import styles from './page.module.css';

interface VoiceAssignment {
  speaker: string;
  voiceId: string | null;
  provider: string | null;
  resolvedName: string | null;
}

interface VoiceTrackData {
  id: string;
  name: string;
  ttsProvider: string | null;
  ttsModel: string | null;
  status: string;
  segmentCount: number;
  voices: { speaker: string; voiceId: string; provider: string | null }[];
}

interface SegmentVoiceRow {
  order: number;
  speaker: string;
  textExcerpt: string;
  hasAudio: boolean;
  trackSegments: {
    trackId: string;
    trackName: string;
    hasAudio: boolean;
    duration: number | null;
  }[];
}

interface InspectorVoicesProps {
  voiceAssignments: VoiceAssignment[];
  voiceTracks: VoiceTrackData[];
  segmentVoiceMap: SegmentVoiceRow[];
  providerMeta: TtsProviderMeta[];
}

function statusBadgeClass(status: string): string {
  if (status === 'READY') return styles.statusReady;
  if (status === 'FAILED') return styles.statusFailed;
  if (status === 'PENDING' || status === 'GENERATING_AUDIO' || status === 'STITCHING') return styles.statusPending;
  return styles.statusOther;
}

export function InspectorVoices({
  voiceAssignments,
  voiceTracks,
  segmentVoiceMap,
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

      {/* Voice Tracks */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Voice Tracks ({voiceTracks.length})</h2>
        {voiceTracks.length === 0 ? (
          <p className={styles.empty}>No voice tracks.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>TTS Provider</th>
                <th>Status</th>
                <th>Segments</th>
                <th>Voices</th>
              </tr>
            </thead>
            <tbody>
              {voiceTracks.map((vt) => (
                <tr key={vt.id}>
                  <td>{vt.name}</td>
                  <td>{[vt.ttsProvider, vt.ttsModel].filter(Boolean).join('/') || '—'}</td>
                  <td><span className={statusBadgeClass(vt.status)}>{vt.status}</span></td>
                  <td>{vt.segmentCount}</td>
                  <td>
                    {vt.voices.length === 0
                      ? '—'
                      : vt.voices.map((v) => `${v.speaker}: ${v.voiceId}`).join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Segment Voice Map */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Segment Voice Map ({segmentVoiceMap.length})</h2>
        {segmentVoiceMap.length === 0 ? (
          <p className={styles.empty}>No segment voice mappings.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Speaker</th>
                <th>Text</th>
                <th>Primary Audio</th>
                {voiceTracks.map((vt) => (
                  <th key={vt.id}>{vt.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {segmentVoiceMap.map((row) => (
                <tr key={row.order}>
                  <td>{row.order}</td>
                  <td>{row.speaker}</td>
                  <td><span className={styles.textExcerpt}>{row.textExcerpt}</span></td>
                  <td>
                    <span className={row.hasAudio ? styles.audioPresent : styles.audioMissing}>
                      {row.hasAudio ? 'Yes' : 'No'}
                    </span>
                  </td>
                  {voiceTracks.map((vt) => {
                    const ts = row.trackSegments.find((t) => t.trackId === vt.id);
                    return (
                      <td key={vt.id}>
                        {ts ? (
                          <>
                            <span className={ts.hasAudio ? styles.audioPresent : styles.audioMissing}>
                              {ts.hasAudio ? 'Yes' : 'No'}
                            </span>
                            {ts.duration !== null && <> ({ts.duration.toFixed(1)}s)</>}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                    );
                  })}
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
