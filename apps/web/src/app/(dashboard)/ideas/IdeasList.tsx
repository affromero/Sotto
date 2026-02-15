'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Trash2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import styles from './page.module.css';

interface SavedIdea {
  id: string;
  questionId: string;
  question: string;
  tagSlugs: string[];
  category: string | null;
  createdAt: string;
}

interface IdeasListProps {
  ideas: SavedIdea[];
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function IdeasList({ ideas: initialIdeas }: IdeasListProps) {
  const router = useRouter();
  const [ideas, setIdeas] = useState(initialIdeas);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const handleDelete = async (ideaId: string) => {
    if (confirmId !== ideaId) {
      setConfirmId(ideaId);
      return;
    }

    setDeletingId(ideaId);
    try {
      const res = await fetch(`/api/ideas/${ideaId}`, { method: 'DELETE' });
      if (res.ok) {
        setIdeas((prev) => prev.filter((i) => i.id !== ideaId));
      }
    } finally {
      setDeletingId(null);
      setConfirmId(null);
    }
  };

  const handleCancelConfirm = () => {
    setConfirmId(null);
  };

  if (ideas.length === 0) {
    return (
      <main className={styles.main}>
        <header className={styles.header}>
          <h1 className={styles.title}>Saved Ideas</h1>
        </header>
        <div className={styles.emptyState}>
          <p className={styles.emptyText}>
            No saved ideas yet. Tap the bookmark icon on quiz questions or browse Inspire Me to save
            podcast ideas for later.
          </p>
          <Link href="/create" className={styles.emptyLink}>
            <Sparkles size={16} aria-hidden="true" />
            Create a podcast
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1 className={styles.title}>Saved Ideas</h1>
        <p className={styles.subtitle}>
          {ideas.length} idea{ideas.length !== 1 ? 's' : ''} saved
        </p>
      </header>

      <div className={styles.grid} role="list" aria-label="Saved ideas">
        {ideas.map((idea) => (
          <div key={idea.id} className={styles.card} role="listitem">
            <div className={styles.cardContent}>
              {idea.category && <span className={styles.categoryBadge}>{idea.category}</span>}
              <p className={styles.question}>{idea.question}</p>
              <span className={styles.date}>{formatDate(idea.createdAt)}</span>
            </div>
            <div className={styles.cardActions}>
              <Button
                size="small"
                onClick={() => router.push(`/create?topic=${encodeURIComponent(idea.question)}`)}
              >
                Create
              </Button>
              {confirmId === idea.id ? (
                <div className={styles.confirmActions}>
                  <button
                    type="button"
                    className={styles.confirmBtn}
                    onClick={() => handleDelete(idea.id)}
                    disabled={deletingId === idea.id}
                    aria-label="Confirm delete"
                  >
                    {deletingId === idea.id ? 'Deleting...' : 'Confirm'}
                  </button>
                  <button
                    type="button"
                    className={styles.cancelBtn}
                    onClick={handleCancelConfirm}
                    aria-label="Cancel delete"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className={styles.deleteBtn}
                  onClick={() => handleDelete(idea.id)}
                  aria-label={`Delete idea: ${idea.question}`}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
