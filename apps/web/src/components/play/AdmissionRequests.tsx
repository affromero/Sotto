'use client';

import Link from 'next/link';
import type { PlayPendingRequestView } from '@sotto/shared';
import styles from './AdmissionRequests.module.css';

const labels = {
  APPROVE_PROFILE: 'Approve new profile',
  ACCEPT: 'Let them enter',
  DECLINE: 'Decline request',
};

export function AdmissionRequests({
  requests,
  busy,
  onAction,
  roomIds = [],
  approveAndEnter = false,
}: {
  requests: PlayPendingRequestView[];
  busy: boolean;
  onAction: (
    request: PlayPendingRequestView,
    type: PlayPendingRequestView['allowedActions'][number]
  ) => Promise<void>;
  roomIds?: readonly string[];
  approveAndEnter?: boolean;
}) {
  return (
    <div className={styles.root}>
      {requests.map((request) => (
        <article key={request.requestId} className={styles.request}>
          <div>
            <h3>{request.name}</h3>
            <p>
              {request.settings.targetLang.toUpperCase()} · {request.settings.level}
            </p>
            <p>
              {request.status === 'WAITING_FOR_OWNER'
                ? 'The server owner must approve a new profile.'
                : request.status === 'HOST_UNAVAILABLE'
                  ? 'Waiting for the host to return to the game.'
                  : request.status === 'ACCEPTED'
                    ? 'Accepted. Waiting for them to enter.'
                    : 'Waiting for the host to accept entry.'}
            </p>
          </div>
          {roomIds.includes(request.roomId) && (
            <Link
              href={`/play/rooms/${encodeURIComponent(request.roomId)}`}
              className={styles.roomLink}
            >
              Open waiting game
            </Link>
          )}
          <div className={styles.actions}>
            {request.allowedActions.map((type) => (
              <button
                key={type}
                type="button"
                disabled={busy}
                className={type === 'DECLINE' ? styles.quiet : styles.primary}
                onClick={() => {
                  void onAction(request, type);
                }}
              >
                {type === 'APPROVE_PROFILE' && approveAndEnter
                  ? 'Approve profile and let in'
                  : labels[type]}
              </button>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
