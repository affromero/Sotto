import {
  getFreeTierFunnel,
  getByokAdoption,
  getPipelineHealth,
} from '@/lib/funnel-metrics';
import { getRecentPipelineErrors } from '@/lib/pipeline-events';
import { subDays, startOfDay } from 'date-fns';
import Link from 'next/link';
import styles from './page.module.css';

interface PageProps {
  searchParams: Promise<{ range?: string }>;
}

function formatSeconds(seconds: number | null): string {
  if (seconds === null) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

export default async function AdminPipelinePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rangeParam = params.range ?? '30';
  const days = [7, 30, 90].includes(Number(rangeParam)) ? Number(rangeParam) : 30;
  const since = subDays(startOfDay(new Date()), days);

  const [funnel, adoption, pipeline, recentErrors] = await Promise.all([
    getFreeTierFunnel(),
    getByokAdoption(),
    getPipelineHealth(since),
    getRecentPipelineErrors(20),
  ]);

  const funnelMax = Math.max(funnel.freeGenUsers, funnel.exhaustedUsers, funnel.byokUsers, 1);
  const maxAi = Math.max(...adoption.ai.map((a) => a.count), 1);
  const maxTts = Math.max(...adoption.tts.map((t) => t.count), 1);

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <div className={styles.header}>
          <h1 className={styles.title}>Pipeline &amp; BYOK</h1>
          <p className={styles.subtitle}>Generation pipeline health and BYOK conversion funnel</p>
        </div>
        <nav className={styles.rangeNav} aria-label="Time range">
          {[7, 30, 90].map((d) => (
            <a
              key={d}
              href={`/admin/pipeline?range=${d}`}
              className={`${styles.rangeLink} ${days === d ? styles.rangeLinkActive : ''}`}
              aria-current={days === d ? 'page' : undefined}
            >
              {d}d
            </a>
          ))}
        </nav>
      </div>

      {/* BYOK funnel */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>BYOK Conversion Funnel</h2>
        <div className={styles.grid}>
          <div className={styles.card}>
            <span className={styles.cardLabel}>Free Tier Users</span>
            <span className={styles.cardValue}>{funnel.freeGenUsers.toLocaleString()}</span>
          </div>
          <div className={styles.card}>
            <span className={styles.cardLabel}>Exhausted Free Tier</span>
            <span className={styles.cardValue}>{funnel.exhaustedUsers.toLocaleString()}</span>
          </div>
          <div className={styles.card}>
            <span className={styles.cardLabel}>BYOK Converted</span>
            <span className={styles.cardValue}>{funnel.byokUsers.toLocaleString()}</span>
          </div>
          <div className={styles.card}>
            <span className={styles.cardLabel}>Conversion Rate</span>
            <span className={styles.cardValue}>{Math.round(funnel.conversionRate * 100)}%</span>
          </div>
        </div>
        <div className={styles.funnelContainer}>
          {[
            { label: 'Used free tier', value: funnel.freeGenUsers },
            { label: 'Exhausted limit', value: funnel.exhaustedUsers },
            { label: 'Added BYOK keys', value: funnel.byokUsers },
          ].map((step) => (
            <div key={step.label} className={styles.funnelStep}>
              <span className={styles.funnelValue}>{step.value.toLocaleString()}</span>
              <div
                className={styles.funnelBar}
                style={{ width: `${(step.value / funnelMax) * 100}%` }}
              />
              <span className={styles.funnelLabel}>{step.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* BYOK adoption */}
      <div className={styles.columns}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>AI Provider Adoption</h2>
          {adoption.ai.length === 0 ? (
            <p className={styles.empty}>No AI keys yet.</p>
          ) : (
            <div className={styles.hBarContainer}>
              {adoption.ai.map((a) => (
                <div key={a.provider} className={styles.hBarRow}>
                  <span className={styles.hBarLabel}>{a.provider}</span>
                  <div className={styles.hBarTrack}>
                    <div
                      className={styles.hBarFill}
                      style={{ width: `${(a.count / maxAi) * 100}%` }}
                    />
                  </div>
                  <span className={styles.hBarValue}>{a.count}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>TTS Provider Adoption</h2>
          {adoption.tts.length === 0 ? (
            <p className={styles.empty}>No TTS keys yet.</p>
          ) : (
            <div className={styles.hBarContainer}>
              {adoption.tts.map((t) => (
                <div key={t.provider} className={styles.hBarRow}>
                  <span className={styles.hBarLabel}>{t.provider}</span>
                  <div className={styles.hBarTrack}>
                    <div
                      className={styles.hBarFillAccent}
                      style={{ width: `${(t.count / maxTts) * 100}%` }}
                    />
                  </div>
                  <span className={styles.hBarValue}>{t.count}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Pipeline health */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Pipeline Health</h2>
        <div className={styles.grid}>
          <div className={styles.card}>
            <span className={styles.cardLabel}>Success Rate</span>
            <span className={styles.cardValue}>
              {Math.round((1 - pipeline.failureRate) * 100)}%
            </span>
          </div>
          <div className={styles.card}>
            <span className={styles.cardLabel}>Failure Rate</span>
            <span className={styles.cardValue}>
              {Math.round(pipeline.failureRate * 100)}%
            </span>
          </div>
          <div className={styles.card}>
            <span className={styles.cardLabel}>Avg Time to Ready</span>
            <span className={styles.cardValue}>
              {formatSeconds(pipeline.avgTimeToReadySeconds)}
            </span>
          </div>
          <div className={styles.card}>
            <span className={styles.cardLabel}>Total Attempted</span>
            <span className={styles.cardValue}>{pipeline.totalAttempted.toLocaleString()}</span>
          </div>
        </div>
      </section>

      {/* Failed-at-stage table */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Failures by Pipeline Stage</h2>
        {pipeline.failedAtStage.length === 0 ? (
          <p className={styles.empty}>No pipeline failures in this period.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Stage</th>
                <th>Failures</th>
              </tr>
            </thead>
            <tbody>
              {pipeline.failedAtStage.map((s) => (
                <tr key={s.stage}>
                  <td>{s.stage}</td>
                  <td>{s.count.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Recent failures */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Recent Failures</h2>
        {recentErrors.length === 0 ? (
          <p className={styles.empty}>No pipeline events recorded yet.</p>
        ) : (
          <div className={styles.tableContainer}>
            <table className={styles.recentTable}>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Podcast</th>
                  <th>Stage</th>
                  <th>Type</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {recentErrors.map((evt) => (
                  <tr key={evt.id}>
                    <td className={styles.dateCell}>
                      {new Date(evt.createdAt).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </td>
                    <td>
                      <Link href={`/podcast/${evt.podcastId}`} className={styles.podcastLink}>
                        {evt.podcastTitle}
                      </Link>
                    </td>
                    <td>{evt.stage}</td>
                    <td>
                      <span className={evt.type === 'error' ? styles.badgeError : styles.badgeRetry}>
                        {evt.type}
                      </span>
                    </td>
                    <td className={styles.errorCell}>{evt.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
