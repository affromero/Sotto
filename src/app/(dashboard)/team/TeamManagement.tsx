'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import styles from './page.module.css';

interface TeamMember {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
}

interface TeamInvite {
  id: string;
  email: string;
  status: string;
  expiresAt: string;
}

interface TeamData {
  id: string;
  name: string;
  ownerId: string;
  seats: number;
  owner: TeamMember;
  members: TeamMember[];
  invites: TeamInvite[];
  _count: { members: number };
}

interface TeamManagementProps {
  team: TeamData;
  userId: string;
}

export function TeamManagement({ team, userId }: TeamManagementProps) {
  const router = useRouter();
  const isOwner = team.ownerId === userId;
  const [teamName, setTeamName] = useState(team.name);
  const [inviteEmail, setInviteEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpdateName = useCallback(async () => {
    if (!teamName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/teams/${team.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: teamName }),
      });
      if (!response.ok) {
        const data = await response.json();
        setError(data.error || 'Failed to update');
      }
    } finally {
      setSaving(false);
    }
  }, [team.id, teamName]);

  const handleInvite = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setError(null);
    try {
      const response = await fetch(`/api/teams/${team.id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail }),
      });
      if (response.ok) {
        setInviteEmail('');
        router.refresh();
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to send invite');
      }
    } finally {
      setInviting(false);
    }
  }, [team.id, inviteEmail, router]);

  const handleRemoveMember = useCallback(async (memberId: string) => {
    setError(null);
    try {
      const response = await fetch(`/api/teams/${team.id}/members`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: memberId }),
      });
      if (response.ok) {
        router.refresh();
      }
    } catch {
      setError('Failed to remove member');
    }
  }, [team.id, router]);

  const handleRevokeInvite = useCallback(async (inviteId: string) => {
    try {
      await fetch(`/api/teams/${team.id}/invite`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteId }),
      });
      router.refresh();
    } catch {
      setError('Failed to revoke invite');
    }
  }, [team.id, router]);

  const handleLeaveTeam = useCallback(async () => {
    try {
      const response = await fetch(`/api/teams/${team.id}/members`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      if (response.ok) {
        router.refresh();
      }
    } catch {
      setError('Failed to leave team');
    }
  }, [team.id, userId, router]);

  return (
    <div className={styles.main}>
      <h1 className={styles.pageTitle}>Team</h1>

      {error && <div className={styles.error}>{error}</div>}

      {/* Team Name */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Team Settings</h2>
        {isOwner ? (
          <div className={styles.nameRow}>
            <Input
              label="Team Name"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              maxLength={100}
            />
            <Button onClick={handleUpdateName} loading={saving} disabled={saving}>
              Save
            </Button>
          </div>
        ) : (
          <p>{team.name}</p>
        )}
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
          {team._count.members} / {team.seats} seats used
        </p>
      </section>

      {/* Members */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Members</h2>
        <div className={styles.memberList}>
          {team.members.map((member) => (
            <div key={member.id} className={styles.memberRow}>
              <div className={styles.memberInfo}>
                <div className={styles.memberAvatar}>
                  {member.image ? (
                    <img src={member.image} alt="" className={styles.memberAvatarImg} />
                  ) : (
                    (member.name || member.email)[0].toUpperCase()
                  )}
                </div>
                <div className={styles.memberDetails}>
                  <span className={styles.memberName}>{member.name || 'No name'}</span>
                  <span className={styles.memberEmail}>{member.email}</span>
                </div>
              </div>
              <div>
                {member.id === team.ownerId ? (
                  <span className={styles.ownerBadge}>Owner</span>
                ) : isOwner ? (
                  <button
                    className={styles.removeBtn}
                    onClick={() => handleRemoveMember(member.id)}
                    type="button"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Invites */}
      {isOwner && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Invite Members</h2>
          <form onSubmit={handleInvite} className={styles.inviteForm}>
            <Input
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="Email address"
              type="email"
            />
            <Button type="submit" loading={inviting} disabled={inviting}>
              Invite
            </Button>
          </form>

          {team.invites.length > 0 && (
            <div className={styles.inviteList}>
              {team.invites.map((invite) => (
                <div key={invite.id} className={styles.inviteRow}>
                  <span className={styles.inviteEmail}>{invite.email}</span>
                  <span className={styles.inviteStatus}>Pending</span>
                  <button
                    className={styles.revokeBtn}
                    onClick={() => handleRevokeInvite(invite.id)}
                    type="button"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Leave Team */}
      {!isOwner && (
        <section className={styles.section}>
          <Button variant="danger" onClick={handleLeaveTeam}>
            Leave Team
          </Button>
        </section>
      )}
    </div>
  );
}
