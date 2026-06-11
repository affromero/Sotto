'use client';

import { useState } from 'react';
import styles from './page.module.css';

interface UserActionsProps {
  userId: string;
  currentRole: string;
  isOwnUser: boolean;
  isBanned: boolean;
  isSuspended: boolean;
}

export function UserActions({
  userId,
  currentRole,
  isOwnUser,
  isBanned: initialBanned,
  isSuspended: initialSuspended,
}: UserActionsProps) {
  const [role, setRole] = useState(currentRole);
  const [isLoading, setIsLoading] = useState(false);
  const [isBanned, setIsBanned] = useState(initialBanned);
  const [isSuspended, setIsSuspended] = useState(initialSuspended);
  const [isRemoved, setIsRemoved] = useState(false);

  async function handleRoleChange(newRole: string) {
    if (isOwnUser) {
      alert('You cannot change your own role');
      return;
    }

    const confirmed = confirm(`Are you sure you want to change this user's role to ${newRole}?`);

    if (!confirmed) {
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch(`/api/v1/admin/users/${userId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update role');
      }

      setRole(newRole);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to update role');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleModerate(action: string) {
    const reason = prompt(`Reason for ${action}:`);
    if (!reason) return;

    let durationDays: number | undefined;
    if (action === 'suspend') {
      const days = prompt('Suspension duration (days):', '7');
      if (!days) return;
      durationDays = parseInt(days, 10);
      if (isNaN(durationDays) || durationDays < 1) {
        alert('Invalid duration');
        return;
      }
    }

    setIsLoading(true);

    try {
      const response = await fetch(`/api/v1/admin/users/${userId}/moderate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason, durationDays }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Failed to ${action}`);
      }

      if (action === 'ban') setIsBanned(true);
      if (action === 'unban') setIsBanned(false);
      if (action === 'suspend') setIsSuspended(true);
      if (action === 'unsuspend') setIsSuspended(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : `Failed to ${action}`);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRemove() {
    if (!confirm('Remove this user and all their data? This cannot be undone.')) return;
    setIsLoading(true);
    try {
      const response = await fetch(`/api/v1/admin/users/${userId}/remove`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to remove user');
      }
      setIsRemoved(true);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to remove user');
    } finally {
      setIsLoading(false);
    }
  }

  if (isRemoved) {
    return <div className={styles.actionsCell}><span className={styles.removedLabel}>Removed</span></div>;
  }

  const isAdmin = role === 'ADMIN';

  return (
    <div className={styles.actionsCell}>
      <select
        value={role}
        onChange={(e) => handleRoleChange(e.target.value)}
        disabled={isOwnUser || isLoading}
        className={styles.roleSelect}
        aria-label="User role"
      >
        <option value="USER">User</option>
        <option value="ADMIN">Admin</option>
      </select>
      {!isOwnUser && !isAdmin && (
        <div className={styles.moderationButtons}>
          <button
            className={styles.modBtn}
            onClick={() => handleModerate('warn')}
            disabled={isLoading}
          >
            Warn
          </button>
          {isSuspended ? (
            <button
              className={styles.modBtn}
              onClick={() => handleModerate('unsuspend')}
              disabled={isLoading}
            >
              Unsuspend
            </button>
          ) : (
            <button
              className={`${styles.modBtn} ${styles.modBtnWarn}`}
              onClick={() => handleModerate('suspend')}
              disabled={isLoading}
            >
              Suspend
            </button>
          )}
          {isBanned ? (
            <button
              className={styles.modBtn}
              onClick={() => handleModerate('unban')}
              disabled={isLoading}
            >
              Unban
            </button>
          ) : (
            <button
              className={`${styles.modBtn} ${styles.modBtnDanger}`}
              onClick={() => handleModerate('ban')}
              disabled={isLoading}
            >
              Ban
            </button>
          )}
          <button
            type="button"
            className={`${styles.modBtn} ${styles.modBtnDanger}`}
            onClick={handleRemove}
            disabled={isLoading}
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}
