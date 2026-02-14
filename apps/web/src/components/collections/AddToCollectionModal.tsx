'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Plus, Check, ListMusic } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import styles from './AddToCollectionModal.module.css';

interface Collection {
  id: string;
  name: string;
  podcastCount: number;
}

interface AddToCollectionModalProps {
  podcastId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function AddToCollectionModal({ podcastId, isOpen, onClose }: AddToCollectionModalProps) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [addedTo, setAddedTo] = useState<Set<string>>(new Set());
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const fetchCollections = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/collections');
      if (!res.ok) throw new Error('Failed to load collections');
      const data = await res.json();
      setCollections(data.collections || []);
    } catch {
      setError('Failed to load collections');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      loadedRef.current = false;
      return;
    }
    if (loadedRef.current) return;
    loadedRef.current = true;
    fetchCollections();
  }, [isOpen, fetchCollections]);

  const handleToggle = useCallback(
    async (collectionId: string) => {
      const isAdded = addedTo.has(collectionId);

      // Optimistic update
      setAddedTo((prev) => {
        const next = new Set(prev);
        if (isAdded) {
          next.delete(collectionId);
        } else {
          next.add(collectionId);
        }
        return next;
      });

      try {
        const res = await fetch(`/api/collections/${collectionId}/items`, {
          method: isAdded ? 'DELETE' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ podcastId }),
        });

        if (!res.ok) throw new Error('Failed to update collection');

        // Update the local podcast count
        setCollections((prev) =>
          prev.map((c) =>
            c.id === collectionId
              ? { ...c, podcastCount: c.podcastCount + (isAdded ? -1 : 1) }
              : c
          )
        );
      } catch {
        // Revert on error
        setAddedTo((prev) => {
          const next = new Set(prev);
          if (isAdded) {
            next.add(collectionId);
          } else {
            next.delete(collectionId);
          }
          return next;
        });
        setError('Failed to update collection');
      }
    },
    [addedTo, podcastId]
  );

  const handleCreateNew = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!newName.trim()) return;

      setCreating(true);
      setError(null);

      try {
        const res = await fetch('/api/collections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName.trim() }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to create collection');
        }

        const created = await res.json();

        // Add podcast to the newly created collection
        await fetch(`/api/collections/${created.id}/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ podcastId }),
        });

        setCollections((prev) => [{ id: created.id, name: created.name, podcastCount: 1 }, ...prev]);
        setAddedTo((prev) => {
          const next = new Set(prev);
          next.add(created.id);
          return next;
        });
        setNewName('');
        setShowNewForm(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create collection');
      } finally {
        setCreating(false);
      }
    },
    [newName, podcastId]
  );

  const handleClose = useCallback(() => {
    setShowNewForm(false);
    setNewName('');
    setError(null);
    setAddedTo(new Set());
    onClose();
  }, [onClose]);

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Add to Collection">
      <div className={styles.content}>
        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        {loading ? (
          <div className={styles.loading} role="status" aria-label="Loading collections">
            <div className={styles.spinner} />
            <span>Loading collections...</span>
          </div>
        ) : (
          <ul className={styles.list} role="list">
            {collections.map((collection) => {
              const isAdded = addedTo.has(collection.id);
              return (
                <li key={collection.id} className={styles.item}>
                  <button
                    type="button"
                    className={`${styles.itemBtn} ${isAdded ? styles.itemBtnActive : ''}`}
                    onClick={() => handleToggle(collection.id)}
                    aria-pressed={isAdded}
                    aria-label={
                      isAdded
                        ? `Remove from ${collection.name}`
                        : `Add to ${collection.name}`
                    }
                  >
                    <div className={styles.itemInfo}>
                      <ListMusic size={16} className={styles.itemIcon} aria-hidden="true" />
                      <span className={styles.itemName}>{collection.name}</span>
                      <span className={styles.itemCount}>
                        {collection.podcastCount} {collection.podcastCount === 1 ? 'podcast' : 'podcasts'}
                      </span>
                    </div>
                    <div className={`${styles.checkbox} ${isAdded ? styles.checkboxActive : ''}`}>
                      {isAdded && <Check size={14} />}
                    </div>
                  </button>
                </li>
              );
            })}

            {collections.length === 0 && (
              <li className={styles.emptyHint}>
                No collections yet. Create one below.
              </li>
            )}
          </ul>
        )}

        {showNewForm ? (
          <form className={styles.newForm} onSubmit={handleCreateNew}>
            <Input
              label="Collection name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="My favorites..."
              maxLength={100}
              autoFocus
            />
            <div className={styles.newFormActions}>
              <Button
                type="button"
                variant="ghost"
                size="small"
                onClick={() => {
                  setShowNewForm(false);
                  setNewName('');
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="small"
                loading={creating}
                disabled={!newName.trim()}
              >
                Create & Add
              </Button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className={styles.createBtn}
            onClick={() => setShowNewForm(true)}
          >
            <Plus size={16} />
            <span>Create new collection</span>
          </button>
        )}
      </div>
    </Modal>
  );
}
