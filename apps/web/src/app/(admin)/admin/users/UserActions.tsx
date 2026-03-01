'use client';

import { useState } from 'react';
import styles from './page.module.css';

interface UserActionsProps {
  userId: string;
  currentRole: string;
  currentPlan: string;
  dailyGenerationOverride: number | null;
  isOwnUser: boolean;
  isBanned: boolean;
  isSuspended: boolean;
}

export function UserActions({
  userId,
  currentRole,
  currentPlan,
  dailyGenerationOverride: initialOverride,
  isOwnUser,
  isBanned: initialBanned,
  isSuspended: initialSuspended,
}: UserActionsProps) {
  const [role, setRole] = useState(currentRole);
  const [plan, setPlan] = useState(currentPlan);
  const [override, setOverride] = useState<number | null>(initialOverride);
  const [isLoading, setIsLoading] = useState(false);
  const [isBanned, setIsBanned] = useState(initialBanned);
  const [isSuspended, setIsSuspended] = useState(initialSuspended);

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
      const response = await fetch(`/api/admin/users/${userId}/role`, {
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

  async function handlePlanChange(newPlan: string) {
    const confirmed = confirm(`Change this user's plan to ${newPlan}?`);
    if (!confirmed) return;

    setIsLoading(true);

    try {
      const response = await fetch(`/api/admin/users/${userId}/plan`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: newPlan }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update plan');
      }

      setPlan(newPlan);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to update plan');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleLimitChange(value: string) {
    let newOverride: number | null;
    if (value === 'global') {
      newOverride = null;
    } else if (value === 'unlimited') {
      newOverride = 0;
    } else {
      const custom = prompt('Enter daily generation limit:', String(override ?? 10));
      if (!custom) return;
      const parsed = parseInt(custom, 10);
      if (isNaN(parsed) || parsed < 1) {
        alert('Invalid limit — must be a positive integer');
        return;
      }
      newOverride = parsed;
    }

    setIsLoading(true);

    try {
      const response = await fetch(`/api/admin/users/${userId}/generation-limit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dailyGenerationOverride: newOverride }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update limit');
      }

      setOverride(newOverride);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to update limit');
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
      const response = await fetch(`/api/admin/users/${userId}/moderate`, {
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

  const isAdmin = role === 'ADMIN';
  const limitSelectValue =
    override === null ? 'global' : override === 0 ? 'unlimited' : 'custom';

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
        <>
          <select
            value={plan}
            onChange={(e) => handlePlanChange(e.target.value)}
            disabled={isLoading}
            className={styles.roleSelect}
            aria-label="User plan"
          >
            <option value="FREE">Free</option>
            <option value="PRO">Pro</option>
          </select>
          <select
            value={limitSelectValue}
            onChange={(e) => handleLimitChange(e.target.value)}
            disabled={isLoading}
            className={styles.roleSelect}
            aria-label="Daily generation limit"
          >
            <option value="global">Global default</option>
            <option value="unlimited">Unlimited</option>
            <option value="custom">
              {override !== null && override > 0 ? `Custom: ${override}/day` : 'Custom...'}
            </option>
          </select>
        </>
      )}
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
        </div>
      )}
    </div>
  );
}
