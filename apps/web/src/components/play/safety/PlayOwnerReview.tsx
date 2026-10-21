'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  playReportReviewActionSchema,
  playReportReviewListSchema,
  type PlayReportReviewView,
} from '@sotto/shared';
import { usePlayRequest } from '../client/profile';
import { newPlayActionId, playErrorMessage } from '../client/api';
import { usePlayPoll } from '../client/usePlayPoll';
import { usePlaySafetyMutation, usePlaySafetyStatus } from './safety-client';
import styles from './PlayOwnerReview.module.css';

const labels = {
  RESPOND: 'Send response',
  DISMISS: 'Resolve report',
  CLOSE_ROOM: 'Close game',
  RESTRICT_PLAY: 'Restrict partner games',
  RESTORE_PLAY: 'Restore partner games',
} as const;

export function PlayOwnerReview() {
  const request = usePlayRequest();
  const safety = usePlaySafetyStatus();
  const [status, setStatus] = useState<'OPEN' | 'RESOLVED'>('OPEN');
  const [reports, setReports] = useState<PlayReportReviewView[]>([]);
  const [older, setOlder] = useState<PlayReportReviewView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [openedOlder, setOpenedOlder] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pendingReports, setPendingReports] = useState(new Map<string, PlayReportReviewView>());
  const pageGeneration = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const lifetime = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, [status]);
  const load = useCallback(
    async (signal: AbortSignal) => {
      const generation = pageGeneration.current;
      const page = await request(
        `/api/v1/play/safety/review?status=${status}`,
        playReportReviewListSchema,
        { signal }
      );
      signal.throwIfAborted();
      if (pageGeneration.current !== generation) return;
      setReports(page.reports);
      setCursor(page.nextCursor);
    },
    [request, status]
  );
  const polling = usePlayPoll(load, 5000);
  const refresh = async () => {
    setError(null);
    try {
      await load(lifetime.current.signal);
    } catch (caught) {
      if (!lifetime.current.signal.aborted) setError(playErrorMessage(caught));
    }
  };
  const more = async () => {
    const beforeId = openedOlder ? olderCursor : cursor;
    if (!beforeId || loading) return;
    setLoading(true);
    const generation = pageGeneration.current;
    setError(null);
    const signal = lifetime.current.signal;
    try {
      const page = await request(
        `/api/v1/play/safety/review?status=${status}&beforeId=${encodeURIComponent(beforeId)}`,
        playReportReviewListSchema,
        { signal }
      );
      signal.throwIfAborted();
      if (pageGeneration.current !== generation) return;
      setOlder((previous) => [
        ...new Map([...previous, ...page.reports].map((item) => [item.id, item])).values(),
      ]);
      setOlderCursor(page.nextCursor);
      setOpenedOlder(true);
    } catch (caught) {
      if (!signal.aborted && pageGeneration.current === generation)
        setError(playErrorMessage(caught));
    } finally {
      if (!signal.aborted && pageGeneration.current === generation) setLoading(false);
    }
  };
  const displayed = [
    ...new Map(
      [
        ...reports,
        ...older.filter((item) => !reports.some((recent) => recent.id === item.id)),
        ...pendingReports.values(),
      ].map((item) => [item.id, item])
    ).values(),
  ];
  const pinPending = useCallback((report: PlayReportReviewView, pending: boolean) => {
    setPendingReports((previous) => {
      if ((pending && previous.get(report.id) === report) || (!pending && !previous.has(report.id)))
        return previous;
      const next = new Map(previous);
      if (pending) next.set(report.id, report);
      else next.delete(report.id);
      return next;
    });
  }, []);
  const resetPages = () => {
    pageGeneration.current++;
    setLoading(false);
    setOlder([]);
    setOpenedOlder(false);
    setOlderCursor(null);
  };
  return (
    <main className={styles.root}>
      <Link href="/play/safety">Your safety settings</Link>
      <h1>Review game reports</h1>
      <p>
        Reports stay on this server. Respond to the reporting player and act on the reported
        profile&apos;s partner games.
      </p>
      {safety.policy && !safety.policy.operatorContactUrl && (
        <p role="status">
          Publish a contact for this server&apos;s operator by configuring
          SOTTO_PRIVACY_CONTACT_EMAIL.
        </p>
      )}
      {(polling.error || error) && (
        <p role="alert" className={styles.error}>
          {error || polling.error}
        </p>
      )}
      <label className={styles.field}>
        Reports
        <select
          value={status}
          disabled={pendingReports.size > 0}
          onChange={(event) => {
            if (pendingReports.size > 0) return;
            const value = event.target.value;
            if (value !== 'OPEN' && value !== 'RESOLVED') return;
            lifetime.current.abort();
            resetPages();
            setReports([]);
            setOlder([]);
            setOpenedOlder(false);
            setOlderCursor(null);
            setCursor(null);
            setStatus(value);
          }}
        >
          <option value="OPEN">Open reports</option>
          <option value="RESOLVED">Resolved reports</option>
        </select>
      </label>
      <button
        className={styles.button}
        disabled={pendingReports.size > 0}
        onClick={() => {
          resetPages();
          void refresh();
        }}
      >
        Refresh reports
      </button>
      {displayed.length === 0 && !polling.error && <p>No {status.toLowerCase()} reports.</p>}
      {displayed.map((report) => (
        <ReviewReport
          key={report.id}
          report={report}
          onPendingChange={pinPending}
          onIssue={setError}
          onSaved={() => {
            setError(null);
            resetPages();
            void refresh();
          }}
        />
      ))}
      {(openedOlder ? olderCursor : cursor) && (
        <button
          className={styles.button}
          disabled={loading || pendingReports.size > 0}
          onClick={() => {
            void more();
          }}
        >
          More reports
        </button>
      )}
    </main>
  );
}

function ReviewReport({
  report,
  onSaved,
  onPendingChange,
  onIssue,
}: {
  report: PlayReportReviewView;
  onSaved: () => void;
  onPendingChange: (report: PlayReportReviewView, pending: boolean) => void;
  onIssue: (error: string | null) => void;
}) {
  const [action, setAction] = useState(report.allowedActions[0] ?? 'RESPOND');
  const [response, setResponse] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const mutation = usePlaySafetyMutation();
  useEffect(() => {
    onPendingChange(report, mutation.pending);
  }, [report, mutation.pending, onPendingChange]);
  useEffect(() => {
    if (mutation.error) onIssue(mutation.error);
  }, [mutation.error, onIssue]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const send = async () => {
    if (!report.allowedActions.includes(action) || !response.trim()) return;
    const result = await mutation.run(
      `/api/v1/play/safety/review/${encodeURIComponent(report.id)}`,
      {
        actionId: newPlayActionId(),
        expectedRevision: report.revision,
        action,
        response,
      }
    );
    if (!result || !alive.current) return;
    setResponse('');
    setConfirming(false);
    setNotice('Decision and response saved.');
    onSaved();
  };
  return (
    <article className={styles.panel}>
      <h2>{report.category.toLowerCase().replaceAll('_', ' ')}</h2>
      <p>
        From {report.reporter.name} about {report.subject.name}.{' '}
        {report.subjectRestricted ? 'Partner games restricted.' : 'Partner games available.'}
      </p>
      <blockquote className={styles.evidence}>{report.evidence.text}</blockquote>
      <p>{report.detail}</p>
      {report.response && (
        <>
          <h3>Your previous response</h3>
          <p>{report.response}</p>
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {mutation.error && (
        <p role="alert" className={styles.error}>
          {mutation.error}
        </p>
      )}
      {mutation.uncertain && (
        <div className={styles.confirm}>
          <p>This decision may have saved. Retry sends the same decision and response.</p>
          <button
            className={styles.button}
            disabled={mutation.busy}
            onClick={() => {
              void mutation.retry();
            }}
          >
            Retry review decision
          </button>
        </div>
      )}
      <fieldset disabled={mutation.pending}>
        <legend>Owner decision</legend>
        <label className={styles.field}>
          Action
          <select
            value={action}
            onChange={(event) => {
              setAction(playReportReviewActionSchema.parse(event.target.value));
              setConfirming(false);
            }}
          >
            {report.allowedActions.map((value) => (
              <option key={value} value={value}>
                {labels[value]}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Response to the reporting player
          <textarea
            value={response}
            maxLength={1000}
            required
            onChange={(event) => {
              setResponse(event.target.value);
              setConfirming(false);
            }}
          />
        </label>
        {!confirming ? (
          <button
            className={styles.button}
            disabled={!response.trim() || !report.allowedActions.includes(action)}
            onClick={() => setConfirming(true)}
          >
            Review decision
          </button>
        ) : (
          <div className={styles.confirm}>
            <p>
              {labels[action]} for {report.subject.name}? The reporting player will see your
              response.
            </p>
            <div className={styles.actions}>
              <button
                className={styles.primary}
                onClick={() => {
                  void send();
                }}
              >
                Confirm decision
              </button>
              <button className={styles.button} onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </fieldset>
    </article>
  );
}
