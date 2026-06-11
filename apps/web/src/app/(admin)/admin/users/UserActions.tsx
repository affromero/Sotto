'use client';

import { useState } from 'react';
import styles from './page.module.css';

interface UserActionsProps {
  userId: string;
  currentRole: string;
  isOwnUser: boolean;
}

export function UserActions({
  userId,
  currentRole,
  isOwnUser,
}: UserActionsProps) {
  const [role, setRole] = useState(currentRole);
  const [isLoading, setIsLoading] = useState(false);

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
    </div>
  );
}
