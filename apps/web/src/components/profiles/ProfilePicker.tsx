'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Plus, Check, X, Trash2 } from 'lucide-react';
import { GlassBead } from '@/components/landing/GlassBead';
import { ANIMAL_AVATARS } from '@/lib/avatars';
import { langLabel } from '@/lib/languages';
import type { HouseholdProfile } from '@/lib/profiles';
import styles from './ProfilePicker.module.css';

interface ProfilePickerProps {
  profiles: HouseholdProfile[];
  activeId: string | null;
}

type Editor =
  | { mode: 'create' }
  | { mode: 'edit'; profile: HouseholdProfile }
  | null;

function slugFromAvatarUrl(url: string): string {
  return url.match(/\/avatars\/(.+)\.png$/)?.[1] ?? ANIMAL_AVATARS[0].slug;
}

function metaLine(p: HouseholdProfile): string {
  if (!p.primaryCourse) return 'New learner';
  const extra = p.courseCount > 1 ? ` · +${p.courseCount - 1}` : '';
  return `${langLabel(p.primaryCourse.targetLang)} · ${p.primaryCourse.level}${extra}`;
}

export function ProfilePicker({ profiles, activeId }: ProfilePickerProps) {
  const router = useRouter();
  const [managing, setManaging] = useState(false);
  const [editor, setEditor] = useState<Editor>(null);
  const [name, setName] = useState('');
  const [avatarSlug, setAvatarSlug] = useState(ANIMAL_AVATARS[0].slug);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function switchTo(profileId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/profiles/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ profileId }),
      });
      if (!res.ok) throw new Error('Could not switch profile');
      router.push('/learn');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not switch profile');
      setBusy(false);
    }
  }

  function pick(p: HouseholdProfile) {
    if (busy) return;
    if (managing) {
      openEdit(p);
      return;
    }
    void switchTo(p.id);
  }

  function openCreate() {
    setName('');
    setAvatarSlug(ANIMAL_AVATARS[0].slug);
    setError(null);
    setEditor({ mode: 'create' });
  }

  function openEdit(profile: HouseholdProfile) {
    setName(profile.name);
    setAvatarSlug(slugFromAvatarUrl(profile.avatarUrl));
    setError(null);
    setEditor({ mode: 'edit', profile });
  }

  function closeEditor() {
    setEditor(null);
    setError(null);
  }

  async function saveCreate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: name.trim(), avatarSlug }),
      });
      if (!res.ok) throw new Error('Could not create the profile');
      const created = (await res.json()) as { id: string };
      await switchTo(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the profile');
      setBusy(false);
    }
  }

  async function saveEdit(profile: HouseholdProfile) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/profiles/${profile.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: name.trim(), avatarSlug }),
      });
      if (!res.ok) throw new Error('Could not save the profile');
      closeEditor();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the profile');
    } finally {
      setBusy(false);
    }
  }

  async function deleteProfile(profile: HouseholdProfile) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/profiles/${profile.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Could not delete the profile');
      }
      closeEditor();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the profile');
    } finally {
      setBusy(false);
    }
  }

  if (editor) {
    const isEdit = editor.mode === 'edit';
    const canDelete = isEdit && !editor.profile.isOwner && profiles.length > 1;
    return (
      <div className={styles.root}>
        <div className={styles.brand}>
          <GlassBead />
          sotto
        </div>
        <div className={styles.panel} role="dialog" aria-modal="true" aria-label={isEdit ? 'Edit profile' : 'Add a learner'}>
          <h1 className={styles.panelTitle}>{isEdit ? 'Edit profile' : 'Add a learner'}</h1>

          <label className={styles.fieldLabel} htmlFor="profile-name">Name</label>
          <input
            id="profile-name"
            className={styles.nameInput}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            placeholder="e.g. Sofía"
            autoFocus
          />

          <span className={styles.fieldLabel}>Avatar</span>
          <div className={styles.animalGrid} role="radiogroup" aria-label="Choose an avatar">
            {ANIMAL_AVATARS.map((a) => {
              const selected = a.slug === avatarSlug;
              return (
                <button
                  key={a.slug}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={a.name}
                  className={`${styles.animalTile} ${selected ? styles.animalTileSelected : ''}`}
                  onClick={() => setAvatarSlug(a.slug)}
                >
                  <Image src={`/avatars/${a.slug}.png`} alt="" width={64} height={64} />
                </button>
              );
            })}
          </div>

          {error && <p className={styles.error} role="alert">{error}</p>}

          <div className={styles.panelActions}>
            <button type="button" className={styles.ghostBtn} onClick={closeEditor} disabled={busy}>
              <X size={16} aria-hidden="true" /> Cancel
            </button>
            {canDelete && (
              <button
                type="button"
                className={styles.dangerBtn}
                onClick={() => isEdit && deleteProfile(editor.profile)}
                disabled={busy}
              >
                <Trash2 size={16} aria-hidden="true" /> Delete
              </button>
            )}
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => (isEdit ? saveEdit(editor.profile) : saveCreate())}
              disabled={busy || name.trim().length === 0}
            >
              <Check size={16} aria-hidden="true" /> {isEdit ? 'Save' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.root} ${managing ? styles.managing : ''}`}>
      <div className={styles.brand}>
        <GlassBead />
        sotto
      </div>

      <h1 className={styles.heading}>Who&rsquo;s learning?</h1>
      <p className={styles.sub}>
        self-hosted · {profiles.length} {profiles.length === 1 ? 'profile' : 'profiles'} on this server
      </p>

      <div className={styles.row}>
        {profiles.map((p) => (
          <button
            key={p.id}
            type="button"
            className={styles.profile}
            onClick={() => pick(p)}
            disabled={busy}
            aria-label={managing ? `Edit ${p.name}` : `Switch to ${p.name}`}
          >
            <span className={`${styles.avatar} ${p.isOwner ? styles.owner : ''} ${p.id === activeId ? styles.active : ''}`}>
              <Image src={p.avatarUrl} alt="" fill sizes="140px" />
              {managing && <span className={styles.editVeil}>edit</span>}
            </span>
            <span className={styles.name}>{p.name}</span>
            <span className={styles.meta}>{metaLine(p)}</span>
          </button>
        ))}

        {!managing && (
          <button type="button" className={`${styles.profile} ${styles.add}`} onClick={openCreate} disabled={busy}>
            <span className={`${styles.avatar} ${styles.addAvatar}`}>
              <Plus size={40} aria-hidden="true" />
            </span>
            <span className={styles.name}>Add learner</span>
            <span className={styles.meta}>new profile</span>
          </button>
        )}
      </div>

      {error && <p className={styles.error} role="alert">{error}</p>}

      <div className={styles.foot}>
        <button type="button" className={styles.manageBtn} onClick={() => setManaging((m) => !m)}>
          {managing ? 'Done' : 'Manage profiles'}
        </button>
      </div>
    </div>
  );
}
