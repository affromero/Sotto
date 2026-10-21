'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createPlayAppLink,
  createPlayInviteLink,
  meResponseSchema,
  parsePlayInviteLink,
  playAcknowledgedSchema,
  playDeliverySchema,
  playInvitationPreviewSchema,
  playJoinStatusViewSchema,
  playRoomViewSchema,
  type PlayInviteEnvelope,
  type PlayJoinStatusView,
  type PlaySettings,
} from '@sotto/shared';
import type { z } from 'zod';
import type { PlayDistribution } from '@/lib/play/install/distribution';
import { PlayInstallOptions } from '@/components/pwa/PlayInstallOptions';
import { PlayLanguageFields, validPlaySettings } from './PlayLanguageFields';
import { newPlayActionId, newPlayProof, playErrorMessage, playFetch } from './client/api';
import {
  clearPendingPlayAdmission,
  clearPlayInvitationIntent,
  readPendingPlayAdmission,
  rememberPlayInvitation,
  savePendingPlayAdmission,
  type PendingPlayAdmission,
} from './client/intent';
import { usePlayPoll } from './client/usePlayPoll';
import styles from './PlayJoin.module.css';

type Preview = z.infer<typeof playInvitationPreviewSchema>;
type Member = { id: string; name: string | null };
const statusText: Record<PlayJoinStatusView['status'], string> = {
  WAITING_FOR_OWNER: 'The server owner needs to approve your new profile.',
  WAITING_FOR_HOST: 'Your profile is ready. The game host needs to let you enter.',
  HOST_UNAVAILABLE: 'Your host needs to return to the waiting game before you can enter.',
  ACCEPTED: 'Your host accepted. Opening the game…',
  CLAIMED: 'Your game connection is ready. Recovering your place…',
  DECLINED: 'This request was declined.',
  EXPIRED: 'This request has expired. Ask your partner for a new invitation.',
  REVOKED: 'This invitation has been replaced or the game has ended.',
};

export function PlayJoin({
  distribution,
  installationError,
}: {
  distribution: PlayDistribution;
  installationError: string | null;
}) {
  const router = useRouter();
  const [invitation, setInvitation] = useState<PlayInviteEnvelope | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [member, setMember] = useState<Member | null | undefined>(undefined);
  const [pending, setPending] = useState<PendingPlayAdmission | null>(null);
  const [otherPending, setOtherPending] = useState<PendingPlayAdmission | null>(null);
  const [status, setStatus] = useState<PlayJoinStatusView | null>(null);
  const [settings, setSettings] = useState<PlaySettings>({
    nativeLang: 'en',
    targetLang: 'de',
    level: 'A1',
  });
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const claiming = useRef(false);
  const intake = useRef(false);
  const active = useRef(false);
  const flow = useRef<AbortController | null>(null);
  const foreign =
    invitation !== null &&
    typeof location !== 'undefined' &&
    invitation.serverUrl !== location.origin;

  const loadMember = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch('/api/v1/users/me', {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal,
    });
    signal?.throwIfAborted();
    if (response.status === 401) {
      setMember(null);
      return null;
    }
    if (!response.ok)
      throw new Error('Could not check your current profile. Reconnect before joining.');
    const parsed = meResponseSchema.safeParse(await response.json());
    if (!parsed.success)
      throw new Error('Could not read your current profile. Reconnect before joining.');
    signal?.throwIfAborted();
    const current = { id: parsed.data.id, name: parsed.data.name ?? null };
    setMember(current);
    return current;
  }, []);

  useEffect(() => {
    active.current = true;
    const pause = () => {
      if (document.visibilityState !== 'visible') flow.current?.abort();
    };
    const leave = () => flow.current?.abort();
    document.addEventListener('visibilitychange', pause);
    window.addEventListener('pagehide', leave);
    return () => {
      active.current = false;
      flow.current?.abort();
      document.removeEventListener('visibilitychange', pause);
      window.removeEventListener('pagehide', leave);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const envelope = parsePlayInviteLink(location.href);
      if (!envelope) {
        setError('This invitation link is invalid. Ask your partner to share it again.');
        return;
      }
      setInvitation(envelope);
      try {
        rememberPlayInvitation(envelope);
        if (envelope.serverUrl !== location.origin) return;
        const restored = readPendingPlayAdmission();
        if (restored?.command.code === envelope.code) setPending(restored);
        else if (restored) setOtherPending(restored);
      } catch (caught) {
        setError(playErrorMessage(caught));
      }
      if (envelope.serverUrl === location.origin)
        void loadMember(controller.signal).catch((caught: unknown) => {
          if (!controller.signal.aborted) setError(playErrorMessage(caught));
        });
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [loadMember]);

  const load = useCallback(
    async (signal: AbortSignal) => {
      if (!invitation || invitation.serverUrl !== location.origin || intake.current) return;
      if (pending) {
        const result = await playFetch(
          `/api/v1/play/join-requests/${encodeURIComponent(pending.command.requestId)}`,
          playJoinStatusViewSchema,
          { proof: pending.proof, signal }
        );
        if (!signal.aborted) setStatus(result);
        return;
      }
      const result = await playFetch(
        `/api/v1/play/invitations?code=${encodeURIComponent(invitation.code)}`,
        playInvitationPreviewSchema,
        { signal }
      );
      if (!signal.aborted) setPreview(result);
    },
    [invitation, pending]
  );
  const polling = usePlayPoll(load);

  const needsProfileSwitch =
    pending?.command.candidate.kind === 'NEW' &&
    member !== null &&
    member !== undefined &&
    member.id !== pending.received?.profileId;
  const wrongExistingProfile =
    pending?.command.candidate.kind === 'EXISTING' && member?.id !== pending.originalProfileId;

  const enter = useCallback(
    async (approvedSwitchProfileId?: string) => {
      if (!pending || claiming.current || intake.current || !active.current) return;
      claiming.current = true;
      const controller = new AbortController();
      flow.current = controller;
      const signal = controller.signal;
      setBusy(true);
      setError(null);
      try {
        const current = await loadMember(signal);
        signal.throwIfAborted();
        if (
          pending.command.candidate.kind === 'EXISTING' &&
          current?.id !== pending.originalProfileId
        )
          throw new Error('Your active profile changed. Choose the invited profile again.');
        if (
          pending.command.candidate.kind === 'NEW' &&
          current &&
          current.id !== pending.received?.profileId &&
          current.id !== approvedSwitchProfileId
        )
          return;
        let receipt = pending.received;
        if (!receipt || current?.id !== receipt.profileId) {
          const delivery = await playFetch(
            `/api/v1/play/join-requests/${encodeURIComponent(pending.command.requestId)}/claim`,
            playDeliverySchema,
            { body: { expectedProfileId: current?.id ?? null }, proof: pending.proof, signal }
          );
          signal.throwIfAborted();
          if (delivery.kind === 'NATIVE')
            throw new Error('This admission belongs to a native app. Open the invitation there.');
          if (delivery.kind === 'EXISTING') {
            if (delivery.profile.id !== pending.originalProfileId)
              throw new Error(
                'This delivery belongs to a different profile. Choose the invited profile again.'
              );
            const room = await playFetch(
              `/api/v1/play/rooms/${encodeURIComponent(delivery.roomId)}`,
              playRoomViewSchema,
              { signal }
            );
            signal.throwIfAborted();
            const own = room.ownSeat === 'HOST' ? room.host : room.guest;
            if (own?.id !== delivery.profile.id)
              throw new Error('Your active profile changed. Choose the invited profile again.');
            clearPendingPlayAdmission();
            clearPlayInvitationIntent();
            setPending(null);
            router.replace(`/play/rooms/${encodeURIComponent(room.id)}`);
            return;
          }
          receipt = {
            deliveryId: delivery.deliveryId,
            roomId: delivery.roomId,
            profileId: delivery.profile.id,
          };
          const received = { ...pending, received: receipt };
          signal.throwIfAborted();
          savePendingPlayAdmission(received);
          setPending(received);
        }
        const room = await playFetch(
          `/api/v1/play/rooms/${encodeURIComponent(receipt.roomId)}`,
          playRoomViewSchema,
          { signal }
        );
        signal.throwIfAborted();
        const own = room.ownSeat === 'HOST' ? room.host : room.guest;
        if (own?.id !== receipt.profileId)
          throw new Error(
            'Your active profile changed. Restore the invited profile before entering.'
          );
        await playFetch(
          `/api/v1/play/join-requests/${encodeURIComponent(pending.command.requestId)}/ack`,
          playAcknowledgedSchema,
          { body: { deliveryId: receipt.deliveryId }, proof: pending.proof, signal }
        );
        signal.throwIfAborted();
        clearPendingPlayAdmission();
        clearPlayInvitationIntent();
        setPending(null);
        router.replace(`/play/rooms/${encodeURIComponent(room.id)}`);
      } catch (caught) {
        if (!signal.aborted) setError(playErrorMessage(caught));
      } finally {
        claiming.current = false;
        if (flow.current === controller) flow.current = null;
        if (active.current) setBusy(false);
      }
    },
    [pending, loadMember, router]
  );

  useEffect(() => {
    if (
      document.visibilityState !== 'visible' ||
      error ||
      !status ||
      !['ACCEPTED', 'CLAIMED'].includes(status.status)
    )
      return;
    const timer = setTimeout(() => {
      void enter();
    }, 0);
    return () => clearTimeout(timer);
  }, [status, enter, error]);

  const requestEntry = async () => {
    if (!invitation || !preview || member === undefined || intake.current || otherPending) return;
    intake.current = true;
    const controller = new AbortController();
    flow.current = controller;
    const signal = controller.signal;
    setBusy(true);
    setError(null);
    try {
      const current = await loadMember(signal);
      signal.throwIfAborted();
      if ((current?.id ?? null) !== (member?.id ?? null))
        throw new Error('Your active profile changed. Check the profile shown before joining.');
      const candidate: PendingPlayAdmission = {
        version: 1,
        serverUrl: invitation.serverUrl,
        proof: newPlayProof(),
        originalProfileId: current?.id ?? null,
        savedAt: Date.now(),
        received: null,
        command: {
          requestId: newPlayActionId(),
          code: invitation.code,
          client: 'BROWSER',
          deviceName: 'Sotto web app',
          candidate: current
            ? { kind: 'EXISTING', expectedProfileId: current.id, settings }
            : { kind: 'NEW', name: name.trim(), settings, consentToProfile: true },
        },
      };
      savePendingPlayAdmission(candidate);
      setPending(candidate);
      const result = await playFetch('/api/v1/play/invitations', playJoinStatusViewSchema, {
        body: candidate.command,
        proof: candidate.proof,
        signal,
      });
      signal.throwIfAborted();
      setStatus(result);
    } catch (caught) {
      if (!signal.aborted) setError(playErrorMessage(caught));
    } finally {
      intake.current = false;
      if (flow.current === controller) flow.current = null;
      if (active.current) setBusy(false);
    }
  };

  const retryRequest = async () => {
    if (!pending || busy || intake.current || claiming.current) return;
    intake.current = true;
    const controller = new AbortController();
    flow.current = controller;
    const signal = controller.signal;
    setBusy(true);
    setError(null);
    try {
      const current = await loadMember(signal);
      signal.throwIfAborted();
      if ((current?.id ?? null) !== pending.originalProfileId)
        throw new Error('Your active profile changed. Restore the profile that requested entry.');
      const result = await playFetch('/api/v1/play/invitations', playJoinStatusViewSchema, {
        body: pending.command,
        proof: pending.proof,
        signal,
      });
      signal.throwIfAborted();
      setStatus(result);
    } catch (caught) {
      if (!signal.aborted) setError(playErrorMessage(caught));
    } finally {
      intake.current = false;
      if (flow.current === controller) flow.current = null;
      if (active.current) setBusy(false);
    }
  };
  const forget = () => {
    try {
      clearPendingPlayAdmission();
      clearPlayInvitationIntent();
      setPending(null);
      setOtherPending(null);
      setStatus(null);
      setError(null);
    } catch (caught) {
      setError(playErrorMessage(caught));
    }
  };
  const cards =
    !!preview && ['MIXED', 'KNOW_ME'].includes(preview.kind) && preview.questionStyle === 'CHOICES';

  return (
    <main className={styles.root}>
      <Link href="/" className={styles.brand}>
        Sotto
      </Link>
      <header className={styles.header}>
        <span className={styles.eyebrow}>There’s a seat for you</span>
        <h1>{preview ? `${preview.hostName} invited you to play.` : 'A game for two.'}</h1>
        <p>
          Cards, clues, and little language adventures. Your host stays in the game to welcome you.
        </p>
      </header>
      {invitation && (
        <p className={styles.server}>
          Your game server: <strong>{invitation.serverUrl}</strong>
        </p>
      )}
      {(error || polling.error) && (
        <p role="alert" className={styles.error}>
          {error ?? polling.error}
        </p>
      )}
      {invitation && (
        <a className={styles.native} href={createPlayAppLink(invitation)}>
          Open in the Sotto app
        </a>
      )}
      {foreign && invitation ? (
        <section className={styles.panel}>
          <h2>Continue to your partner’s server</h2>
          <p>Open the invitation on the server shown above. Your current connection stays here.</p>
          <a
            className={styles.primary}
            href={createPlayInviteLink(invitation.serverUrl, invitation.code)}
            rel="noreferrer"
          >
            Continue to the game server
          </a>
        </section>
      ) : (
        invitation && (
          <section className={styles.panel} aria-labelledby="join-in-browser-heading">
            <h2 id="join-in-browser-heading">Play in this browser</h2>
            {otherPending ? (
              <>
                <p>You have another pending invitation on this server.</p>
                <a
                  className={styles.primary}
                  href={createPlayInviteLink(otherPending.serverUrl, otherPending.command.code)}
                >
                  Resume your earlier invitation
                </a>
                <button className={styles.secondary} type="button" onClick={forget}>
                  Use this invitation instead
                </button>
              </>
            ) : pending ? (
              <>
                <p role="status" className={styles.status}>
                  {status ? statusText[status.status] : 'Recovering your request…'}
                </p>
                {wrongExistingProfile && (
                  <p>
                    Choose the profile that requested entry.{' '}
                    <Link href="/profiles">Open profiles</Link>
                  </p>
                )}
                {needsProfileSwitch && (
                  <>
                    <p>
                      This browser is currently signed in as {member?.name ?? 'another profile'}.
                    </p>
                    <button
                      type="button"
                      className={styles.primary}
                      disabled={busy || !status || !['ACCEPTED', 'CLAIMED'].includes(status.status)}
                      onClick={() => {
                        if (member) void enter(member.id);
                      }}
                    >
                      Switch this browser to{' '}
                      {pending.command.candidate.kind === 'NEW'
                        ? pending.command.candidate.name
                        : 'the invited profile'}{' '}
                      and enter
                    </button>
                  </>
                )}
                {error && (
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={busy}
                    onClick={() => {
                      if (status && ['ACCEPTED', 'CLAIMED'].includes(status.status)) {
                        setError(null);
                        void enter();
                      } else void retryRequest();
                    }}
                  >
                    {status && ['ACCEPTED', 'CLAIMED'].includes(status.status)
                      ? 'Recover my game connection'
                      : 'Retry the same join request'}
                  </button>
                )}
                <button type="button" className={styles.quiet} disabled={busy} onClick={forget}>
                  Leave this invitation
                </button>
              </>
            ) : preview && member !== undefined ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (validPlaySettings(settings, cards) && (member || (consent && name.trim())))
                    void requestEntry();
                }}
              >
                <p className={styles.status}>
                  {preview.hostWaiting
                    ? 'Your host is here and waiting.'
                    : 'Your host needs to return before you can enter.'}
                </p>
                {member ? (
                  <p>
                    Join as <strong>{member.name ?? 'your current profile'}</strong>.{' '}
                    <Link href="/profiles">Choose another profile</Link>
                  </p>
                ) : (
                  <>
                    <label className={styles.name} htmlFor="join-player-name">
                      What should your partner call you?
                      <input
                        id="join-player-name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        maxLength={80}
                        autoComplete="given-name"
                        required
                        disabled={busy}
                      />
                    </label>
                    <label className={styles.consent}>
                      <input
                        type="checkbox"
                        checked={consent}
                        onChange={(event) => setConsent(event.target.checked)}
                        required
                        disabled={busy}
                      />
                      <span>
                        Create a persistent profile for me on this server if its owner approves. The
                        game host also controls entry.
                      </span>
                    </label>
                    <p className={styles.small}>
                      Already have a profile here? <Link href="/profiles">Choose your profile</Link>
                    </p>
                  </>
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
                  disabled={
                    busy ||
                    !validPlaySettings(settings, cards) ||
                    (!member && (!consent || !name.trim()))
                  }
                >
                  Ask to join{member?.name ? ` as ${member.name}` : ''}
                </button>
              </form>
            ) : (
              <>
                <p role="status">
                  {preview ? 'Checking your current profile…' : 'Checking this invitation…'}
                </p>
                {error && (
                  <button
                    type="button"
                    className={styles.secondary}
                    onClick={() => {
                      setError(null);
                      void loadMember().catch((caught: unknown) =>
                        setError(playErrorMessage(caught))
                      );
                    }}
                  >
                    Reconnect
                  </button>
                )}
              </>
            )}
          </section>
        )
      )}
      <PlayInstallOptions
        distribution={distribution}
        error={installationError}
        allowWeb={invitation !== null && !foreign}
      />
    </main>
  );
}
