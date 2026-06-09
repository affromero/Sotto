'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { generateQrDataUrl } from '@/lib/qr';
import styles from './page.module.css';

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

  const loadSiteConfig = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/site-config');
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
      const response = await fetch('/api/admin/site-config', {
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
      const response = await fetch('/api/admin/invitations');
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
      const response = await fetch('/api/household/members');
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
      const response = await fetch('/api/admin/invitations', { method: 'POST' });
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
      const response = await fetch('/api/admin/invitations', {
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
                ? 'Open — anyone who can reach this instance can create an account.'
                : 'Invite-only — only people you invite can create an account. Recommended for a private household.'}
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

      {/* Household members */}
      <section className={styles.listCard} aria-labelledby="members-heading">
        <div className={styles.listHeader}>
          <h2 id="members-heading" className={styles.listTitle}>
            Members{!membersLoading && members.length > 0 ? ` (${members.length})` : ''}
          </h2>
        </div>
        {membersLoading ? (
          <p className={styles.listEmpty}>Loading members…</p>
        ) : members.length === 0 ? (
          <p className={styles.listEmpty}>No one has joined your household yet.</p>
        ) : (
          <ul className={styles.rows}>
            {members.map((member) => (
              <li key={member.id} className={styles.memberRow}>
                <MemberAvatar member={member} />
                <div className={styles.memberInfo}>
                  <span className={styles.memberName}>
                    {member.name ?? member.email.split('@')[0]}
                  </span>
                  <span className={styles.memberEmail}>{member.email}</span>
                </div>
                <div className={styles.memberAside}>
                  {member.isOwner && <Badge variant="admin">Owner</Badge>}
                  <span className={styles.courseCount}>
                    {member.courseCount} {member.courseCount === 1 ? 'course' : 'courses'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function MemberAvatar({ member }: { member: MemberData }) {
  if (member.image) {
    return (
      <Image
        src={member.image}
        alt=""
        width={40}
        height={40}
        className={styles.avatarImage}
        unoptimized
      />
    );
  }
  return (
    <span
      className={`${styles.avatarInitials} ${member.isOwner ? styles.avatarOwner : ''}`}
      aria-hidden="true"
    >
      {initialsFor(member.name, member.email)}
    </span>
  );
}

function initialsFor(name: string | null, email: string): string {
  const source = name?.trim() || email;
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
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
