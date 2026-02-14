'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import styles from './page.module.css';

interface EditPodcastFormProps {
  podcastId: string;
  initialTitle: string;
  initialTopic: string;
  initialVisibility: string;
}

export function EditPodcastForm({
  podcastId,
  initialTitle,
  initialTopic,
  initialVisibility,
}: EditPodcastFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [topic, setTopic] = useState(initialTopic);
  const [visibility, setVisibility] = useState(initialVisibility);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/podcasts/${podcastId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, topic, visibility }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error?.fieldErrors ? 'Please check the form fields.' : 'Failed to save changes.');
        return;
      }

      router.push(`/podcast/${podcastId}`);
    } catch {
      setError('An unexpected error occurred.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      {error && <div className={styles.error}>{error}</div>}

      <Input
        label="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Podcast title"
        maxLength={200}
        required
      />

      <div className={styles.fieldGroup}>
        <label htmlFor="topic" className={styles.fieldLabel}>Topic</label>
        <textarea
          id="topic"
          className={styles.textarea}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Describe the podcast topic..."
          rows={4}
          maxLength={5000}
          required
        />
      </div>

      <div className={styles.fieldGroup}>
        <label htmlFor="visibility" className={styles.fieldLabel}>Visibility</label>
        <select
          id="visibility"
          className={styles.select}
          value={visibility}
          onChange={(e) => setVisibility(e.target.value)}
        >
          <option value="PUBLIC">Public</option>
          <option value="UNLISTED">Unlisted</option>
          <option value="PRIVATE">Private</option>
        </select>
      </div>

      <div className={styles.formActions}>
        <Button type="submit" loading={saving} disabled={saving}>
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
        <Button
          variant="ghost"
          type="button"
          onClick={() => router.push(`/podcast/${podcastId}`)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
