'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QueueActions } from './QueueActions';
import {
  PIPELINE_STAGE_ORDER,
  QUEUE_METADATA,
  type PipelineStage,
  type QueueStats,
} from './queue-metadata';
import styles from './page.module.css';
import adminStyles from '../admin.module.css';

type SortColumn = 'name' | 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'total';
type SortDirection = 'asc' | 'desc';
type StatusFilter = 'all' | 'failed' | 'active' | 'idle';

interface QueueEntry {
  name: string;
  stats: QueueStats;
  description: string;
  stage: PipelineStage;
  total: number;
}

function getTotal(s: QueueStats): number {
  return s.waiting + s.active + s.completed + s.failed + s.delayed;
}

function matchesSearch(entry: QueueEntry, query: string): boolean {
  const q = query.toLowerCase();
  return entry.name.toLowerCase().includes(q) || entry.description.toLowerCase().includes(q);
}

function matchesStatus(entry: QueueEntry, filter: StatusFilter): boolean {
  switch (filter) {
    case 'failed':
      return entry.stats.failed > 0;
    case 'active':
      return entry.stats.active > 0;
    case 'idle':
      return entry.stats.active === 0 && entry.stats.waiting === 0;
    default:
      return true;
  }
}

function compareEntries(a: QueueEntry, b: QueueEntry, col: SortColumn, dir: SortDirection): number {
  let cmp: number;
  switch (col) {
    case 'name':
      cmp = a.name.localeCompare(b.name);
      break;
    case 'total':
      cmp = a.total - b.total;
      break;
    default:
      cmp = a.stats[col] - b.stats[col];
  }
  return dir === 'asc' ? cmp : -cmp;
}

function formatTimeAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

const SORT_INDICATORS: Record<string, string> = {
  none: '\u21C5',
  asc: '\u2191',
  desc: '\u2193',
};

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'failed', label: 'Failed' },
  { value: 'active', label: 'Active' },
  { value: 'idle', label: 'Idle' },
];

const COLUMNS: { key: SortColumn; label: string }[] = [
  { key: 'name', label: 'Queue' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'failed', label: 'Failed' },
  { key: 'delayed', label: 'Delayed' },
];

export function QueueDashboard() {
  const [queues, setQueues] = useState<Record<string, QueueStats> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<number>(Date.now());
  const [now, setNow] = useState<number>(Date.now());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortCol, setSortCol] = useState<SortColumn>('name');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');
  const [grouped, setGrouped] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchQueues = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/admin/queues');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setQueues(data.queues);
      setLastRefreshed(Date.now());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch queues');
    }
  }, []);

  useEffect(() => {
    fetchQueues();
  }, [fetchQueues]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchQueues, 10_000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, fetchQueues]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const entries: QueueEntry[] = useMemo(() => {
    if (!queues) return [];
    return Object.entries(queues).map(([name, stats]) => {
      const meta = QUEUE_METADATA[name];
      return {
        name,
        stats,
        description: meta?.description ?? '',
        stage: meta?.stage ?? 'Platform Ops',
        total: getTotal(stats),
      };
    });
  }, [queues]);

  const filtered = useMemo(() => {
    return entries
      .filter((e) => matchesSearch(e, search))
      .filter((e) => matchesStatus(e, statusFilter));
  }, [entries, search, statusFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => compareEntries(a, b, sortCol, sortDir));
  }, [filtered, sortCol, sortDir]);

  const groupedByStage = useMemo(() => {
    const map = new Map<PipelineStage, QueueEntry[]>();
    for (const stage of PIPELINE_STAGE_ORDER) {
      const stageEntries = filtered
        .filter((e) => e.stage === stage)
        .sort((a, b) => compareEntries(a, b, sortCol, sortDir));
      if (stageEntries.length > 0) map.set(stage, stageEntries);
    }
    return map;
  }, [filtered, sortCol, sortDir]);

  const summary = useMemo(() => {
    if (!queues) return { total: 0, active: 0, waiting: 0, failed: 0, delayed: 0 };
    const vals = Object.values(queues);
    return {
      total: vals.length,
      active: vals.reduce((sum, q) => sum + q.active, 0),
      waiting: vals.reduce((sum, q) => sum + q.waiting, 0),
      failed: vals.reduce((sum, q) => sum + q.failed, 0),
      delayed: vals.reduce((sum, q) => sum + q.delayed, 0),
    };
  }, [queues]);

  function handleSort(col: SortColumn) {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir(col === 'name' ? 'asc' : 'desc');
    }
  }

  function sortIndicator(col: SortColumn): string {
    if (sortCol !== col) return SORT_INDICATORS.none;
    return SORT_INDICATORS[sortDir];
  }

  function renderTableHead() {
    return (
      <thead>
        <tr>
          {COLUMNS.map(({ key, label }) => (
            <th key={key} aria-sort={sortCol === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
              <button type="button" className={styles.thSortButton} onClick={() => handleSort(key)}>
                {label} {sortIndicator(key)}
              </button>
            </th>
          ))}
          <th className={styles.descriptionHeader}>Description</th>
          <th>Actions</th>
        </tr>
      </thead>
    );
  }

  function renderRow(entry: QueueEntry) {
    const rowClass =
      entry.stats.failed > 0 ? styles.rowFailed : entry.stats.waiting > 0 ? styles.rowWaiting : undefined;
    return (
      <tr key={entry.name} className={rowClass}>
        <td className={styles.queueName}>{entry.name}</td>
        <td>{entry.stats.waiting}</td>
        <td>{entry.stats.active}</td>
        <td>{entry.stats.completed}</td>
        <td>{entry.stats.failed}</td>
        <td>{entry.stats.delayed}</td>
        <td className={styles.queueDescription}>{entry.description}</td>
        <td>
          {entry.stats.failed > 0 && (
            <QueueActions queueName={entry.name} failedCount={entry.stats.failed} onRefresh={fetchQueues} />
          )}
        </td>
      </tr>
    );
  }

  if (!queues && !error) {
    return (
      <div className={adminStyles.container}>
        <div className={adminStyles.header}>
          <h1 className={adminStyles.title}>Queues</h1>
          <p className={adminStyles.subtitle}>Loading queue data...</p>
        </div>
        <div className={styles.loadingState}>Loading...</div>
      </div>
    );
  }

  return (
    <div className={adminStyles.container}>
      <div className={adminStyles.headerRow}>
        <div className={adminStyles.header}>
          <h1 className={adminStyles.title}>Queues</h1>
          <p className={adminStyles.subtitle}>Monitor and manage all {summary.total} BullMQ queues</p>
        </div>
        <div className={styles.refreshControls}>
          <label className={styles.autoRefreshToggle}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh
          </label>
          <span className={styles.lastRefreshed}>
            Updated {formatTimeAgo(now - lastRefreshed)}
          </span>
          <button type="button" className={styles.actionButton} onClick={fetchQueues}>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className={styles.errorBanner} role="alert">
          Failed to fetch: {error}
        </div>
      )}

      <div className={styles.summary}>
        <div className={adminStyles.card}>
          <span className={adminStyles.cardLabel}>Total Queues</span>
          <span className={adminStyles.cardValue}>{summary.total}</span>
        </div>
        <div className={adminStyles.card}>
          <span className={adminStyles.cardLabel}>Active</span>
          <span className={adminStyles.cardValue}>{summary.active}</span>
        </div>
        <div className={adminStyles.card}>
          <span className={adminStyles.cardLabel}>Waiting</span>
          <span className={adminStyles.cardValue}>{summary.waiting}</span>
        </div>
        <div className={`${adminStyles.card} ${summary.failed > 0 ? styles.cardFailed : ''}`}>
          <span className={adminStyles.cardLabel}>Failed</span>
          <span className={adminStyles.cardValue}>{summary.failed}</span>
        </div>
        <div className={adminStyles.card}>
          <span className={adminStyles.cardLabel}>Delayed</span>
          <span className={adminStyles.cardValue}>{summary.delayed}</span>
        </div>
      </div>

      <div className={styles.toolbar}>
        <input
          type="search"
          className={styles.searchInput}
          placeholder="Search queues..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search queues by name or description"
        />
        <div className={styles.filterChips}>
          {STATUS_FILTERS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={`${styles.filterChip} ${statusFilter === value ? styles.filterChipActive : ''}`}
              aria-pressed={statusFilter === value}
              onClick={() => setStatusFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={styles.groupToggle}
          onClick={() => setGrouped((g) => !g)}
          aria-pressed={grouped}
        >
          {grouped ? 'Flat View' : 'Grouped View'}
        </button>
      </div>

      {filtered.length === 0 && (
        <p className={adminStyles.empty}>No queues match your filters.</p>
      )}

      {grouped ? (
        Array.from(groupedByStage.entries()).map(([stage, stageEntries]) => (
          <section key={stage} className={styles.stageSection}>
            <div className={styles.stageHeader}>
              <h3 className={styles.stageTitle}>{stage}</h3>
              <span className={styles.stageCount}>{stageEntries.length}</span>
            </div>
            <div className={adminStyles.tableContainer}>
              <table className={adminStyles.table}>
                {renderTableHead()}
                <tbody>{stageEntries.map(renderRow)}</tbody>
              </table>
            </div>
          </section>
        ))
      ) : (
        <div className={adminStyles.tableContainer}>
          <table className={adminStyles.table}>
            {renderTableHead()}
            <tbody>{sorted.map(renderRow)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
