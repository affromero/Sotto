'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { meResponseSchema } from '@sotto/shared';
import type { z } from 'zod';
import { PlayHttpError, playErrorMessage, playFetch } from './api';
import styles from './profile.module.css';

const Profile = createContext<{ profileId: string; invalidate: () => void } | null>(null);

async function verifyProfile(profileId: string, signal?: AbortSignal) {
  const response = await fetch('/api/v1/users/me', {
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    signal,
  });
  if ([401, 403].includes(response.status))
    throw new PlayHttpError(response.status, 'Choose your active profile again.');
  if (!response.ok) throw new Error('Could not check your active profile. Reconnect to continue.');
  const current = meResponseSchema.parse(await response.json());
  signal?.throwIfAborted();
  if (current.id !== profileId)
    throw new PlayHttpError(403, 'Your active profile changed in another tab.');
}

/** Keep cached game and notebook data attached to the server-rendered learner. */
export function PlayProfileBoundary({
  profileId,
  children,
}: {
  profileId: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [verified, setVerified] = useState(false);
  const [checking, setChecking] = useState(true);
  const [hidden, setHidden] = useState(true);
  const [changed, setChanged] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const invalidate = useCallback(() => setChanged(true), []);
  const value = useMemo(() => ({ profileId, invalidate }), [profileId, invalidate]);
  useEffect(() => {
    let disposed = false;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async (foreground: boolean) => {
      clearTimeout(timer);
      controller?.abort();
      if (document.visibilityState !== 'visible') {
        setHidden(true);
        return;
      }
      const current = new AbortController();
      controller = current;
      setChecking(true);
      if (foreground) setHidden(true);
      try {
        await verifyProfile(profileId, current.signal);
        if (disposed || current.signal.aborted) return;
        setVerified(true);
        setChecking(false);
        setHidden(false);
        setError(null);
      } catch (caught) {
        if (disposed || current.signal.aborted) return;
        setChecking(false);
        setError(playErrorMessage(caught));
        if (caught instanceof PlayHttpError && [401, 403].includes(caught.status)) {
          setChanged(true);
          return;
        }
      }
      if (!disposed && !current.signal.aborted)
        timer = setTimeout(() => {
          void check(false);
        }, 5000);
    };
    const resume = () => {
      void check(true);
    };
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', resume);
    timer = setTimeout(resume, 0);
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [profileId, attempt]);
  if (changed)
    return (
      <section className={styles.notice} role="alert">
        <h1>Your active profile changed.</h1>
        <p>Reload Play to continue with your current profile.</p>
        <button
          type="button"
          onClick={() => {
            setVerified(false);
            setChecking(true);
            setHidden(true);
            setError(null);
            setChanged(false);
            setAttempt((previous) => previous + 1);
            router.refresh();
          }}
        >
          Use current profile
        </button>
      </section>
    );
  return (
    <Profile.Provider value={value}>
      {error && (
        <p className={styles.notice} role="alert">
          {error}
        </p>
      )}
      {(!verified || hidden) && (
        <p className={styles.notice} role="status">
          Checking your active profile…
        </p>
      )}
      {verified && (
        <fieldset className={styles.root} disabled={checking || error !== null} hidden={hidden}>
          {children}
        </fieldset>
      )}
    </Profile.Provider>
  );
}

export function usePlayRequest() {
  const profile = useContext(Profile);
  return useCallback(
    function request<Schema extends z.ZodType>(
      path: string,
      schema: Schema,
      options: Parameters<typeof playFetch>[2] = {}
    ): Promise<z.infer<Schema>> {
      return playFetch(path, schema, { ...options, expectedProfileId: profile?.profileId }).catch(
        async (caught: unknown) => {
          if (profile && caught instanceof PlayHttpError && [401, 403].includes(caught.status)) {
            try {
              await verifyProfile(profile.profileId, options.signal);
            } catch (identityError) {
              if (
                !options.signal?.aborted &&
                identityError instanceof PlayHttpError &&
                [401, 403].includes(identityError.status)
              )
                profile.invalidate();
            }
          }
          throw caught;
        }
      );
    },
    [profile]
  );
}

export function usePlayProfileGuard() {
  const profile = useContext(Profile);
  return useCallback(
    async (signal?: AbortSignal) => {
      if (!profile) return;
      try {
        await verifyProfile(profile.profileId, signal);
      } catch (caught) {
        if (
          !signal?.aborted &&
          caught instanceof PlayHttpError &&
          [401, 403].includes(caught.status)
        )
          profile.invalidate();
        throw caught;
      }
    },
    [profile]
  );
}
