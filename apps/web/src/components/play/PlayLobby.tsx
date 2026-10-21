'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import {
  normalizePlayInviteCode,
  playPendingRequestListSchema,
  playPendingRequestViewSchema,
  playRoomListSchema,
  playRoomViewSchema,
  type PlayPendingRequestView,
  type PlayRoomView,
  type PlaySettings,
  type PlayTheme,
} from '@sotto/shared';
import { AdmissionRequests } from './AdmissionRequests';
import { PlayLanguageFields, validPlaySettings } from './PlayLanguageFields';
import { PlayNotebook } from './PlayNotebook';
import { PlayHttpError, playErrorMessage, newPlayActionId } from './client/api';
import { usePlayRequest } from './client/profile';
import { rememberPlayInvitation } from './client/intent';
import { usePlayMutation } from './client/usePlayMutation';
import { usePlayPoll } from './client/usePlayPoll';
import { usePlaySafetyStatus } from './safety/safety-client';
import styles from './PlayLobby.module.css';

const modes = [
  {
    id: 'MIXED',
    title: 'A little of everything',
    detail: '6 rounds. Cards, clues and a secret mission.',
  },
  { id: 'KNOW_ME', title: 'Pick & predict', detail: '2 rounds. Pick a card and see if you match.' },
  {
    id: 'DESCRIBE',
    title: 'Describe & guess',
    detail: '2 rounds. One secret word, one good clue.',
  },
  {
    id: 'MISSION',
    title: 'Secret mission',
    detail: '2 rounds. Six lines, two secrets and a twist.',
  },
] as const;
const themes: { id: PlayTheme; title: string }[] = [
  { id: 'EVERYDAY', title: 'Everyday things' },
  { id: 'FOOD', title: 'Food & drink' },
  { id: 'TRAVEL', title: 'Out in the world' },
  { id: 'SILLY', title: 'Make it silly' },
  { id: 'GET_TO_KNOW_YOU', title: 'Getting to know you' },
  { id: 'AFFECTIONATE', title: 'Just us' },
];

export function PlayLobby({ isOwner }: { isOwner: boolean }) {
  const playFetch = usePlayRequest();
  const router = useRouter();
  const safety = usePlaySafetyStatus();
  const [kind, setKind] = useState<PlayRoomView['kind']>('MIXED');
  const [theme, setTheme] = useState<PlayTheme>('EVERYDAY');
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<PlaySettings>({
    nativeLang: 'en',
    targetLang: 'de',
    level: 'A1',
  });
  const [code, setCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<PlayRoomView[]>([]);
  const [older, setOlder] = useState<PlayRoomView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [openedOlder, setOpenedOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [requests, setRequests] = useState<PlayPendingRequestView[]>([]);
  const create = usePlayMutation(playRoomViewSchema);
  const approval = usePlayMutation(playPendingRequestViewSchema);
  const cards = (kind === 'MIXED' || kind === 'KNOW_ME') && !open;
  const busy = create.pending || approval.pending || !safety.sharingAllowed;

  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        const [page, enrollments] = await Promise.all([
          playFetch('/api/v1/play/rooms', playRoomListSchema, { signal }),
          isOwner
            ? playFetch('/api/v1/play/enrollments', playPendingRequestListSchema, { signal })
            : Promise.resolve({ requests: [] }),
        ]);
        if (signal.aborted) return;
        setRooms(page.rooms);
        setCursor(page.nextCursor);
        setRequests(enrollments.requests);
      } catch (caught) {
        if (caught instanceof PlayHttpError && [401, 403].includes(caught.status)) {
          setRooms([]);
          setOlder([]);
          setRequests([]);
        }
        throw caught;
      }
    },
    [isOwner, playFetch]
  );
  const polling = usePlayPoll(load, 5000);

  const approve = async (
    request: PlayPendingRequestView,
    type: PlayPendingRequestView['allowedActions'][number]
  ) => {
    const result = await approval.run(
      `/api/v1/play/join-requests/${encodeURIComponent(request.requestId)}/approve`,
      { actionId: newPlayActionId(), expectedRevision: request.roomRevision, type }
    );
    if (result)
      setRequests((previous) =>
        previous.filter((candidate) => candidate.requestId !== result.requestId)
      );
  };
  const showOlder = async () => {
    const beforeId = openedOlder ? olderCursor : cursor;
    if (!beforeId || loadingOlder) return;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const page = await playFetch(
        `/api/v1/play/rooms?beforeId=${encodeURIComponent(beforeId)}`,
        playRoomListSchema
      );
      setOlder((previous) => [
        ...new Map([...previous, ...page.rooms].map((room) => [room.id, room])).values(),
      ]);
      setOlderCursor(page.nextCursor);
      setOpenedOlder(true);
    } catch (caught) {
      setOlderError(playErrorMessage(caught));
    } finally {
      setLoadingOlder(false);
    }
  };
  const displayed = [
    ...rooms,
    ...older.filter((room) => !rooms.some((recent) => recent.id === room.id)),
  ];

  return (
    <main className={styles.root}>
      <header className={styles.header}>
        <span className={styles.eyebrow}>Sotto · together</span>
        <h1>
          A little language.
          <br />
          <em>A little surprise.</em>
        </h1>
        <p>
          Pick cards, trade clues, and talk your way through a secret mission. You each get a turn
          in your own language.
        </p>
      </header>
      <Link href="/play/safety" className={styles.safetyLink}>
        Game safety, blocks and reports
      </Link>
      {safety.error && (
        <p className={styles.error} role="alert">
          {safety.error}
        </p>
      )}
      {!safety.accepted && (
        <p>Read and accept this server&apos;s game conduct in Game safety before playing.</p>
      )}
      {safety.status?.sharingRestricted && (
        <p role="status">
          The server owner has restricted this profile from partner games. Your safety settings and
          private learning remain available.
        </p>
      )}
      <div className={styles.columns}>
        <section className={styles.make} aria-labelledby="new-game-heading">
          <h2 id="new-game-heading">Make a game</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (busy || !validPlaySettings(settings, cards)) return;
              void create
                .run('/api/v1/play/rooms', {
                  actionId: newPlayActionId(),
                  kind,
                  theme,
                  questionStyle: open ? 'OPEN' : 'CHOICES',
                  settings,
                })
                .then((room) => {
                  if (room) router.push(`/play/rooms/${encodeURIComponent(room.id)}`);
                });
            }}
          >
            <fieldset className={styles.modes} disabled={busy}>
              <legend>Choose your game</legend>
              {modes.map((mode) => (
                <label
                  key={mode.id}
                  className={`${styles.mode} ${kind === mode.id ? styles.selected : ''}`}
                >
                  <input
                    type="radio"
                    name="game-kind"
                    value={mode.id}
                    checked={kind === mode.id}
                    onChange={() => setKind(mode.id)}
                  />
                  <span>
                    <strong>{mode.title}</strong>
                    <small>{mode.detail}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <label className={styles.theme}>
              What are you in the mood for?
              <select
                value={theme}
                disabled={busy}
                onChange={(event) => {
                  const selected = themes.find((item) => item.id === event.target.value);
                  if (selected) setTheme(selected.id);
                }}
              >
                {themes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            {(kind === 'MIXED' || kind === 'KNOW_ME') && (
              <details className={styles.options}>
                <summary>More options</summary>
                <label>
                  <input
                    type="checkbox"
                    checked={open}
                    disabled={busy}
                    onChange={(event) => setOpen(event.target.checked)}
                  />
                  Use open questions instead of prediction cards
                </label>
              </details>
            )}
            <PlayLanguageFields
              value={settings}
              onChange={setSettings}
              cards={cards}
              disabled={busy}
            />
            <button
              type="submit"
              className={styles.primary}
              disabled={busy || !validPlaySettings(settings, cards)}
            >
              {create.pending ? 'Creating your game…' : 'Make a game for two'}
            </button>
          </form>
          {create.error && <p role="alert">{create.error}</p>}
          {create.uncertain && (
            <button
              type="button"
              className={styles.secondary}
              disabled={create.busy}
              onClick={() => {
                void create.retry();
              }}
            >
              Recover the same game
            </button>
          )}
        </section>
        <aside className={styles.join} aria-labelledby="join-game-heading">
          <span className={styles.ticket}>You’re invited</span>
          <h2 id="join-game-heading">Have a code?</h2>
          <p>Enter a code from a game on this server.</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const normalized = normalizePlayInviteCode(code);
              if (!normalized) {
                setJoinError('Enter the 12-character code from your partner.');
                return;
              }
              try {
                rememberPlayInvitation({
                  version: 1,
                  serverUrl: location.origin,
                  code: normalized,
                });
                router.push(`/play/join?v=1&code=${normalized}`);
              } catch (caught) {
                setJoinError(playErrorMessage(caught));
              }
            }}
          >
            <label htmlFor="play-join-code">Invitation code</label>
            <input
              id="play-join-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={24}
              required
            />
            <button type="submit" className={styles.secondary}>
              Find the game
            </button>
          </form>
          {joinError && <p role="alert">{joinError}</p>}
          <p className={styles.small}>
            A link or QR code can also bring you straight to the invitation.
          </p>
        </aside>
      </div>
      <section className={styles.resume} aria-labelledby="your-games-heading">
        <div className={styles.sectionHeading}>
          <h2 id="your-games-heading">Your games</h2>
          <span role="status">
            {polling.connection === 'CONNECTED'
              ? 'Up to date'
              : polling.connection === 'PAUSED'
                ? 'Updates paused'
                : polling.connection === 'RECONNECTING'
                  ? 'Reconnecting…'
                  : 'Connecting…'}
          </span>
        </div>
        {polling.error && <p role="alert">{polling.error}</p>}
        {displayed.length === 0 && polling.connection === 'CONNECTED' && (
          <p>Your next game starts here.</p>
        )}
        <ul className={styles.games}>
          {displayed.map((room) => (
            <li key={room.id}>
              <Link href={`/play/rooms/${encodeURIComponent(room.id)}`}>
                <span>
                  {room.ownSeat === 'HOST'
                    ? (room.guest?.name ?? 'Waiting for a partner')
                    : room.host.name}
                </span>
                <small>
                  {modes.find((mode) => mode.id === room.kind)?.title} · {room.status.toLowerCase()}
                  {room.status === 'COMPLETED' ? ` · ${room.points} points` : ''}
                </small>
              </Link>
            </li>
          ))}
        </ul>
        {(openedOlder ? olderCursor : cursor) && (
          <button
            type="button"
            className={styles.secondary}
            disabled={loadingOlder}
            onClick={() => {
              void showOlder();
            }}
          >
            {loadingOlder ? 'Loading…' : 'Older games'}
          </button>
        )}
        {olderError && <p role="alert">{olderError}</p>}
      </section>
      {isOwner && requests.length > 0 && (
        <section className={styles.enrollments} aria-labelledby="enrollments-heading">
          <h2 id="enrollments-heading">People waiting to join</h2>
          <p>
            A new profile needs your approval as server owner. Their game host also controls entry.
          </p>
          <AdmissionRequests
            requests={requests}
            busy={busy}
            onAction={approve}
            roomIds={displayed.map((room) => room.id)}
          />
        </section>
      )}
      {approval.error && <p role="alert">{approval.error}</p>}
      {approval.uncertain && (
        <button
          type="button"
          className={styles.secondary}
          disabled={approval.busy}
          onClick={() => {
            void approval.retry();
          }}
        >
          Recover the same approval
        </button>
      )}
      <PlayNotebook />
    </main>
  );
}
