'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { AvatarTile } from '@/components/auth/AvatarTile';
import { ANIMAL_AVATARS, avatarImagePath, getAnimalAvatar } from '@/lib/avatars';
import { generateQrDataUrl } from '@/lib/qr';
import styles from './page.module.css';

const MIN_PASSWORD_LENGTH = 8;
const DEFAULT_AVATAR_SLUG = ANIMAL_AVATARS[0].slug;

/** A readable temporary password the owner can hand to a new member. */
function generateTempPassword(): string {
  // Avoid ambiguous characters (no 0/O/1/l) so it is easy to read aloud or type.
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const length = 12;
  const out: string[] = [];
  const random = new Uint32Array(length);
  crypto.getRandomValues(random);
  for (let i = 0; i < length; i += 1) {
    out.push(alphabet[random[i] % alphabet.length]);
  }
  return out.join('');
}

/** The /avatars/{slug}.png image path for a stored member image, if it is one. */
function memberAvatarSlug(image: string | null): string | null {
  if (!image || !image.startsWith('/avatars/')) return null;
  return image.slice('/avatars/'.length).replace(/\.png$/, '');
}

type InvitationStatus = 'active' | 'used' | 'disabled' | 'expired';

interface InvitationData {
  id: string;
  code: string;
  email: string | null;
  enabled: boolean;
  usedAt: string | null;
  expiresAt: string;
  createdAt: string;
  status: InvitationStatus;
}

interface NewInvite {
  url: string;
  qrDataUrl: string;
  expiresAt: string;
}

interface MemberData {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  role: 'USER' | 'ADMIN' | 'SYSTEM';
  createdAt: string;
  courseCount: number;
  isOwner: boolean;
}

const STATUS_VARIANT: Record<InvitationStatus, 'success' | 'info' | 'default' | 'warning'> = {
  active: 'success',
  used: 'info',
  disabled: 'default',
  expired: 'warning',
};

const STATUS_LABEL: Record<InvitationStatus, string> = {
  active: 'Active',
  used: 'Joined',
  disabled: 'Revoked',
  expired: 'Expired',
};

export function HouseholdManager() {
  const [invitations, setInvitations] = useState<InvitationData[]>([]);
  const [members, setMembers] = useState<MemberData[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(true);
  const [membersLoading, setMembersLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [newInvite, setNewInvite] = useState<NewInvite | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const [openSignup, setOpenSignup] = useState<boolean | null>(null);
  const [savingSignup, setSavingSignup] = useState(false);

  // Add-member form.
  const [addName, setAddName] = useState('');
  const [addAvatar, setAddAvatar] = useState<string>(DEFAULT_AVATAR_SLUG);
  const [addPassword, setAddPassword] = useState(() => generateTempPassword());
  const [addingMember, setAddingMember] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [createdMember, setCreatedMember] = useState<{ name: string; password: string } | null>(
    null
  );
  const [credentialsCopied, setCredentialsCopied] = useState(false);

  // Per-member action tracking (one in flight at a time, keyed by id).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editAvatar, setEditAvatar] = useState<string>(DEFAULT_AVATAR_SLUG);
  const [savingMemberId, setSavingMemberId] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<{ id: string; password: string } | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);

  const addNameId = useId();

  const loadSiteConfig = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/admin/site-config');
      if (!response.ok) return;
      const data: { openSignup: boolean } = await response.json();
      setOpenSignup(data.openSignup);
    } catch {
      // Non-fatal: the toggle simply stays hidden until it loads.
    }
  }, []);

  const handleToggleSignup = useCallback(async () => {
    if (openSignup === null) return;
    setSavingSignup(true);
    setError(null);
    const next = !openSignup;
    try {
      const response = await fetch('/api/v1/admin/site-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openSignup: next }),
      });
      if (!response.ok) {
        setError('Could not update who can join.');
        return;
      }
      const data: { openSignup: boolean } = await response.json();
      setOpenSignup(data.openSignup);
    } catch {
      setError('Could not update who can join.');
    } finally {
      setSavingSignup(false);
    }
  }, [openSignup]);

  const loadInvitations = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/admin/invitations');
      if (!response.ok) {
        setError('Could not load invitations.');
        return;
      }
      const data: { invitations: InvitationData[] } = await response.json();
      setInvitations(data.invitations ?? []);
    } catch {
      setError('Could not load invitations.');
    } finally {
      setInvitesLoading(false);
    }
  }, []);

  const loadMembers = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/household/members');
      if (!response.ok) {
        setError('Could not load household members.');
        return;
      }
      const data: { members: MemberData[] } = await response.json();
      setMembers(data.members ?? []);
    } catch {
      setError('Could not load household members.');
    } finally {
      setMembersLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInvitations();
    void loadMembers();
    void loadSiteConfig();
  }, [loadInvitations, loadMembers, loadSiteConfig]);

  const handleInvite = useCallback(async () => {
    setCreating(true);
    setError(null);
    setCopied(false);
    try {
      const response = await fetch('/api/v1/admin/invitations', { method: 'POST' });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setError(data?.error ? String(data.error) : 'Could not create an invite.');
        return;
      }
      const data: { url: string; invitation: { expiresAt: string } } = await response.json();
      const qrDataUrl = await generateQrDataUrl(data.url);
      setNewInvite({ url: data.url, qrDataUrl, expiresAt: data.invitation.expiresAt });
      await loadInvitations();
    } catch {
      setError('Could not create an invite.');
    } finally {
      setCreating(false);
    }
  }, [loadInvitations]);

  const handleCopy = useCallback(async () => {
    if (!newInvite) return;
    await navigator.clipboard.writeText(newInvite.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [newInvite]);

  const handleRevoke = useCallback(async (id: string) => {
    setRevokingId(id);
    try {
      const response = await fetch('/api/v1/admin/invitations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, enabled: false }),
      });
      if (response.ok) {
        setInvitations((prev) =>
          prev.map((inv) =>
            inv.id === id ? { ...inv, enabled: false, status: 'disabled' as const } : inv
          )
        );
      }
    } finally {
      setRevokingId(null);
    }
  }, []);

  const resetAddForm = useCallback(() => {
    setAddName('');
    setAddAvatar(DEFAULT_AVATAR_SLUG);
    setAddPassword(generateTempPassword());
    setAddError(null);
  }, []);

  const handleAddMember = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const trimmedName = addName.trim();
      if (!trimmedName || addPassword.length < MIN_PASSWORD_LENGTH || addingMember) return;

      setAddingMember(true);
      setAddError(null);
      setCreatedMember(null);
      setCredentialsCopied(false);
      try {
        const response = await fetch('/api/v1/household/members', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: trimmedName,
            password: addPassword,
            avatar: addAvatar,
          }),
        });
        if (!response.ok) {
          setAddError('Could not add this member. Please try again.');
          return;
        }
        setCreatedMember({ name: trimmedName, password: addPassword });
        await loadMembers();
        resetAddForm();
      } catch {
        setAddError('Could not add this member. Please try again.');
      } finally {
        setAddingMember(false);
      }
    },
    [addName, addPassword, addAvatar, addingMember, loadMembers, resetAddForm]
  );

  const handleCopyCredentials = useCallback(async () => {
    if (!createdMember) return;
    await navigator.clipboard.writeText(
      `${createdMember.name}. Temporary password: ${createdMember.password}`
    );
    setCredentialsCopied(true);
    setTimeout(() => setCredentialsCopied(false), 2000);
  }, [createdMember]);

  const startEdit = useCallback((member: MemberData) => {
    setEditingId(member.id);
    setEditName(member.name ?? '');
    setEditAvatar(memberAvatarSlug(member.image) ?? DEFAULT_AVATAR_SLUG);
    setMemberError(null);
    setResetResult(null);
    setConfirmRemoveId(null);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setMemberError(null);
  }, []);

  const handleSaveEdit = useCallback(
    async (memberId: string) => {
      const trimmedName = editName.trim();
      if (!trimmedName) {
        setMemberError('A name is required.');
        return;
      }
      setSavingMemberId(memberId);
      setMemberError(null);
      try {
        const response = await fetch('/api/v1/household/members', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ memberId, name: trimmedName, avatar: editAvatar }),
        });
        if (!response.ok) {
          setMemberError('Could not save those changes. Please try again.');
          return;
        }
        await loadMembers();
        setEditingId(null);
      } catch {
        setMemberError('Could not save those changes. Please try again.');
      } finally {
        setSavingMemberId(null);
      }
    },
    [editName, editAvatar, loadMembers]
  );

  const handleResetPassword = useCallback(async (memberId: string) => {
    setSavingMemberId(memberId);
    setMemberError(null);
    setResetResult(null);
    const tempPassword = generateTempPassword();
    try {
      const response = await fetch('/api/v1/household/members', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId, resetPassword: tempPassword }),
      });
      if (!response.ok) {
        setMemberError('Could not reset the password. Please try again.');
        return;
      }
      setResetResult({ id: memberId, password: tempPassword });
    } catch {
      setMemberError('Could not reset the password. Please try again.');
    } finally {
      setSavingMemberId(null);
    }
  }, []);

  const handleRemoveMember = useCallback(
    async (memberId: string) => {
      setRemovingId(memberId);
      setMemberError(null);
      try {
        const response = await fetch('/api/v1/household/members', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ memberId }),
        });
        if (!response.ok) {
          setMemberError('Could not remove this member. Please try again.');
          return;
        }
        setMembers((prev) => prev.filter((m) => m.id !== memberId));
        setConfirmRemoveId(null);
        if (resetResult?.id === memberId) setResetResult(null);
      } catch {
        setMemberError('Could not remove this member. Please try again.');
      } finally {
        setRemovingId(null);
      }
    },
    [resetResult]
  );

  return (
    <>
      {/* Who can join */}
      {openSignup !== null && (
        <section className={styles.inviteCard} aria-labelledby="signup-heading">
          <div className={styles.inviteHead}>
            <h2 id="signup-heading" className={styles.sectionTitle}>
              Who can join
            </h2>
            <p className={styles.sectionHint}>
              {openSignup
                ? 'Open. Anyone who can reach this instance can create an account.'
                : 'Invite only. Only people you invite can create an account, recommended for a private household.'}
            </p>
          </div>
          <div className={styles.signupControl}>
            <Badge variant={openSignup ? 'warning' : 'success'}>
              {openSignup ? 'Open sign-up' : 'Invite-only'}
            </Badge>
            <Button
              variant="secondary"
              size="small"
              onClick={handleToggleSignup}
              loading={savingSignup}
              disabled={savingSignup}
            >
              {openSignup ? 'Switch to invite-only' : 'Switch to open sign-up'}
            </Button>
          </div>
        </section>
      )}

      {/* Invite a family member */}
      <section className={styles.inviteCard} aria-labelledby="invite-heading">
        <div className={styles.inviteHead}>
          <h2 id="invite-heading" className={styles.sectionTitle}>
            Invite a family member
          </h2>
          <p className={styles.sectionHint}>
            We&apos;ll create a single-use link that stays valid for 24 hours.
          </p>
        </div>

        {newInvite ? (
          <div className={styles.inviteResult}>
            <div className={styles.inviteLinkBlock}>
              <span className={styles.inviteLinkLabel}>Share this link</span>
              <div className={styles.inviteLinkRow}>
                <span className={styles.inviteUrl}>{newInvite.url}</span>
                <Button size="small" onClick={handleCopy}>
                  {copied ? 'Copied' : 'Copy link'}
                </Button>
              </div>
              <p className={styles.inviteExpiry}>Expires {formatDateTime(newInvite.expiresAt)}.</p>
              <div className={styles.inviteAgain}>
                <Button variant="ghost" size="small" onClick={handleInvite} loading={creating}>
                  Create another link
                </Button>
              </div>
            </div>
            <div className={styles.qrTile}>
              {/* eslint-disable-next-line @next/next/no-img-element -- data-URL QR cannot be optimized by next/image */}
              <img
                src={newInvite.qrDataUrl}
                alt="QR code linking to the family invite"
                className={styles.qrImage}
                width={160}
                height={160}
              />
              <span className={styles.qrCaption}>Scan to join</span>
            </div>
          </div>
        ) : (
          <div className={styles.inviteCta}>
            <p className={styles.inviteCtaText}>
              Send a link to your partner, child, or anyone in your home. Each person learns on a
              private account of their own.
            </p>
            <Button onClick={handleInvite} loading={creating} disabled={creating}>
              Invite a family member
            </Button>
          </div>
        )}
        {error && <p className={styles.errorText}>{error}</p>}
      </section>

      {/* Pending invites */}
      <section className={styles.listCard} aria-labelledby="invites-heading">
        <div className={styles.listHeader}>
          <h2 id="invites-heading" className={styles.listTitle}>
            Invites
          </h2>
        </div>
        {invitesLoading ? (
          <p className={styles.listEmpty}>Loading invites…</p>
        ) : invitations.length === 0 ? (
          <p className={styles.listEmpty}>
            No invites yet. Create one above to add someone to your household.
          </p>
        ) : (
          <ul className={styles.rows}>
            {invitations.map((inv) => (
              <li key={inv.id} className={styles.inviteRow}>
                <div className={styles.inviteRowInfo}>
                  <code className={styles.inviteCode}>{inv.code}</code>
                  <div className={styles.rowMeta}>
                    <span>Created {formatDate(inv.createdAt)}</span>
                    {inv.usedAt ? (
                      <span>Joined {formatDate(inv.usedAt)}</span>
                    ) : (
                      <span>Expires {formatDate(inv.expiresAt)}</span>
                    )}
                  </div>
                </div>
                <div className={styles.inviteRowActions}>
                  <Badge variant={STATUS_VARIANT[inv.status]}>{STATUS_LABEL[inv.status]}</Badge>
                  {inv.status === 'active' && (
                    <Button
                      variant="danger"
                      size="small"
                      onClick={() => handleRevoke(inv.id)}
                      loading={revokingId === inv.id}
                      disabled={revokingId === inv.id}
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Add a member directly */}
      <section className={styles.inviteCard} aria-labelledby="add-member-heading">
        <div className={styles.inviteHead}>
          <h2 id="add-member-heading" className={styles.sectionTitle}>
            Add a member
          </h2>
          <p className={styles.sectionHint}>
            Set up an account in person. They get a temporary password and choose their own the
            first time they sign in to this instance.
          </p>
        </div>

        {createdMember ? (
          <div className={styles.credentialResult} role="status">
            <p className={styles.credentialTitle}>
              {createdMember.name} is ready to sign in.
            </p>
            <div className={styles.credentialRow}>
              <span className={styles.credentialLabel}>Temporary password</span>
              <code className={styles.credentialValue}>{createdMember.password}</code>
            </div>
            <p className={styles.credentialNote}>
              Share this with {createdMember.name}. They will be asked to set their own password the
              first time they sign in.
            </p>
            <div className={styles.credentialActions}>
              <Button size="small" onClick={handleCopyCredentials}>
                {credentialsCopied ? 'Copied' : 'Copy details'}
              </Button>
              <Button variant="ghost" size="small" onClick={() => setCreatedMember(null)}>
                Add another
              </Button>
            </div>
          </div>
        ) : (
          <form className={styles.addForm} onSubmit={handleAddMember} noValidate>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor={addNameId}>
                Name
              </label>
              <input
                id={addNameId}
                className={styles.textInput}
                type="text"
                value={addName}
                onChange={(event) => {
                  setAddName(event.target.value);
                  if (addError) setAddError(null);
                }}
                disabled={addingMember}
                maxLength={100}
                autoComplete="off"
                required
              />
            </div>

            <AvatarPicker
              legend="Avatar"
              value={addAvatar}
              onChange={setAddAvatar}
              disabled={addingMember}
            />

            <div className={styles.field}>
              <span className={styles.fieldLabel}>Temporary password</span>
              <div className={styles.tempRow}>
                <code className={styles.tempValue}>{addPassword}</code>
                <Button
                  type="button"
                  variant="ghost"
                  size="small"
                  onClick={() => setAddPassword(generateTempPassword())}
                  disabled={addingMember}
                >
                  Regenerate
                </Button>
              </div>
              <p className={styles.fieldHint}>
                The member changes this the first time they sign in. At least{' '}
                {MIN_PASSWORD_LENGTH} characters.
              </p>
            </div>

            {addError && <p className={styles.errorText}>{addError}</p>}

            <div>
              <Button
                type="submit"
                loading={addingMember}
                disabled={addingMember || addName.trim().length === 0}
              >
                Add member
              </Button>
            </div>
          </form>
        )}
      </section>

      {/* Household members */}
      <section className={styles.listCard} aria-labelledby="members-heading">
        <div className={styles.listHeader}>
          <h2 id="members-heading" className={styles.listTitle}>
            Members{!membersLoading && members.length > 0 ? ` (${members.length})` : ''}
          </h2>
        </div>
        {memberError && <p className={styles.memberErrorBar}>{memberError}</p>}
        {membersLoading ? (
          <p className={styles.listEmpty}>Loading members…</p>
        ) : members.length === 0 ? (
          <p className={styles.listEmpty}>No one has joined your household yet.</p>
        ) : (
          <ul className={styles.rows}>
            {members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                isEditing={editingId === member.id}
                editName={editName}
                editAvatar={editAvatar}
                onEditNameChange={setEditName}
                onEditAvatarChange={setEditAvatar}
                onStartEdit={() => startEdit(member)}
                onCancelEdit={cancelEdit}
                onSaveEdit={() => handleSaveEdit(member.id)}
                onResetPassword={() => handleResetPassword(member.id)}
                onRemove={() => handleRemoveMember(member.id)}
                confirmRemove={confirmRemoveId === member.id}
                onRequestRemove={() => setConfirmRemoveId(member.id)}
                onCancelRemove={() => setConfirmRemoveId(null)}
                saving={savingMemberId === member.id}
                removing={removingId === member.id}
                resetPassword={resetResult?.id === member.id ? resetResult.password : null}
                onDismissReset={() => setResetResult(null)}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

interface MemberRowProps {
  member: MemberData;
  isEditing: boolean;
  editName: string;
  editAvatar: string;
  onEditNameChange: (value: string) => void;
  onEditAvatarChange: (slug: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onResetPassword: () => void;
  onRemove: () => void;
  confirmRemove: boolean;
  onRequestRemove: () => void;
  onCancelRemove: () => void;
  saving: boolean;
  removing: boolean;
  resetPassword: string | null;
  onDismissReset: () => void;
}

function MemberRow({
  member,
  isEditing,
  editName,
  editAvatar,
  onEditNameChange,
  onEditAvatarChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onResetPassword,
  onRemove,
  confirmRemove,
  onRequestRemove,
  onCancelRemove,
  saving,
  removing,
  resetPassword,
  onDismissReset,
}: MemberRowProps) {
  const displayName = member.name ?? member.email.split('@')[0];
  const editNameId = useId();
  const slug = memberAvatarSlug(member.image);
  const emoji = slug ? (getAnimalAvatar(slug)?.emoji ?? null) : null;
  const busy = saving || removing;

  return (
    <li className={styles.memberRow}>
      <div className={styles.memberMain}>
        <span className={styles.memberTile}>
          <AvatarTile image={member.image} emoji={emoji} name={member.name} size={48} />
        </span>
        <div className={styles.memberInfo}>
          <span className={styles.memberName}>{displayName}</span>
          <span className={styles.memberSub}>
            {member.courseCount} {member.courseCount === 1 ? 'course' : 'courses'}
          </span>
        </div>
        <div className={styles.memberAside}>
          {member.isOwner && <Badge variant="admin">Owner</Badge>}
        </div>
      </div>

      {/* Owners (and yourself) cannot be reset, edited, or removed here. */}
      {!member.isOwner && !isEditing && (
        <div className={styles.memberActions}>
          <Button variant="ghost" size="small" onClick={onStartEdit} disabled={busy}>
            Edit
          </Button>
          <Button
            variant="secondary"
            size="small"
            onClick={onResetPassword}
            loading={saving}
            disabled={busy}
          >
            Reset password
          </Button>
          {confirmRemove ? (
            <span className={styles.confirmGroup}>
              <span className={styles.confirmLabel}>Remove {displayName}?</span>
              <Button
                variant="danger"
                size="small"
                onClick={onRemove}
                loading={removing}
                disabled={busy}
              >
                Remove
              </Button>
              <Button variant="ghost" size="small" onClick={onCancelRemove} disabled={busy}>
                Cancel
              </Button>
            </span>
          ) : (
            <Button variant="danger" size="small" onClick={onRequestRemove} disabled={busy}>
              Remove
            </Button>
          )}
        </div>
      )}

      {isEditing && (
        <div className={styles.editPanel}>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor={editNameId}>
              Name
            </label>
            <input
              id={editNameId}
              className={styles.textInput}
              type="text"
              value={editName}
              onChange={(event) => onEditNameChange(event.target.value)}
              disabled={saving}
              maxLength={100}
              autoComplete="off"
            />
          </div>
          <AvatarPicker
            legend="Avatar"
            value={editAvatar}
            onChange={onEditAvatarChange}
            disabled={saving}
          />
          <div className={styles.editActions}>
            <Button
              size="small"
              onClick={onSaveEdit}
              loading={saving}
              disabled={saving || editName.trim().length === 0}
            >
              Save changes
            </Button>
            <Button variant="ghost" size="small" onClick={onCancelEdit} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {resetPassword && (
        <div className={styles.resetResult} role="status">
          <div className={styles.credentialRow}>
            <span className={styles.credentialLabel}>New temporary password</span>
            <code className={styles.credentialValue}>{resetPassword}</code>
          </div>
          <p className={styles.credentialNote}>
            Share this with {displayName}. They will set their own password the next time they sign
            in.
          </p>
          <Button variant="ghost" size="small" onClick={onDismissReset}>
            Done
          </Button>
        </div>
      )}
    </li>
  );
}

interface AvatarPickerProps {
  legend: string;
  value: string;
  onChange: (slug: string) => void;
  disabled?: boolean;
}

function AvatarPicker({ legend, value, onChange, disabled = false }: AvatarPickerProps) {
  const groupId = useId();
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel} id={groupId}>
        {legend}
      </span>
      <ul className={styles.avatarGrid} role="radiogroup" aria-labelledby={groupId}>
        {ANIMAL_AVATARS.map((animal) => {
          const isSelected = animal.slug === value;
          return (
            <li key={animal.slug} className={styles.avatarItem}>
              <button
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-label={animal.name}
                className={`${styles.avatarBtn} ${isSelected ? styles.avatarBtnSelected : ''}`}
                onClick={() => onChange(animal.slug)}
                disabled={disabled}
              >
                <AvatarTile
                  image={avatarImagePath(animal.slug)}
                  emoji={animal.emoji}
                  name={animal.name}
                  size={48}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
