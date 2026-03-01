import {
  getFreeTierFunnel,
  getByokAdoption,
  getPipelineHealth,
  getInProgressPipelines,
  getRecentlySucceeded,
  getDraftAbandonmentMetrics,
  getPerStageTiming,
} from '@/lib/funnel-metrics';
import {
  getRecentPipelineErrors,
  getRecentDiscoveryChatErrors,
  getDiscoveryChatErrorStats,
  type PipelineErrorSortCol,
  type DiscoveryChatErrorSortCol,
} from '@/lib/pipeline-events';
import { getVoiceUsageByProvider, getTopVoices } from '@/lib/voice-metrics';
import { subDays, startOfDay } from 'date-fns';
import Link from 'next/link';
import { CopyButton } from '@/components/admin/CopyButton';
import styles from './page.module.css';

interface PageProps {
  searchParams: Promise<{
    range?: string;
    kind?: string;
    sort?: string;
    sortcol?: string;
    psortcol?: string;
    psortdir?: string;
  }>;
}

function formatSeconds(seconds: number | null): string {
  if (seconds === null) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function parseRange(rangeParam: string): { since: Date; until?: Date; label: string } {
  const today = startOfDay(new Date());
  if (rangeParam === 'today') return { since: today, label: 'Today' };
  if (rangeParam === 'yesterday') {
    return { since: subDays(today, 1), until: today, label: 'Yesterday' };
  }
  const days = [7, 30, 90].includes(Number(rangeParam)) ? Number(rangeParam) : 30;
  return { since: subDays(today, days), label: `${days}d` };
}

const RANGE_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7', label: '7d' },
  { value: '30', label: '30d' },
  { value: '90', label: '90d' },
];

const KIND_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'exception', label: 'Exception' },
  { value: 'empty_response', label: 'Empty Response' },
  { value: 'client_stream_fallback', label: 'Client Fallback' },
];

const PIPELINE_SORT_COLS: PipelineErrorSortCol[] = ['createdAt', 'stage', 'type'];
const DISCOVERY_SORT_COLS: DiscoveryChatErrorSortCol[] = ['createdAt', 'errorKind'];

function kindBadgeClass(kind: string): string {
  if (kind === 'exception') return styles.badgeError;
  if (kind === 'empty_response') return styles.badgeWarning;
  return styles.badgeInfo;
}

function kindLabel(kind: string): string {
  return KIND_OPTIONS.find((k) => k.value === kind)?.label ?? kind;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ${seconds % 60}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function statusBadgeClass(status: string): string {
  if (status === 'SCRIPT_READY') return styles.badgeWarning;
  if (status === 'DRAFT') return styles.badgeInfo;
  if (status === 'FAILED') return styles.badgeError;
  if (status === 'READY') return styles.badgeSuccess;
  return styles.badgeActive;
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

function sortIndicator(active: boolean, dir: 'asc' | 'desc'): string {
  if (!active) return ' ⇅';
  return dir === 'desc' ? ' ↓' : ' ↑';
}

export default async function AdminPipelinePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rangeParam = params.range ?? '30';
  const { since, until, label: rangeLabel } = parseRange(rangeParam);
  const kindFilter = KIND_OPTIONS.some((k) => k.value === (params.kind ?? ''))
    ? (params.kind ?? '')
    : '';
  // Discovery chat errors: sort direction + column
  const sort = params.sort === 'asc' ? 'asc' : 'desc';
  const dSortCol: DiscoveryChatErrorSortCol = DISCOVERY_SORT_COLS.includes(
    params.sortcol as DiscoveryChatErrorSortCol,
  )
    ? (params.sortcol as DiscoveryChatErrorSortCol)
    : 'createdAt';
  // Pipeline failures: sort column + direction (independent from discovery sort)
  const pSortCol: PipelineErrorSortCol = PIPELINE_SORT_COLS.includes(
    params.psortcol as PipelineErrorSortCol,
  )
    ? (params.psortcol as PipelineErrorSortCol)
    : 'createdAt';
  const pSortDir = params.psortdir === 'asc' ? 'asc' : ('desc' as const);

  const [
    funnel, adoption, pipeline, recentErrors, discoveryChatErrors, errorStats,
    inProgress, recentlySucceeded, draftAbandonment,
    voiceByProvider, topVoices, stageTiming,
  ] = await Promise.all([
    getFreeTierFunnel(),
    getByokAdoption(),
    getPipelineHealth(since),
    getRecentPipelineErrors(20, since, until, pSortCol, pSortDir),
    getRecentDiscoveryChatErrors(50, kindFilter || undefined, sort, since, until, dSortCol),
    getDiscoveryChatErrorStats(since, until),
    getInProgressPipelines(),
    getRecentlySucceeded(since, until),
    getDraftAbandonmentMetrics(since, until),
    getVoiceUsageByProvider(since),
    getTopVoices(since),
    getPerStageTiming(since),
  ]);

  const funnelMax = Math.max(funnel.freeGenUsers, funnel.exhaustedUsers, funnel.byokUsers, 1);
  const maxAi = Math.max(...adoption.ai.map((a) => a.count), 1);
  const maxTts = Math.max(...adoption.tts.map((t) => t.count), 1);
  const maxDay = Math.max(...errorStats.daily.map((d) => d.total), 1);
  const maxVoiceAssignments = Math.max(...voiceByProvider.map((v) => v.totalAssignments), 1);
  const CHART_HEIGHT = 72;

  // Preserve all current params, then override specific ones
  function baseParams() {
    const p = new URLSearchParams({ range: rangeParam });
    if (kindFilter) p.set('kind', kindFilter);
    if (sort !== 'desc') p.set('sort', sort);
    if (dSortCol !== 'createdAt') p.set('sortcol', dSortCol);
    if (pSortCol !== 'createdAt') p.set('psortcol', pSortCol);
    if (pSortDir !== 'desc') p.set('psortdir', pSortDir);
    return p;
  }

  function rangeHref(r: string) {
    const p = baseParams();
    p.set('range', r);
    return `/admin/pipeline?${p}`;
  }
  function kindHref(k: string) {
    const p = baseParams();
    if (k) p.set('kind', k); else p.delete('kind');
    return `/admin/pipeline?${p}`;
  }

  // Pipeline failures column sort: clicking a column toggles direction if already active, else sets desc
  function pipelineThHref(col: PipelineErrorSortCol) {
    const p = baseParams();
    p.set('psortcol', col);
    p.set('psortdir', pSortCol === col && pSortDir === 'desc' ? 'asc' : 'desc');
    return `/admin/pipeline?${p}`;
  }

  // Discovery chat errors column sort
  function discoveryThHref(col: DiscoveryChatErrorSortCol) {
    const p = baseParams();
    p.set('sortcol', col);
    // Toggle direction if clicking active column, else default to desc
    const nextDir = dSortCol === col && sort === 'desc' ? 'asc' : 'desc';
    if (nextDir !== 'desc') p.set('sort', nextDir); else p.delete('sort');
    return `/admin/pipeline?${p}`;
  }

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <div className={styles.header}>
          <h1 className={styles.title}>Pipeline &amp; BYOK</h1>
          <p className={styles.subtitle}>Generation pipeline health and BYOK conversion funnel</p>
        </div>
        <nav className={styles.rangeNav} aria-label="Time range">
          {RANGE_OPTIONS.map(({ value, label }) => (
            <a
              key={value}
              href={rangeHref(value)}
              className={`${styles.rangeLink} ${rangeParam === value ? styles.rangeLinkActive : ''}`}
              aria-current={rangeParam === value ? 'page' : undefined}
            >
              {label}
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

      {/* Per-Stage Timing */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Per-Stage Timing ({rangeLabel})</h2>
        {stageTiming.length === 0 ? (
          <p className={styles.empty}>No stage completion data yet.</p>
        ) : (
          <div className={styles.tableContainer}>
            <table className={styles.recentTable}>
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Avg</th>
                  <th>p50</th>
                  <th>p95</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {stageTiming.map((s) => (
                  <tr key={s.stage}>
                    <td>{s.stage}</td>
                    <td className={styles.elapsedCell}>{formatSeconds(s.avgSeconds)}</td>
                    <td className={styles.elapsedCell}>{formatSeconds(s.p50Seconds)}</td>
                    <td className={styles.elapsedCell}>{formatSeconds(s.p95Seconds)}</td>
                    <td>{s.count.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* In Progress */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>In Progress ({inProgress.length})</h2>
        {inProgress.length === 0 ? (
          <p className={styles.empty}>No pipelines currently running.</p>
        ) : (
          <div className={styles.tableContainer}>
            <table className={styles.recentTable}>
              <thead>
                <tr>
                  <th>Podcast</th>
                  <th>Status</th>
                  <th>User</th>
                  <th>Elapsed</th>
                </tr>
              </thead>
              <tbody>
                {inProgress.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/podcast/${p.id}`} className={styles.podcastLink}>
                        {p.title}
                      </Link>
                    </td>
                    <td>
                      <span className={statusBadgeClass(p.status)}>{statusLabel(p.status)}</span>
                    </td>
                    <td>{p.userName ?? p.userEmail ?? '—'}</td>
                    <td className={styles.elapsedCell}>{formatElapsed(p.elapsedSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recently Succeeded */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Recently Succeeded ({rangeLabel})</h2>
        {recentlySucceeded.length === 0 ? (
          <p className={styles.empty}>No completed podcasts in this period.</p>
        ) : (
          <div className={styles.tableContainer}>
            <table className={styles.recentTable}>
              <thead>
                <tr>
                  <th>Podcast</th>
                  <th>User</th>
                  <th>Generation Time</th>
                  <th>Completed</th>
                </tr>
              </thead>
              <tbody>
                {recentlySucceeded.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link href={`/podcast/${s.podcastId}`} className={styles.podcastLink}>
                        {s.podcastTitle}
                      </Link>
                    </td>
                    <td>{s.userName ?? s.userEmail ?? '—'}</td>
                    <td className={styles.elapsedCell}>{formatSeconds(s.generationSeconds)}</td>
                    <td className={styles.dateCell}>
                      {new Date(s.completedAt).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Draft Abandonment */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Draft Abandonment ({rangeLabel})</h2>
        <div className={styles.grid}>
          <div className={styles.card}>
            <span className={styles.cardLabel}>Total Created</span>
            <span className={styles.cardValue}>{draftAbandonment.totalDrafts.toLocaleString()}</span>
          </div>
          <div className={styles.card}>
            <span className={styles.cardLabel}>Still Draft</span>
            <span className={styles.cardValue}>{draftAbandonment.stillDraft.toLocaleString()}</span>
          </div>
          <div className={styles.card}>
            <span className={styles.cardLabel}>Paused at Script Ready</span>
            <span className={styles.cardValue}>{draftAbandonment.pausedAtScriptReady.toLocaleString()}</span>
          </div>
          <div className={styles.card}>
            <span className={styles.cardLabel}>Abandonment Rate</span>
            <span className={styles.cardValue}>{Math.round(draftAbandonment.abandonmentRate * 100)}%</span>
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

      {/* Recent pipeline failures */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Recent Failures</h2>
        {recentErrors.length === 0 ? (
          <p className={styles.empty}>No pipeline events recorded yet.</p>
        ) : (
          <div className={styles.tableContainer}>
            <table className={styles.recentTable}>
              <thead>
                <tr>
                  <th>
                    <a href={pipelineThHref('createdAt')} className={styles.thSortLink}>
                      Time{sortIndicator(pSortCol === 'createdAt', pSortDir)}
                    </a>
                  </th>
                  <th>Podcast</th>
                  <th>
                    <a href={pipelineThHref('stage')} className={styles.thSortLink}>
                      Stage{sortIndicator(pSortCol === 'stage', pSortDir)}
                    </a>
                  </th>
                  <th>
                    <a href={pipelineThHref('type')} className={styles.thSortLink}>
                      Type{sortIndicator(pSortCol === 'type', pSortDir)}
                    </a>
                  </th>
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
                    <td className={styles.errorCell}>
                      {evt.message}
                      {evt.message && <> <CopyButton text={evt.message} /></>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Discovery chat errors */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Discovery Chat Errors</h2>

        {/* Summary stats pills */}
        <div className={styles.statsRow}>
          <div className={styles.statPill}>
            <span className={`${styles.statPillDot} ${styles.statPillDotTotal}`} />
            <span className={styles.statPillCount}>{errorStats.total}</span>
            <span className={styles.statPillLabel}>Total ({rangeLabel})</span>
          </div>
          {(errorStats.byKind['exception'] ?? 0) > 0 && (
            <div className={styles.statPill}>
              <span className={`${styles.statPillDot} ${styles.statPillDotError}`} />
              <span className={styles.statPillCount}>{errorStats.byKind['exception']}</span>
              <span className={styles.statPillLabel}>Exception</span>
            </div>
          )}
          {(errorStats.byKind['empty_response'] ?? 0) > 0 && (
            <div className={styles.statPill}>
              <span className={`${styles.statPillDot} ${styles.statPillDotWarning}`} />
              <span className={styles.statPillCount}>{errorStats.byKind['empty_response']}</span>
              <span className={styles.statPillLabel}>Empty Response</span>
            </div>
          )}
          {(errorStats.byKind['client_stream_fallback'] ?? 0) > 0 && (
            <div className={styles.statPill}>
              <span className={`${styles.statPillDot} ${styles.statPillDotInfo}`} />
              <span className={styles.statPillCount}>{errorStats.byKind['client_stream_fallback']}</span>
              <span className={styles.statPillLabel}>Client Fallback</span>
            </div>
          )}
        </div>

        {/* Daily bar chart */}
        {errorStats.total > 0 && errorStats.daily.length > 1 && (
          <div className={styles.chartWrap}>
            <div className={styles.chartContainer}>
              {errorStats.daily.map((day, i) => {
                const barPx = Math.round((day.total / maxDay) * CHART_HEIGHT);
                const showLabel =
                  i === 0 ||
                  i === errorStats.daily.length - 1 ||
                  i % Math.max(1, Math.floor(errorStats.daily.length / 6)) === 0;
                const dateLabel = new Date(day.date + 'T00:00:00').toLocaleDateString('en-US', {
                  month: 'numeric',
                  day: 'numeric',
                });
                const exPx = day.total > 0
                  ? Math.round(((day.byKind['exception'] ?? 0) / day.total) * barPx)
                  : 0;
                const emPx = day.total > 0
                  ? Math.round(((day.byKind['empty_response'] ?? 0) / day.total) * barPx)
                  : 0;
                const clPx = barPx - exPx - emPx;

                return (
                  <div key={day.date} className={styles.chartCol}>
                    <div className={styles.chartBar} style={{ height: `${barPx}px` }}>
                      {clPx > 0 && <div className={styles.chartSegmentInfo} style={{ height: `${clPx}px` }} />}
                      {emPx > 0 && <div className={styles.chartSegmentWarning} style={{ height: `${emPx}px` }} />}
                      {exPx > 0 && <div className={styles.chartSegmentError} style={{ height: `${exPx}px` }} />}
                    </div>
                    <span className={styles.chartLabel}>{showLabel ? dateLabel : ''}</span>
                  </div>
                );
              })}
            </div>
            <div className={styles.chartLegend}>
              <div className={styles.chartLegendItem}>
                <span className={styles.chartLegendDot} style={{ background: 'var(--color-error)' }} />
                Exception
              </div>
              <div className={styles.chartLegendItem}>
                <span className={styles.chartLegendDot} style={{ background: 'var(--color-warning)' }} />
                Empty Response
              </div>
              <div className={styles.chartLegendItem}>
                <span className={styles.chartLegendDot} style={{ background: 'var(--color-accent)', opacity: 0.7 }} />
                Client Fallback
              </div>
            </div>
          </div>
        )}

        {/* Kind filter */}
        <div className={styles.filterRow}>
          <nav className={styles.kindNav} aria-label="Error kind filter">
            {KIND_OPTIONS.map(({ value, label }) => (
              <a
                key={value || 'all'}
                href={kindHref(value)}
                className={`${styles.kindLink} ${kindFilter === value ? styles.kindLinkActive : ''}`}
              >
                {label}
                {value !== '' && (errorStats.byKind[value] ?? 0) > 0 && (
                  <> ({errorStats.byKind[value]})</>
                )}
              </a>
            ))}
          </nav>
        </div>

        {discoveryChatErrors.length === 0 ? (
          <p className={styles.empty}>No discovery chat errors in this period.</p>
        ) : (
          <div className={styles.tableContainer}>
            <table className={styles.recentTable}>
              <thead>
                <tr>
                  <th>
                    <a href={discoveryThHref('createdAt')} className={styles.thSortLink}>
                      Time{sortIndicator(dSortCol === 'createdAt', sort)}
                    </a>
                  </th>
                  <th>User</th>
                  <th>
                    <a href={discoveryThHref('errorKind')} className={styles.thSortLink}>
                      Kind{sortIndicator(dSortCol === 'errorKind', sort)}
                    </a>
                  </th>
                  <th>Message</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {discoveryChatErrors.map((evt) => (
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
                      <Link
                        href={`/admin/users?search=${encodeURIComponent(evt.userEmail ?? evt.userId)}`}
                      >
                        {evt.userName ?? evt.userEmail ?? evt.userId}
                      </Link>
                    </td>
                    <td>
                      <span className={kindBadgeClass(evt.errorKind)}>{kindLabel(evt.errorKind)}</span>
                    </td>
                    <td className={styles.errorCell}>{evt.userMessage.slice(0, 200)}</td>
                    <td className={styles.errorCell}>
                      {evt.errorDetail ? (
                        <>
                          {evt.errorDetail.slice(0, 200)}{' '}
                          <CopyButton text={evt.errorDetail} />
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Voice Usage */}
      <div className={styles.columns}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Voices by Provider ({rangeLabel})</h2>
          {voiceByProvider.length === 0 ? (
            <p className={styles.empty}>No voice assignments yet.</p>
          ) : (
            <div className={styles.hBarContainer}>
              {voiceByProvider.map((v) => (
                <div key={v.provider} className={styles.hBarRow}>
                  <span className={styles.hBarLabel}>{v.provider}</span>
                  <div className={styles.hBarTrack}>
                    <div
                      className={styles.hBarFill}
                      style={{ width: `${(v.totalAssignments / maxVoiceAssignments) * 100}%` }}
                    />
                  </div>
                  <span className={styles.hBarValue}>
                    {v.totalAssignments} ({v.uniqueVoices} voices)
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Most Used Voices ({rangeLabel})</h2>
          {topVoices.length === 0 ? (
            <p className={styles.empty}>No voice data yet.</p>
          ) : (
            <div className={styles.tableContainer}>
              <table className={styles.recentTable}>
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Voice ID</th>
                    <th>Podcasts</th>
                  </tr>
                </thead>
                <tbody>
                  {topVoices.map((v) => (
                    <tr key={`${v.provider}-${v.voiceId}`}>
                      <td>{v.provider}</td>
                      <td className={styles.errorCell}>
                        {v.voiceId.length > 24 ? `${v.voiceId.slice(0, 24)}…` : v.voiceId}
                      </td>
                      <td>{v.podcastCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
