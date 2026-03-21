import { type CompletenessDimension } from '@/lib/data-completeness';
import styles from './page.module.css';

interface ScriptTurn {
  speaker: string;
  text: string;
}

interface InspectorContentProps {
  podcast: {
    id: string;
    title: string;
    status: string;
    createdAt: Date;
    aiProvider: string | null;
    aiModel: string | null;
    ttsProvider: string | null;
    ttsModel: string | null;
    sttProvider: string | null;
    sttModel: string | null;
    playCount: number;
    likeCount: number;
    forkCount: number;
    saveCount: number;
    commentCount: number;
    user: { name: string | null; email: string | null } | null;
  };
  script: {
    turns: ScriptTurn[];
    wordCount: number;
    soundCueCount: number;
    verificationAttempts: number;
  } | null;
  r2Files: { key: string; sizeBytes: number; lastModified: Date | undefined }[];
  references: {
    total: number;
    byStatus: Record<string, number>;
  };
  segments: {
    total: number;
    withAudio: number;
    withoutAudio: number;
    durationRange: { min: number; max: number } | null;
    totalDuration: number;
  };
  interactions: {
    total: number;
    byStatus: Record<string, number>;
    incorporatedCount: number;
  };
  discovery: {
    messageCount: number;
    topic: string | null;
    depth: string | null;
    audience: string | null;
    tone: string | null;
    focusAreas: string[];
  } | null;
  tags: { name: string; slug: string }[];
  ratings: {
    count: number;
    avgOverall: number;
    avgVoice: number;
    avgAccuracy: number;
    avgFlow: number;
  } | null;
  apiCosts: {
    totalCost: number;
    callCount: number;
    text: number;
    audio: number;
    video: number;
    avatar: number;
  };
  pipelineEvents: Record<string, number>;
  mlFeatures: {
    avgCompletionRate: number;
    totalUniqueListeners: number;
    totalListenMinutes: number;
    relistenRate: number;
  } | null;
  completeness: {
    score: number;
    maxScore: number;
    dimensions: CompletenessDimension[];
  };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i > 1 ? 2 : 0)} ${units[i]}`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

function statusBadgeClass(status: string): string {
  if (status === 'READY') return styles.statusReady;
  if (status === 'FAILED') return styles.statusFailed;
  if (status === 'PENDING') return styles.statusPending;
  return styles.statusOther;
}

export function InspectorContent({
  podcast,
  script,
  r2Files,
  references,
  segments,
  interactions,
  discovery,
  tags,
  ratings,
  apiCosts,
  pipelineEvents,
  mlFeatures,
  completeness,
}: InspectorContentProps) {
  return (
    <>
      {/* Header */}
      <section className={styles.section}>
        <div className={styles.header}>
          <h1 className={styles.title}>{podcast.title}</h1>
          <p className={styles.subtitle}>
            <span className={statusBadgeClass(podcast.status)}>{podcast.status}</span>
          </p>
          <p className={styles.podcastMeta}>
            ID: <code>{podcast.id}</code>
            {podcast.user && <> &middot; Creator: {podcast.user.name ?? podcast.user.email}</>}
            {' '}&middot;{' '}
            <a href={`/podcast/${podcast.id}`} className={styles.publicLink}>
              View public page
            </a>
          </p>
        </div>
      </section>

      {/* Provider Info */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Provider Info</h2>
        <div className={styles.providerGrid}>
          <div className={styles.card}>
            <span className={styles.cardLabel}>AI</span>
            <span className={styles.cardValue}>
              {[podcast.aiProvider, podcast.aiModel].filter(Boolean).join('/') || 'Not set'}
            </span>
          </div>
          <div className={styles.card}>
            <span className={styles.cardLabel}>TTS</span>
            <span className={styles.cardValue}>
              {[podcast.ttsProvider, podcast.ttsModel].filter(Boolean).join('/') || 'Not set'}
            </span>
          </div>
          <div className={styles.card}>
            <span className={styles.cardLabel}>STT</span>
            <span className={styles.cardValue}>
              {[podcast.sttProvider, podcast.sttModel].filter(Boolean).join('/') || 'Not set'}
            </span>
          </div>
        </div>
      </section>

      {/* R2 Files */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>R2 Files ({r2Files.length})</h2>
        {r2Files.length === 0 ? (
          <p className={styles.empty}>No R2 files found for this podcast.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>File</th>
                <th>Size</th>
                <th>Last Modified</th>
              </tr>
            </thead>
            <tbody>
              {r2Files.map((f) => (
                <tr key={f.key}>
                  <td><code>{f.key.split('/').pop()}</code></td>
                  <td>{formatBytes(f.sizeBytes)}</td>
                  <td>{f.lastModified ? f.lastModified.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Script */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Script</h2>
        {script ? (
          <div className={styles.grid}>
            <div className={styles.card}>
              <span className={styles.cardLabel}>Turns</span>
              <span className={styles.cardValue}>{script.turns.length}</span>
            </div>
            <div className={styles.card}>
              <span className={styles.cardLabel}>Words</span>
              <span className={styles.cardValue}>{script.wordCount.toLocaleString()}</span>
            </div>
            <div className={styles.card}>
              <span className={styles.cardLabel}>Sound Cues</span>
              <span className={styles.cardValue}>{script.soundCueCount}</span>
            </div>
            <div className={styles.card}>
              <span className={styles.cardLabel}>Verification Attempts</span>
              <span className={styles.cardValue}>{script.verificationAttempts}</span>
            </div>
          </div>
        ) : (
          <p className={styles.empty}>No script available.</p>
        )}
      </section>

      {/* References */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>References ({references.total})</h2>
        {references.total === 0 ? (
          <p className={styles.empty}>No references.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Status</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(references.byStatus).map(([status, count]) => (
                <tr key={status}>
                  <td>{status}</td>
                  <td>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Segments */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Segments ({segments.total})</h2>
        {segments.total === 0 ? (
          <p className={styles.empty}>No segments.</p>
        ) : (
          <div className={styles.grid}>
            <div className={styles.card}>
              <span className={styles.cardLabel}>With Audio</span>
              <span className={styles.cardValue}>{segments.withAudio}</span>
            </div>
            <div className={styles.card}>
              <span className={styles.cardLabel}>Without Audio</span>
              <span className={styles.cardValue}>{segments.withoutAudio}</span>
            </div>
            <div className={styles.card}>
              <span className={styles.cardLabel}>Duration Range</span>
              <span className={styles.cardValue}>
                {segments.durationRange
                  ? `${segments.durationRange.min.toFixed(1)}s – ${segments.durationRange.max.toFixed(1)}s`
                  : '—'}
              </span>
            </div>
            <div className={styles.card}>
              <span className={styles.cardLabel}>Total Duration</span>
              <span className={styles.cardValue}>{formatDuration(segments.totalDuration)}</span>
            </div>
          </div>
        )}
      </section>

      {/* Q&A */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Q&A Interactions ({interactions.total})</h2>
        {interactions.total === 0 ? (
          <p className={styles.empty}>No Q&A interactions.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Status</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(interactions.byStatus).map(([status, count]) => (
                <tr key={status}>
                  <td>{status}</td>
                  <td>{count}</td>
                </tr>
              ))}
              <tr>
                <td><strong>Incorporated</strong></td>
                <td><strong>{interactions.incorporatedCount}</strong></td>
              </tr>
            </tbody>
          </table>
        )}
      </section>

      {/* Discovery */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Discovery</h2>
        {discovery ? (
          <div className={styles.grid}>
            <div className={styles.card}>
              <span className={styles.cardLabel}>Messages</span>
              <span className={styles.cardValue}>{discovery.messageCount}</span>
            </div>
            <div className={styles.card}>
              <span className={styles.cardLabel}>Topic</span>
              <span className={styles.cardValue}>{discovery.topic ?? '—'}</span>
            </div>
            <div className={styles.card}>
              <span className={styles.cardLabel}>Depth</span>
              <span className={styles.cardValue}>{discovery.depth ?? '—'}</span>
            </div>
            <div className={styles.card}>
              <span className={styles.cardLabel}>Audience</span>
              <span className={styles.cardValue}>{discovery.audience ?? '—'}</span>
            </div>
            <div className={styles.card}>
              <span className={styles.cardLabel}>Tone</span>
              <span className={styles.cardValue}>{discovery.tone ?? '—'}</span>
            </div>
            {discovery.focusAreas.length > 0 && (
              <div className={styles.card}>
                <span className={styles.cardLabel}>Focus Areas</span>
                <span className={styles.cardValue}>{discovery.focusAreas.join(', ')}</span>
              </div>
            )}
          </div>
        ) : (
          <p className={styles.empty}>No discovery data.</p>
        )}
      </section>

      {/* Tags */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Tags ({tags.length})</h2>
        {tags.length === 0 ? (
          <p className={styles.empty}>No tags.</p>
        ) : (
          <div className={styles.tagList}>
            {tags.map((t) => (
              <span key={t.slug} className={styles.tag}>{t.name} ({t.slug})</span>
            ))}
          </div>
        )}
      </section>

      {/* Engagement */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Engagement</h2>
        <div className={`${styles.grid} ${styles.engagementGrid}`}>
          <div className={styles.card}>
            <span className={styles.cardLabel}>Plays</span>
            <span className={styles.cardValue}>{podcast.playCount.toLocaleString()}</span>
          </div>
          <div className={styles.card}>
            <span className={styles.cardLabel}>Likes</span>
            <span className={styles.cardValue}>{podcast.likeCount.toLocaleString()}</span>
          </div>
          <div className={styles.card}>
            <span className={styles.cardLabel}>Forks</span>
            <span className={styles.cardValue}>{podcast.forkCount.toLocaleString()}</span>
          </div>
          <div className={styles.card}>
            <span className={styles.cardLabel}>Saves</span>
            <span className={styles.cardValue}>{podcast.saveCount.toLocaleString()}</span>
          </div>
          <div className={styles.card}>
            <span className={styles.cardLabel}>Comments</span>
            <span className={styles.cardValue}>{podcast.commentCount.toLocaleString()}</span>
          </div>
        </div>
      </section>

      {/* Ratings */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Ratings</h2>
        {ratings ? (
          <div className={styles.grid}>
            <div className={styles.card}>
              <span className={styles.cardLabel}>Count</span>
              <span className={styles.cardValue}>{ratings.count}</span>
            </div>
            <div className={styles.card}>
              <span className={styles.cardLabel}>Overall</span>
              <span className={styles.cardValue}>{ratings.avgOverall.toFixed(1)}</span>
            </div>
            <div className={styles.card}>
              <span className={styles.cardLabel}>Voice</span>
              <span className={styles.cardValue}>{ratings.avgVoice.toFixed(1)}</span>
            </div>
            <div className={styles.card}>
              <span className={styles.cardLabel}>Accuracy</span>
              <span className={styles.cardValue}>{ratings.avgAccuracy.toFixed(1)}</span>
            </div>
            <div className={styles.card}>
              <span className={styles.cardLabel}>Flow</span>
              <span className={styles.cardValue}>{ratings.avgFlow.toFixed(1)}</span>
            </div>
          </div>
        ) : (
          <p className={styles.empty}>No ratings yet.</p>
        )}
      </section>

      {/* API Costs */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>API Costs</h2>
        <div className={styles.grid}>
          <div className={styles.card}>
            <span className={styles.cardLabel}>Total Cost</span>
            <span className={styles.cardValue}>${apiCosts.totalCost.toFixed(4)}</span>
          </div>
          <div className={styles.card}>
            <span className={styles.cardLabel}>API Calls</span>
            <span className={styles.cardValue}>{apiCosts.callCount.toLocaleString()}</span>
          </div>
          {apiCosts.text > 0 && (
            <div className={styles.card}>
              <span className={styles.cardLabel}>Text (AI)</span>
              <span className={styles.cardValue}>${apiCosts.text.toFixed(4)}</span>
            </div>
          )}
          {apiCosts.audio > 0 && (
            <div className={styles.card}>
              <span className={styles.cardLabel}>Audio (TTS)</span>
              <span className={styles.cardValue}>${apiCosts.audio.toFixed(4)}</span>
            </div>
          )}
          {apiCosts.video > 0 && (
            <div className={styles.card}>
              <span className={styles.cardLabel}>Video</span>
              <span className={styles.cardValue}>${apiCosts.video.toFixed(4)}</span>
            </div>
          )}
          {apiCosts.avatar > 0 && (
            <div className={styles.card}>
              <span className={styles.cardLabel}>Avatar</span>
              <span className={styles.cardValue}>${apiCosts.avatar.toFixed(4)}</span>
            </div>
          )}
        </div>
      </section>

      {/* Pipeline Events */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Pipeline Events</h2>
        {Object.keys(pipelineEvents).length === 0 ? (
          <p className={styles.empty}>No pipeline events recorded.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Type</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(pipelineEvents).map(([type, count]) => (
                <tr key={type}>
                  <td>{type}</td>
                  <td>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ML Features */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>ML Features</h2>
        {mlFeatures ? (
          <div className={styles.grid}>
            <div className={styles.card}>
              <span className={styles.cardLabel}>Avg Completion</span>
              <span className={styles.cardValue}>{((mlFeatures.avgCompletionRate ?? 0) * 100).toFixed(0)}%</span>
            </div>
            <div className={styles.card}>
              <span className={styles.cardLabel}>Unique Listeners</span>
              <span className={styles.cardValue}>{mlFeatures.totalUniqueListeners ?? 0}</span>
            </div>
            <div className={styles.card}>
              <span className={styles.cardLabel}>Listen Minutes</span>
              <span className={styles.cardValue}>{(mlFeatures.totalListenMinutes ?? 0).toFixed(0)}</span>
            </div>
            <div className={styles.card}>
              <span className={styles.cardLabel}>Relisten Rate</span>
              <span className={styles.cardValue}>{((mlFeatures.relistenRate ?? 0) * 100).toFixed(1)}%</span>
            </div>
          </div>
        ) : (
          <p className={styles.empty}>ML features not computed yet.</p>
        )}
      </section>

      {/* Completeness */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          Completeness ({completeness.score}/{completeness.maxScore})
        </h2>
        <div className={styles.completenessGrid}>
          {completeness.dimensions.map((d) => (
            <div key={d.key} className={styles.checkItem}>
              <span className={d.present ? styles.checkPass : styles.checkFail}>
                {d.present ? '\u2713' : '\u2717'}
              </span>
              <span className={styles.checkLabel}>{d.label}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
