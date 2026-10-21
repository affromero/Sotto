'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  playReportCategorySchema,
  type PlayReportCategory,
  type PlayRoomView,
} from '@sotto/shared';
import { newPlayActionId } from '../client/api';
import { usePlaySafetyMutation } from './safety-client';
import { playReportOptions } from './report-options';
import styles from './PlayReport.module.css';

export function PlayReport({
  room,
  onBlocked,
  onClose,
  onPendingChange,
}: {
  room: PlayRoomView;
  onBlocked: () => void;
  onClose: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const options = playReportOptions(room);
  const [optionId, setOptionId] = useState('name');
  const [category, setCategory] = useState<PlayReportCategory>('HARASSMENT');
  const [detail, setDetail] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const mutation = usePlaySafetyMutation();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    onPendingChange(mutation.pending);
  }, [mutation.pending, onPendingChange]);
  const option = options.find((item) => item.id === optionId);
  const send = async (block: boolean) => {
    if (!block && !option) return;
    const actionId = newPlayActionId();
    const body = block
      ? { actionId }
      : {
          actionId,
          category,
          detail,
          selector: option!.selector,
          expectedVisibleText: option!.text,
        };
    const result = await mutation.run(
      `/api/v1/play/rooms/${encodeURIComponent(room.id)}/${block ? 'block' : 'reports'}`,
      body
    );
    if (!result || !alive.current) return;
    if (block) {
      setBlocked(true);
      setConfirming(false);
      onBlocked();
      setNotice(
        'Partner blocked. Your games together have ended. You can still report this visible content.'
      );
    } else {
      setDetail('');
      setNotice('Report sent to this server’s owner. Read its response in Game safety.');
    }
  };
  return (
    <section className={styles.root} aria-label="Report or block partner">
      <h2>Report or block</h2>
      <p>
        Reports go to this server&apos;s owner. Select content visible in your game. Blocking ends
        your games together and prevents new games between these profiles.
      </p>
      {notice && <p role="status">{notice}</p>}
      {mutation.error && (
        <p role="alert" className={styles.error}>
          {mutation.error}
        </p>
      )}
      {mutation.uncertain && (
        <div className={styles.confirm}>
          <p>The safety action may have saved. Retry sends its exact original request.</p>
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
      <fieldset disabled={mutation.pending}>
        <legend>Report visible content</legend>
        <label className={styles.field}>
          Content to report
          <select value={optionId} onChange={(event) => setOptionId(event.target.value)}>
            {options.map((item) => (
              <option value={item.id} key={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        {option && <blockquote className={styles.evidence}>{option.text}</blockquote>}
        <label className={styles.field}>
          Reason
          <select
            value={category}
            onChange={(event) => setCategory(playReportCategorySchema.parse(event.target.value))}
          >
            {playReportCategorySchema.options.map((value) => (
              <option key={value} value={value}>
                {value.toLowerCase().replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Explanation (optional)
          <textarea
            maxLength={1000}
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
          />
        </label>
        <button
          className={styles.primary}
          disabled={!option}
          onClick={() => {
            void send(false);
          }}
        >
          Send report to server owner
        </button>
      </fieldset>
      <div className={styles.actions}>
        {blocked ? (
          <p>Partner blocked.</p>
        ) : (
          <button
            className={styles.button}
            disabled={mutation.pending}
            onClick={() => setConfirming(true)}
          >
            Block partner
          </button>
        )}
        <Link href="/play/safety">Blocks and report responses</Link>
        <button className={styles.button} disabled={mutation.pending} onClick={onClose}>
          Close report
        </button>
      </div>
      {confirming && (
        <div className={styles.confirm} role="group" aria-label="Confirm partner block">
          <p>Block this partner and end your games together?</p>
          <div className={styles.actions}>
            <button
              className={styles.button}
              disabled={mutation.pending}
              onClick={() => {
                void send(true);
              }}
            >
              Confirm block partner
            </button>
            <button
              className={styles.button}
              disabled={mutation.pending}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
