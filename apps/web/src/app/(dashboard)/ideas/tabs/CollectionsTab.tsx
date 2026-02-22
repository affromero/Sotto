'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { CollectionCard } from '@/components/collections/CollectionCard';
import { Button } from '@/components/ui/Button';
import styles from './CollectionsTab.module.css';

interface CollectionSummary {
  id: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  podcastCount: number;
  followerCount: number;
  createdAt: string;
}

interface CollectionsTabProps {
  collections: CollectionSummary[];
}

export function CollectionsTab({ collections: initialCollections }: CollectionsTabProps) {
  const [collections, setCollections] = useState(initialCollections);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [creating, setCreating] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setCreating(true);
    try {
      const res = await fetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null, isPublic }),
      });
      if (res.ok) {
        const created = await res.json();
        setCollections((prev) => [created, ...prev]);
        setName('');
        setDescription('');
        setIsPublic(true);
        setShowForm(false);
      }
    } finally {
      setCreating(false);
    }
  };

  if (collections.length === 0 && !showForm) {
    return (
      <div className={styles.emptyState}>
        <p className={styles.emptyText}>
          No collections yet. Create one to organize podcasts.
        </p>
        <button type="button" className={styles.emptyLink} onClick={() => setShowForm(true)}>
          Create Collection
        </button>
      </div>
    );
  }

  return (
    <div className={styles.grid}>
      <button
        type="button"
        className={styles.createCard}
        onClick={() => setShowForm(!showForm)}
        aria-label="Create new collection"
      >
        <Plus size={24} aria-hidden="true" />
        <span>New Collection</span>
      </button>

      {showForm && (
        <form className={styles.createForm} onSubmit={handleCreate}>
          <input
            type="text"
            className={styles.input}
            placeholder="Collection name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            autoFocus
          />
          <input
            type="text"
            className={styles.input}
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={300}
          />
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
            />
            <span>Public</span>
          </label>
          <div className={styles.formActions}>
            <Button size="small" type="submit" disabled={creating || !name.trim()}>
              {creating ? 'Creating...' : 'Create'}
            </Button>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={() => setShowForm(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {collections.map((c) => (
        <CollectionCard
          key={c.id}
          id={c.id}
          name={c.name}
          description={c.description}
          podcastCount={c.podcastCount}
          followerCount={c.followerCount}
        />
      ))}
    </div>
  );
}
