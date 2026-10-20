'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  createPlayInviteLink,
  formatPlayInviteCode,
  playInvitationViewSchema,
  playPendingRequestListSchema,
  playPendingRequestViewSchema,
  playRoomViewSchema,
  type PlayPendingRequestView,
  type PlayRoomView,
  type PlayRoundCommand,
} from '@sotto/shared';
import type { z } from 'zod';
import { AdmissionRequests } from './AdmissionRequests';
import { PhraseCapture } from './PhraseCapture';
import { RoundPlay } from './RoundPlay';
import { PlayHttpError, playErrorMessage, newPlayActionId } from './client/api';
import { usePlayRequest } from './client/profile';
import { useHostPresence } from './client/useHostPresence';
import { usePlayMutation } from './client/usePlayMutation';
import { usePlayPoll } from './client/usePlayPoll';
import styles from './PlayRoom.module.css';

type Invitation = z.infer<typeof playInvitationViewSchema>;

function canReconcileCommit(
  command: PlayRoundCommand,
  before: PlayRoomView['round'],
  after: PlayRoomView['round']
) {
  if (command.type === 'CHOOSE' || command.type === 'ANSWER') return true;
  if (command.type !== 'MISSION_DONE' || before?.mode !== 'MISSION' || after?.mode !== 'MISSION')
    return false;
  return (
    before.ownObjective === after.ownObjective &&
    before.twist === after.twist &&
    JSON.stringify(before.messages) === JSON.stringify(after.messages) &&
    JSON.stringify(before.hints) === JSON.stringify(after.hints)
  );
}

export function PlayRoom({ roomId }: { roomId: string }) {
  const playFetch = usePlayRequest();
  const router = useRouter();
  const [room, setRoom] = useState<PlayRoomView | null>(null);
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [inviteLoaded, setInviteLoaded] = useState(false);
  const [requests, setRequests] = useState<PlayPendingRequestView[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const roundCommand = useRef(false);
  const [qr, setQr] = useState<{ link: string; data: string } | null>(null);
  const [qrError, setQrError] = useState<{ link: string; message: string } | null>(null);
  const automaticInvite = useRef(false);
  const currentView = useRef<PlayRoomView | null>(null);
  const readSequence = useRef(0);
  const admissionEpoch = useRef(0);
  const lifetime = useRef(new AbortController());
  const action = usePlayMutation(playRoomViewSchema);
  const invite = usePlayMutation(playInvitationViewSchema);
  const runInvite = invite.run;
  const approval = usePlayMutation(playPendingRequestViewSchema);
  const path = `/api/v1/play/rooms/${encodeURIComponent(roomId)}`;
  const hostWaiting = room?.ownSeat === 'HOST' && room.status === 'WAITING' && !room.guest;
  const presence = useHostPresence(roomId, hostWaiting);
  const busy = reconciling || action.pending || invite.pending || approval.pending;
  const link = invitation ? createPlayInviteLink(location.origin, invitation.code) : '';

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);

  const applyView = useCallback((view: PlayRoomView) => {
    if (lifetime.current.signal.aborted) return false;
    const previous = currentView.current;
    if (
      previous &&
      previous.id === view.id &&
      (previous.revision > view.revision ||
        (previous.revision === view.revision &&
          Date.parse(previous.serverTime) > Date.parse(view.serverTime)))
    )
      return false;
    if (previous && previous.ownSeat !== view.ownSeat) admissionEpoch.current++;
    currentView.current = view;
    setRoom(view);
    return true;
  }, []);

  const load = useCallback(
    async (signal: AbortSignal) => {
      const sequence = ++readSequence.current;
      try {
        const view = await playFetch(path, playRoomViewSchema, { signal });
        if (signal.aborted || sequence !== readSequence.current || !applyView(view)) return null;
        if (view.ownSeat === 'HOST' && view.status === 'WAITING' && !view.guest) {
          const [currentInvite, candidates] = await Promise.all([
            playFetch(`${path}/invitations`, playInvitationViewSchema.nullable(), { signal }),
            playFetch(`${path}/join-requests`, playPendingRequestListSchema, { signal }),
          ]);
          if (signal.aborted || sequence !== readSequence.current || currentView.current !== view)
            return null;
          setInvitation((previous) =>
            previous && currentInvite && previous.generation > currentInvite.generation
              ? previous
              : currentInvite
          );
          setRequests(candidates.requests);
          setInviteLoaded(true);
        } else {
          setInvitation(null);
          setRequests([]);
          setInviteLoaded(true);
        }
        return view;
      } catch (caught) {
        if (
          !signal.aborted &&
          sequence === readSequence.current &&
          caught instanceof PlayHttpError &&
          [401, 403].includes(caught.status)
        ) {
          admissionEpoch.current++;
          currentView.current = null;
          setRoom(null);
          setInvitation(null);
          setRequests([]);
        }
        throw caught;
      }
    },
    [path, applyView, playFetch]
  );
  const polling = usePlayPoll(load);

  const refresh = useCallback(async () => {
    if (lifetime.current.signal.aborted) return null;
    try {
      return await load(lifetime.current.signal);
    } catch (caught) {
      if (!lifetime.current.signal.aborted) setNotice(playErrorMessage(caught));
      return null;
    }
  }, [load]);

  const rotate = useCallback(
    async (expectedRevision: number) => {
      const epoch = admissionEpoch.current;
      const result = await runInvite(`${path}/invitations`, {
        actionId: newPlayActionId(),
        expectedRevision,
      });
      if (result && epoch === admissionEpoch.current && !lifetime.current.signal.aborted) {
        setInvitation(result);
        await refresh();
      }
    },
    [runInvite, path, refresh]
  );

  useEffect(() => {
    if (
      !hostWaiting ||
      !inviteLoaded ||
      invitation ||
      room?.revision !== 0 ||
      automaticInvite.current
    )
      return;
    automaticInvite.current = true;
    void rotate(0);
  }, [hostWaiting, inviteLoaded, invitation, room?.revision, rotate]);

  useEffect(() => {
    if (!link) return;
    let cancelled = false;
    void QRCode.toDataURL(link, {
      width: 280,
      margin: 2,
      color: { dark: '#1E2128', light: '#FFFFFF' },
    })
      .then((data) => {
        if (!cancelled) setQr({ link, data });
      })
      .catch(() => {
        if (!cancelled)
          setQrError({
            link,
            message: 'The QR code could not be created. Share the link or code.',
          });
      });
    return () => {
      cancelled = true;
    };
  }, [link]);

  const command = async (value: PlayRoundCommand) => {
    if (!room || busy || roundCommand.current) return false;
    roundCommand.current = true;
    setReconciling(true);
    const epoch = admissionEpoch.current;
    let displayed = room;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const outcome = await action.runOutcome(`${path}/actions`, {
          actionId: newPlayActionId(),
          expectedRevision: displayed.revision,
          command: value,
        });
        if (epoch !== admissionEpoch.current || lifetime.current.signal.aborted) return false;
        if (outcome.kind === 'OK') {
          applyView(outcome.value);
          void refresh();
          return true;
        }
        const fresh = await refresh();
        if (
          attempt !== 0 ||
          outcome.kind !== 'REFUSED' ||
          outcome.status !== 409 ||
          !fresh ||
          epoch !== admissionEpoch.current ||
          fresh.ownSeat !== room.ownSeat ||
          fresh.round?.id !== room.round?.id ||
          fresh.revision <= displayed.revision ||
          !fresh.round?.allowedActions.includes(value.type) ||
          !canReconcileCommit(value, room.round, fresh.round)
        )
          return false;
        displayed = fresh;
      }
      return false;
    } finally {
      roundCommand.current = false;
      if (!lifetime.current.signal.aborted) setReconciling(false);
    }
  };
  const roomAction = async (type: PlayRoomView['allowedActions'][number]) => {
    if (!room || busy) return;
    const epoch = admissionEpoch.current;
    const result = await action.run(`${path}/actions`, {
      actionId: newPlayActionId(),
      expectedRevision: room.revision,
      type,
    });
    if (epoch !== admissionEpoch.current || lifetime.current.signal.aborted) return;
    if (!result) {
      await refresh();
      return;
    }
    if (result.id !== roomId) {
      router.push(`/play/rooms/${encodeURIComponent(result.id)}`);
      return;
    }
    applyView(result);
    await refresh();
  };
  const approve = async (
    candidate: PlayPendingRequestView,
    type: PlayPendingRequestView['allowedActions'][number]
  ) => {
    const epoch = admissionEpoch.current;
    const result = await approval.run(
      `/api/v1/play/join-requests/${encodeURIComponent(candidate.requestId)}/approve`,
      { actionId: newPlayActionId(), expectedRevision: candidate.roomRevision, type }
    );
    if (epoch !== admissionEpoch.current || lifetime.current.signal.aborted) return;
    if (result) await presence.renewNow();
    await refresh();
  };
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice('Copied. Send it to your partner.');
    } catch {
      setNotice('Copy is unavailable. Select the code or link to copy it.');
    }
  };

  if (!room)
    return (
      <main className={styles.root}>
        <Link href="/play" className={styles.back}>
          Back to play
        </Link>
        <h1>Your game</h1>
        <p role={polling.error ? 'alert' : 'status'}>{polling.error ?? 'Opening your game…'}</p>
        {polling.error && <Link href="/profiles">Check your active profile</Link>}
      </main>
    );
  return (
    <main className={styles.root}>
      <header className={styles.header}>
        <Link href="/play" className={styles.back}>
          All games
        </Link>
        <span role="status" className={styles.connection}>
          {polling.connection === 'CONNECTED'
            ? 'Connected'
            : polling.connection === 'PAUSED'
              ? 'Updates paused'
              : 'Reconnecting…'}
        </span>
      </header>
      <div className={styles.players}>
        <span>{room.host.name}</span>
        <span aria-hidden="true">×</span>
        <span>{room.guest?.name ?? 'Your partner'}</span>
      </div>
      <div className={styles.progress}>
        <span>
          {room.round
            ? `Round ${room.round.order + 1} of ${room.kind === 'MIXED' ? 6 : 2}`
            : room.status === 'WAITING'
              ? 'A game for two'
              : room.status.toLowerCase()}
        </span>
        <span>{room.points} points together</span>
      </div>
      {(polling.error || notice || presence.error) && (
        <p className={styles.notice} role={polling.error || presence.error ? 'alert' : 'status'}>
          {polling.error ?? presence.error ?? notice}
        </p>
      )}
      {[action, invite, approval].map(
        (mutation, index) =>
          mutation.error && (
            <div key={index} className={styles.notice} role="alert">
              <p>{mutation.error}</p>
              {mutation.uncertain && (
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={mutation.busy}
                  onClick={() => {
                    void mutation.retry();
                  }}
                >
                  Recover the same action
                </button>
              )}
            </div>
          )
      )}

      {room.status === 'WAITING' && (
        <section className={styles.waiting} aria-labelledby="waiting-heading">
          <h1 id="waiting-heading">
            {room.guest
              ? 'You’re both here.'
              : room.ownSeat === 'HOST'
                ? 'Save a seat for your partner.'
                : 'Your host is getting ready.'}
          </h1>
          {room.guest ? (
            <>
              <p>
                {room.ownSeat === 'HOST'
                  ? 'Start when you are both ready. You each get a language turn.'
                  : 'You are in. Your host can start the game.'}
              </p>
              {room.allowedActions.includes('START') && (
                <button
                  type="button"
                  className={styles.primary}
                  disabled={busy}
                  onClick={() => {
                    void roomAction('START');
                  }}
                >
                  Start playing
                </button>
              )}
            </>
          ) : room.ownSeat === 'HOST' ? (
            <>
              <p>Share the code, link, or QR. Stay in this game to let your partner enter.</p>
              <p className={styles.presence} role="status">
                {presence.ready
                  ? 'You’re here and waiting.'
                  : 'Keep this game in the foreground to accept entry.'}
              </p>
              {invitation ? (
                <div className={styles.invitation}>
                  <div>
                    <label htmlFor="room-code">Invitation code</label>
                    <input
                      id="room-code"
                      className={styles.code}
                      value={formatPlayInviteCode(invitation.code)}
                      readOnly
                      onFocus={(event) => event.target.select()}
                    />
                    <button
                      type="button"
                      className={styles.secondary}
                      onClick={() => {
                        void copy(formatPlayInviteCode(invitation.code));
                      }}
                    >
                      Copy code
                    </button>
                    <label htmlFor="room-link">Invitation link</label>
                    <input
                      id="room-link"
                      value={link}
                      readOnly
                      onFocus={(event) => event.target.select()}
                    />
                    <button
                      type="button"
                      className={styles.secondary}
                      onClick={() => {
                        void copy(link);
                      }}
                    >
                      Copy link
                    </button>
                  </div>
                  <div>
                    {qr?.link === link && (
                      <Image
                        src={qr.data}
                        alt="Scan to open this game invitation"
                        width={280}
                        height={280}
                        unoptimized
                        className={styles.qr}
                      />
                    )}
                    {qrError?.link === link && <p role="alert">{qrError.message}</p>}
                  </div>
                </div>
              ) : (
                <p role="status">
                  {invite.pending ? 'Making your invitation…' : 'Your invitation is not ready yet.'}
                </p>
              )}
              {inviteLoaded && !busy && (
                <button
                  type="button"
                  className={styles.quiet}
                  onClick={() => {
                    void rotate(room.revision);
                  }}
                >
                  {invitation ? 'Replace invitation code' : 'Create invitation'}
                </button>
              )}
              <section className={styles.requests} aria-labelledby="room-requests-heading">
                <h2 id="room-requests-heading">At the door</h2>
                {requests.length === 0 ? (
                  <p>No requests yet. Your partner will appear here.</p>
                ) : (
                  <AdmissionRequests
                    requests={requests}
                    approveAndEnter
                    busy={busy || !presence.ready}
                    onAction={approve}
                  />
                )}
              </section>
            </>
          ) : (
            <p>Waiting for your host.</p>
          )}
        </section>
      )}

      {room.status === 'PLAYING' && room.round && (
        <>
          <RoundPlay
            key={`${room.round.id}:${room.ownSeat}`}
            round={room.round}
            busy={busy}
            onCommand={command}
          />
          <PhraseCapture
            key={`save:${room.round.id}:${room.ownSeat}`}
            roomId={room.id}
            round={room.round}
          />
          {room.allowedActions.includes('NEXT_ROUND') && (
            <button
              type="button"
              className={styles.primary}
              disabled={busy}
              onClick={() => {
                void roomAction('NEXT_ROUND');
              }}
            >
              {room.round.order + 1 === (room.kind === 'MIXED' ? 6 : 2)
                ? 'See your recap'
                : 'Next round. Swap turns.'}
            </button>
          )}
        </>
      )}

      {room.status === 'COMPLETED' && (
        <section className={styles.recap} aria-labelledby="recap-heading">
          <span className={styles.eyebrow}>A few new things to say</span>
          <h1 id="recap-heading">That was your game.</h1>
          <p>{room.points} points together. Keep the words you want to use again.</p>
          {room.allowedActions.includes('REMATCH') && (
            <button
              type="button"
              className={styles.primary}
              disabled={busy}
              onClick={() => {
                void roomAction('REMATCH');
              }}
            >
              Play another together
            </button>
          )}
          {room.rematchRoomId && (
            <Link
              className={styles.nextGame}
              href={`/play/rooms/${encodeURIComponent(room.rematchRoomId)}`}
            >
              Your next game is ready
            </Link>
          )}
          {room.completedRounds.map((round) => (
            <details key={round.id} className={styles.roundRecap}>
              <summary>
                Round {round.order + 1} ·{' '}
                {round.mode === 'KNOW_ME'
                  ? 'Pick & predict'
                  : round.mode === 'DESCRIBE'
                    ? 'Describe & guess'
                    : 'Secret mission'}{' '}
                · {round.result?.skipped ? 'skipped' : `${round.result?.points ?? 0} points`}
              </summary>
              <RoundPlay round={round} busy onCommand={command} />
              <PhraseCapture roomId={room.id} round={round} />
            </details>
          ))}
          <Link href="/play" className={styles.back}>
            Open your phrase notebook
          </Link>
        </section>
      )}
      {(room.status === 'CANCELLED' || room.status === 'EXPIRED') && (
        <section className={styles.waiting}>
          <h1>{room.status === 'EXPIRED' ? 'This game has expired.' : 'This game has ended.'}</h1>
          <p>You can make another game. Saved phrases stay in your private notebook.</p>
          <Link href="/play" className={styles.nextGame}>
            Back to play
          </Link>
        </section>
      )}
      {(room.allowedActions.includes('LEAVE') || room.allowedActions.includes('CANCEL')) && (
        <footer className={styles.footer}>
          <button
            type="button"
            className={styles.quiet}
            disabled={busy}
            onClick={() => {
              void roomAction(room.allowedActions.includes('CANCEL') ? 'CANCEL' : 'LEAVE');
            }}
          >
            End this game
          </button>
        </footer>
      )}
    </main>
  );
}
