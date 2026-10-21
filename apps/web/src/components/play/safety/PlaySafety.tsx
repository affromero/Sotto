'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  playBlockListSchema,
  playReportListSchema,
  type PlayBlockView,
  type PlayReportView,
} from '@sotto/shared';
import { usePlayRequest } from '../client/profile';
import { usePlayPoll } from '../client/usePlayPoll';
import { newPlayActionId, playErrorMessage } from '../client/api';
import { PlayConduct } from './PlayConduct';
import { usePlaySafetyMutation, usePlaySafetyStatus } from './safety-client';
import styles from './PlaySafety.module.css';

export function PlaySafety() {
  const request = usePlayRequest();
  const safety = usePlaySafetyStatus();
  const mutation = usePlaySafetyMutation();
  const [accepted, setAccepted] = useState(false);
  const [blocks, setBlocks] = useState<PlayBlockView[]>([]);
  const [reports, setReports] = useState<PlayReportView[]>([]);
  const [olderBlocks, setOlderBlocks] = useState<PlayBlockView[]>([]);
  const [olderReports, setOlderReports] = useState<PlayReportView[]>([]);
  const [blockCursor, setBlockCursor] = useState<string | null>(null);
  const [reportCursor, setReportCursor] = useState<string | null>(null);
  const pages = useRef({ blocks: false, reports: false });
  const pageGeneration = useRef(0);
  const [unblocking, setUnblocking] = useState<PlayBlockView | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lifetime = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  const load = useCallback(
    async (signal: AbortSignal) => {
      const generation = pageGeneration.current;
      const [blocked, reported] = await Promise.all([
        request('/api/v1/play/safety/blocks', playBlockListSchema, { signal }),
        request('/api/v1/play/safety/reports', playReportListSchema, { signal }),
      ]);
      signal.throwIfAborted();
      if (pageGeneration.current !== generation) return;
      setBlocks(blocked.blocks);
      setReports(reported.reports);
      if (!pages.current.blocks) setBlockCursor(blocked.nextCursor);
      if (!pages.current.reports) setReportCursor(reported.nextCursor);
    },
    [request]
  );
  const polling = usePlayPoll(load, 5000);
  const resetPages = () => {
    pageGeneration.current++;
    setLoadingMore(false);
    pages.current = { blocks: false, reports: false };
    setOlderBlocks([]);
    setOlderReports([]);
  };
  const refresh = async () => {
    resetPages();
    setError(null);
    try {
      await load(lifetime.current.signal);
      await safety.load(lifetime.current.signal);
    } catch (caught) {
      if (!lifetime.current.signal.aborted) setError(playErrorMessage(caught));
    }
  };
  const send = async (path: string, body: unknown) => {
    const result = await mutation.run(path, body);
    if (!result || lifetime.current.signal.aborted) return;
    setUnblocking(null);
    setNotice('Safety settings saved. Old games stay closed.');
    await refresh();
  };
  const more = async (blocked: boolean) => {
    const cursor = blocked ? blockCursor : reportCursor;
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const generation = pageGeneration.current;
    setError(null);
    try {
      const path = `/api/v1/play/safety/${blocked ? 'blocks' : 'reports'}?beforeId=${encodeURIComponent(cursor)}`;
      const signal = lifetime.current.signal;
      if (blocked) {
        const page = await request(path, playBlockListSchema, { signal });
        signal.throwIfAborted();
        if (pageGeneration.current !== generation) return;
        pages.current.blocks = true;
        setOlderBlocks((previous) => [
          ...new Map(
            [...previous, ...page.blocks].map((item) => [item.blockedUserId, item])
          ).values(),
        ]);
        setBlockCursor(page.nextCursor);
      } else {
        const page = await request(path, playReportListSchema, { signal });
        signal.throwIfAborted();
        if (pageGeneration.current !== generation) return;
        pages.current.reports = true;
        setOlderReports((previous) => [
          ...new Map([...previous, ...page.reports].map((item) => [item.id, item])).values(),
        ]);
        setReportCursor(page.nextCursor);
      }
    } catch (caught) {
      if (!lifetime.current.signal.aborted && pageGeneration.current === generation)
        setError(playErrorMessage(caught));
    } finally {
      if (!lifetime.current.signal.aborted && pageGeneration.current === generation)
        setLoadingMore(false);
    }
  };
  const allBlocks = [
    ...blocks,
    ...olderBlocks.filter(
      (item) => !blocks.some((current) => current.blockedUserId === item.blockedUserId)
    ),
  ];
  const allReports = [
    ...reports,
    ...olderReports.filter((item) => !reports.some((current) => current.id === item.id)),
  ];
  return (
    <main className={styles.root}>
      <Link href="/play">Back to games</Link>
      <p className={styles.eyebrow}>Sotto · together</p>
      <h1>Game safety</h1>
      <p className={styles.muted}>Manage this profile&apos;s blocks and reports on this server.</p>
      {(error || mutation.error || polling.error || safety.error) && (
        <p role="alert" className={styles.error}>
          {error || mutation.error || polling.error || safety.error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {mutation.uncertain && (
        <div className={styles.confirm}>
          <p>This action may have saved. Retry sends its exact original request.</p>
          <button
            className={styles.button}
            disabled={mutation.busy}
            onClick={() => {
              void mutation.retry();
            }}
          >
            Retry safety action
          </button>
        </div>
      )}
      <PlayConduct
        policy={safety.policy}
        accepted={accepted}
        onChange={setAccepted}
        disabled={mutation.pending}
        requireAcceptance={!safety.accepted}
      />
      {safety.accepted ? (
        <p>Conduct accepted for this profile.</p>
      ) : (
        <button
          className={styles.primary}
          disabled={!accepted || !safety.policy || mutation.pending}
          onClick={() => {
            if (safety.policy)
              void send('/api/v1/play/safety/conduct', {
                actionId: newPlayActionId(),
                version: safety.policy.version,
              });
          }}
        >
          Accept game conduct
        </button>
      )}
      {safety.status?.sharingRestricted && (
        <p role="status">
          The server owner has restricted this profile from partner games. You can still manage
          blocks and reports. Your private learning remains available.
        </p>
      )}
      <div className={styles.actions}>
        <button
          className={styles.button}
          disabled={mutation.pending || loadingMore}
          onClick={() => {
            void refresh();
          }}
        >
          Refresh safety settings
        </button>
        {safety.status?.canReviewReports && (
          <Link href="/play/safety/review">Review reports as server owner</Link>
        )}
      </div>
      <section className={styles.panel}>
        <h2>Your blocked players</h2>
        {allBlocks.length === 0 && <p className={styles.muted}>No blocked players.</p>}
        {allBlocks.map((block) => (
          <div className={styles.row} key={block.blockedUserId}>
            <span>{block.name}</span>
            <button
              className={styles.button}
              disabled={mutation.pending}
              onClick={() => setUnblocking(block)}
              aria-label={`Unblock ${block.name}`}
            >
              Unblock
            </button>
          </div>
        ))}
        {unblocking && (
          <div className={styles.confirm} role="group" aria-label="Confirm unblock">
            <p>Unblock {unblocking.name}? Old games stay closed.</p>
            <div className={styles.actions}>
              <button
                className={styles.button}
                disabled={mutation.pending}
                onClick={() => {
                  void send(
                    `/api/v1/play/safety/blocks/${encodeURIComponent(unblocking.blockedUserId)}/unblock`,
                    { actionId: newPlayActionId() }
                  );
                }}
              >
                Confirm unblock
              </button>
              <button
                className={styles.button}
                disabled={mutation.pending}
                onClick={() => setUnblocking(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {blockCursor && (
          <button
            className={styles.button}
            disabled={loadingMore || mutation.pending}
            onClick={() => {
              void more(true);
            }}
          >
            More blocked players
          </button>
        )}
      </section>
      <section className={styles.panel}>
        <h2>Your reports</h2>
        <p className={styles.muted}>
          Only you and this server&apos;s owner can read your report and the owner&apos;s response.
        </p>
        {allReports.length === 0 && <p>No reports.</p>}
        {allReports.map((report) => (
          <article className={styles.panel} key={report.id}>
            <h3>
              {report.category.replaceAll('_', ' ')} ·{' '}
              {report.status === 'OPEN' ? 'Open' : 'Resolved'}
            </h3>
            <blockquote className={styles.evidence}>{report.evidence.text}</blockquote>
            <p>{report.detail}</p>
            {report.response ? (
              <>
                <h4>Server owner&apos;s response</h4>
                <p>{report.response}</p>
              </>
            ) : (
              <p className={styles.muted}>Awaiting the server owner&apos;s response.</p>
            )}
          </article>
        ))}
        {reportCursor && (
          <button
            className={styles.button}
            disabled={loadingMore || mutation.pending}
            onClick={() => {
              void more(false);
            }}
          >
            More reports
          </button>
        )}
      </section>
    </main>
  );
}
