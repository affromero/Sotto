'use client';

import { useState } from 'react';
import styles from './page.module.css';

interface ReservedHandle {
  id: string;
  handle: string;
  reason: string | null;
  createdAt: string;
}

interface HandleManagerProps {
  initialHandles: ReservedHandle[];
}

export function HandleManager({ initialHandles }: HandleManagerProps) {
  const [handles, setHandles] = useState(initialHandles);
  const [newHandle, setNewHandle] = useState('');
  const [reason, setReason] = useState('');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newHandle.trim()) return;

    setAdding(true);
    setError(null);

    try {
      const res = await fetch('/api/v1/admin/handles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: newHandle.toLowerCase().trim(),
          reason: reason || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to add handle');
      }

      const created = await res.json();
      setHandles((prev) => [...prev, created].sort((a, b) => a.handle.localeCompare(b.handle)));
      setNewHandle('');
      setReason('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add handle');
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(handle: string) {
    setRemoving(handle);
    setError(null);

    try {
      const res = await fetch('/api/v1/admin/handles', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to remove handle');
      }

      setHandles((prev) => prev.filter((h) => h.handle !== handle));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove handle');
    } finally {
      setRemoving(null);
    }
  }

  return (
    <>
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      <form className={styles.addForm} onSubmit={handleAdd}>
        <input
          type="text"
          className={styles.input}
          value={newHandle}
          onChange={(e) => setNewHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
          placeholder="handle_to_reserve"
          maxLength={30}
          aria-label="Handle to reserve"
        />
        <input
          type="text"
          className={styles.input}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional)"
          maxLength={200}
          aria-label="Reason for reservation"
        />
        <button type="submit" className={styles.addButton} disabled={adding || !newHandle.trim()}>
          {adding ? 'Adding...' : 'Reserve Handle'}
        </button>
      </form>

      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Handle</th>
              <th>Reason</th>
              <th>Created</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {handles.length === 0 && (
              <tr>
                <td colSpan={4} className={styles.empty}>
                  No reserved handles
                </td>
              </tr>
            )}
            {handles.map((h) => (
              <tr key={h.id}>
                <td className={styles.handleCell}>@{h.handle}</td>
                <td className={styles.reasonCell}>{h.reason || '—'}</td>
                <td className={styles.dateCell}>
                  {new Date(h.createdAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </td>
                <td>
                  <button
                    type="button"
                    className={styles.removeButton}
                    onClick={() => handleRemove(h.handle)}
                    disabled={removing === h.handle}
                  >
                    {removing === h.handle ? 'Removing...' : 'Remove'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
