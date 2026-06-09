'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { GlassBead } from '@/components/landing/GlassBead';
import { AvatarTile } from './AvatarTile';
import styles from './ProfilePicker.module.css';

interface Profile {
  id: string;
  name: string | null;
  image: string | null;
  emoji: string | null;
  isAdmin: boolean;
}

interface ProfilesResponse {
  localAuth: boolean;
  profiles: Profile[];
}

type LoadState = 'loading' | 'ready' | 'error';

const GENERIC_PASSWORD_ERROR = 'That password did not work. Please try again.';
const SKELETON_COUNT = 6;

/**
 * Netflix-style household sign-in. Lists local profiles, lets the learner pick
 * one, and reveals an inline password panel below the grid. Submits to the
 * Credentials provider via signIn and routes to /learn on success. Errors are
 * always generic, so the panel never reveals which field was wrong, and the
 * password is never displayed or logged.
 */
export function ProfilePicker() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>('loading');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<Profile | null>(null);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const passwordId = useId();
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // state already initializes to 'loading'; this effect runs once on mount.
    let active = true;
    fetch('/api/auth/profiles', { headers: { accept: 'application/json' } })
      .then(async (res) => {
        if (!res.ok) throw new Error('request failed');
        const data: ProfilesResponse = await res.json();
        if (!active) return;
        setProfiles(Array.isArray(data?.profiles) ? data.profiles : []);
        setState('ready');
      })
      .catch(() => {
        if (active) setState('error');
      });
    return () => {
      active = false;
    };
  }, []);

  // Move focus to the password field when a profile is chosen.
  useEffect(() => {
    if (selected) passwordRef.current?.focus();
  }, [selected]);

  function choose(profile: Profile) {
    setSelected(profile);
    setPassword('');
    setAuthError(null);
  }

  function backToProfiles() {
    setSelected(null);
    setPassword('');
    setAuthError(null);
    setSubmitting(false);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || submitting || password.length === 0) return;

    setSubmitting(true);
    setAuthError(null);
    try {
      const result = await signIn('credentials', {
        userId: selected.id,
        password,
        redirect: false,
      });
      if (result?.ok) {
        router.push('/learn');
        return;
      }
      // Any non-ok outcome stays generic. Keep the field, clear the entry.
      setAuthError(GENERIC_PASSWORD_ERROR);
      setPassword('');
      setSubmitting(false);
      passwordRef.current?.focus();
    } catch {
      setAuthError(GENERIC_PASSWORD_ERROR);
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.root}>
      <main className={styles.shell}>
        <Link href="/" className={styles.wordmark} aria-label="Sotto home">
          <GlassBead className={styles.wordmarkBead} />
          <span className={styles.wordmarkText}>sotto</span>
        </Link>

        {state === 'loading' && <PickerSkeleton />}

        {state === 'error' && (
          <div className={styles.stateBlock} role="alert">
            <p className={styles.eyebrow}>
              <span className={styles.eyebrowDash} />
              Sign in
            </p>
            <h1 className={styles.heading}>We could not load your profiles.</h1>
            <p className={styles.lede}>
              Check your connection, then refresh. You can also sign in another way.
            </p>
            <a className={styles.altLink} href="/auth/login?oauth=1">
              Sign in another way
            </a>
          </div>
        )}

        {state === 'ready' && !selected && (
          <div className={styles.stateBlock}>
            <p className={styles.eyebrow}>
              <span className={styles.eyebrowDash} />
              Sign in
            </p>
            <h1 className={styles.heading}>
              Who is <em>learning</em> today?
            </h1>

            {profiles.length === 0 ? (
              <p className={styles.lede}>
                No profiles yet. Set one up, or sign in another way.
              </p>
            ) : (
              <ul className={styles.grid} aria-label="Choose your profile">
                {profiles.map((profile) => (
                  <li key={profile.id} className={styles.gridItem}>
                    <button
                      type="button"
                      className={styles.profileBtn}
                      onClick={() => choose(profile)}
                    >
                      <span className={styles.tileWrap}>
                        <AvatarTile
                          image={profile.image}
                          emoji={profile.emoji}
                          name={profile.name}
                          size={104}
                        />
                        {profile.isAdmin && (
                          <span className={styles.crown}>
                            <CrownGlyph />
                            <span className={styles.crownLabel}>Owner</span>
                          </span>
                        )}
                      </span>
                      <span className={styles.profileName}>
                        {profile.name ?? 'Learner'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <a className={styles.altLink} href="/auth/login?oauth=1">
              Sign in another way
            </a>
          </div>
        )}

        {state === 'ready' && selected && (
          <div className={styles.stateBlock} key={selected.id}>
            <button type="button" className={styles.back} onClick={backToProfiles}>
              <BackGlyph />
              Back to profiles
            </button>

            <div className={styles.chosen}>
              <AvatarTile
                image={selected.image}
                emoji={selected.emoji}
                name={selected.name}
                size={88}
              />
              <div className={styles.chosenText}>
                <p className={styles.eyebrow}>
                  <span className={styles.eyebrowDash} />
                  Welcome back
                </p>
                <h1 className={styles.chosenName}>{selected.name ?? 'Learner'}</h1>
              </div>
            </div>

            <form className={styles.form} onSubmit={handleSubmit} noValidate>
              <label className={styles.fieldLabel} htmlFor={passwordId}>
                Your password
              </label>
              <input
                ref={passwordRef}
                id={passwordId}
                className={styles.input}
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  if (authError) setAuthError(null);
                }}
                disabled={submitting}
                autoComplete="current-password"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="go"
                aria-invalid={authError ? true : undefined}
                aria-describedby={authError ? `${passwordId}-error` : undefined}
              />
              {authError && (
                <p id={`${passwordId}-error`} className={styles.fieldError} role="alert">
                  {authError}
                </p>
              )}
              <button
                type="submit"
                className={styles.submit}
                disabled={submitting || password.length === 0}
              >
                {submitting ? 'Signing in.' : 'Sign in'}
              </button>
            </form>

            <a className={styles.altLink} href="/auth/login?oauth=1">
              Sign in another way
            </a>
          </div>
        )}
      </main>
    </div>
  );
}

function PickerSkeleton() {
  return (
    <div className={styles.stateBlock} aria-busy="true" aria-live="polite">
      <p className={styles.eyebrow}>
        <span className={styles.eyebrowDash} />
        Loading profiles
      </p>
      <div className={`${styles.skeletonHeading} ${styles.shimmer}`} />
      <ul className={styles.grid} aria-hidden="true">
        {Array.from({ length: SKELETON_COUNT }).map((_, index) => (
          <li key={index} className={styles.gridItem}>
            <span className={styles.tileWrap}>
              <span className={`${styles.skeletonTile} ${styles.shimmer}`} />
            </span>
            <span className={`${styles.skeletonName} ${styles.shimmer}`} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function CrownGlyph() {
  return (
    <svg
      width={13}
      height={13}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8z" />
    </svg>
  );
}

function BackGlyph() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </svg>
  );
}
