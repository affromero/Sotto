'use client';

import Image from 'next/image';
import { useState } from 'react';
import { ANIMAL_AVATARS } from '@/lib/avatars';
import { Glyph } from '../Glyph';
import { TimezoneGlobe } from '../timezone/TimezoneGlobe';
import t from '../theme.module.css';
import c from '../components.styles';

interface Props {
  name: string;
  avatarSlug: string;
  timezone: string;
  demoMode: boolean;
  setName: (name: string) => void;
  setAvatarSlug: (slug: string) => void;
  setTimezone: (tz: string) => void;
  onNext: () => void;
  onBack: () => void;
}

export function StepLearnerProfile({
  name,
  avatarSlug,
  timezone,
  demoMode,
  setName,
  setAvatarSlug,
  setTimezone,
  onNext,
  onBack,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleanName = name.trim();
  const selectedAvatar =
    ANIMAL_AVATARS.find((avatar) => avatar.slug === avatarSlug) ?? ANIMAL_AVATARS[0];

  async function saveAndContinue() {
    if (!cleanName || saving) return;
    setError(null);

    if (demoMode) {
      onNext();
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/v1/onboarding/name', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cleanName,
          avatarSlug,
          ...(timezone && { timezone }),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Could not save the admin profile');
      }
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the admin profile');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={t.stepEnter}>
      <div className={t.eyebrow}>
        <span className={t.eyebrowIdx}>01 ·</span> Profile
      </div>
      <h1 className={t.title}>
        Who&apos;s <em>learning</em>?
      </h1>
      <p className={t.lede}>
        Set up the first learner. On a self hosted Sotto, that first learner is the admin and keeps
        access to the admin panel after onboarding.
      </p>

      <div className={c.profileSetup}>
        <div className={c.ownerPreview} aria-label="Admin profile preview">
          <span className={c.ownerAvatar}>
            <Image
              src={`/avatars/${selectedAvatar.slug}.png`}
              alt=""
              width={108}
              height={108}
              unoptimized
            />
          </span>
          <span className={c.ownerName}>{cleanName || 'Admin'}</span>
          <span className={c.ownerMeta}>admin · first learner</span>
        </div>

        <div className={c.profileFields}>
          <label className={c.fieldLabel} htmlFor="admin-profile-name">
            Admin display name
          </label>
          <input
            id="admin-profile-name"
            className={c.profileNameInput}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            placeholder="e.g. Andres"
            autoFocus
          />

          <span className={c.fieldLabel}>Profile face</span>
          <div className={c.onboardingAvatarGrid} role="radiogroup" aria-label="Choose an avatar">
            {ANIMAL_AVATARS.map((avatar) => {
              const selected = avatar.slug === avatarSlug;
              return (
                <button
                  key={avatar.slug}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={avatar.name}
                  className={`${c.avatarChoice} ${selected ? c.avatarChoiceSel : ''}`}
                  onClick={() => setAvatarSlug(avatar.slug)}
                >
                  <span className={c.avatarChoiceImage}>
                    <Image
                      src={`/avatars/${avatar.slug}.png`}
                      alt=""
                      width={90}
                      height={90}
                      unoptimized
                    />
                  </span>
                </button>
              );
            })}
          </div>
          <span className={c.fieldLabel} id="timezone-globe-label">
            Where in the world?
          </span>
          <p className={c.fieldHint}>
            Spin the globe to your city. Daily streaks and the activity calendar count days in this
            timezone.
          </p>
          <div aria-labelledby="timezone-globe-label">
            <TimezoneGlobe value={timezone} onChange={setTimezone} />
          </div>
        </div>
      </div>

      {error && (
        <div className={c.locknote} role="alert">
          <Glyph name="lock" size={15} />
          {error}
        </div>
      )}

      <div className={t.actions}>
        <button
          className={`${t.btn} ${t.btnGhost}`}
          onClick={onBack}
          type="button"
          disabled={saving}
        >
          Back
        </button>
        <span className={t.spacer} />
        <button
          className={`${t.btn} ${t.btnPrimary}`}
          onClick={saveAndContinue}
          type="button"
          disabled={!cleanName || saving}
          aria-label="Continue with admin profile"
        >
          {saving ? 'Saving...' : 'Continue'}{' '}
          <span className={t.btnArrow}>
            <Glyph name="arrow" size={17} />
          </span>
        </button>
      </div>
    </div>
  );
}
