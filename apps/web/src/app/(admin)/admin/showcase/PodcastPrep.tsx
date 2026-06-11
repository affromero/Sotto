'use client';

import { useState, useCallback } from 'react';
import styles from './PodcastPrep.module.css';

interface DemoProject {
  id: string;
  podcastId: string | null;
}

interface ScriptTurn {
  speaker: string;
  text: string;
  direction?: string;
}

interface PodcastData {
  id: string;
  title: string;
  status: string;
  script: { turns: ScriptTurn[] } | null;
}

export function PodcastPrep({ project }: { project: DemoProject }) {
  const [podcast, setPodcast] = useState<PodcastData | null>(null);
  const [loading, setLoading] = useState(false);
  const [linkId, setLinkId] = useState('');
  const [topic, setTopic] = useState('');

  const loadPodcast = useCallback(async () => {
    const res = await fetch(`/api/admin/demo/${project.id}/podcast`);
    if (res.ok) {
      const data = await res.json();
      setPodcast(data);
    }
  }, [project.id]);

  const linkPodcast = useCallback(async (body: Record<string, string>) => {
    setLoading(true);
    const res = await fetch(`/api/admin/demo/${project.id}/podcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) await loadPodcast();
    setLoading(false);
  }, [project.id, loadPodcast]);

  // Auto-load on mount if podcast is linked
  useState(() => {
    if (project.podcastId) loadPodcast();
  });

  if (!project.podcastId && !podcast) {
    return (
      <div className={styles.root}>
        <h3 className={styles.title}>Link or Create Podcast</h3>
        <div className={styles.linkForm}>
          <div className={styles.option}>
            <label className={styles.label}>
              Link existing podcast ID
              <input
                type="text"
                className={styles.input}
                value={linkId}
                onChange={(e) => setLinkId(e.target.value)}
                placeholder="clxxxxxxxxxx"
              />
            </label>
            <button
              className={styles.btn}
              onClick={() => linkPodcast({ podcastId: linkId })}
              disabled={loading || !linkId}
            >
              Link
            </button>
          </div>
          <div className={styles.divider}>or</div>
          <div className={styles.option}>
            <label className={styles.label}>
              Create new podcast from topic
              <input
                type="text"
                className={styles.input}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Topic for the demo podcast..."
              />
            </label>
            <button
              className={styles.btn}
              onClick={() => linkPodcast({ topic })}
              disabled={loading || !topic}
            >
              Create
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <h3 className={styles.title}>
          Podcast: {podcast?.title ?? 'Loading...'}
        </h3>
        <button className={styles.btnSmall} onClick={loadPodcast}>
          Refresh
        </button>
      </div>

      {/* Script turns */}
      {podcast?.script?.turns && (
        <div className={styles.section}>
          <h4 className={styles.subtitle}>Script ({podcast.script.turns.length} turns)</h4>
          <div className={styles.turnList}>
            {podcast.script.turns.map((turn, i) => (
              <div key={i} className={styles.turn}>
                <span className={styles.speaker}>{turn.speaker}</span>
                <p className={styles.turnText}>{turn.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
