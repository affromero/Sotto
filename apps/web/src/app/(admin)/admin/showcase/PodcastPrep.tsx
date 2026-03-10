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

interface VoiceTrack {
  id: string;
  name: string;
  ttsProvider: string | null;
  segments: Array<{ id: string; audioUrl: string | null; status: string }>;
}

interface PodcastData {
  id: string;
  title: string;
  status: string;
  script: { turns: ScriptTurn[] } | null;
  voiceTracks: VoiceTrack[];
}

export function PodcastPrep({ project }: { project: DemoProject }) {
  const [podcast, setPodcast] = useState<PodcastData | null>(null);
  const [loading, setLoading] = useState(false);
  const [linkId, setLinkId] = useState('');
  const [topic, setTopic] = useState('');
  const [playingTrack, setPlayingTrack] = useState<string | null>(null);

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

      {/* Voice tracks / audio per provider */}
      {podcast?.voiceTracks && podcast.voiceTracks.length > 0 && (
        <div className={styles.section}>
          <h4 className={styles.subtitle}>Audio Tracks</h4>
          <div className={styles.trackList}>
            {podcast.voiceTracks.map((track) => (
              <div key={track.id} className={styles.trackCard}>
                <div className={styles.trackHeader}>
                  <span className={styles.trackName}>{track.name}</span>
                  {track.ttsProvider && (
                    <span className={styles.providerBadge}>{track.ttsProvider}</span>
                  )}
                </div>
                {track.segments.some((s) => s.audioUrl) && (
                  <button
                    className={styles.btnSmall}
                    onClick={() => setPlayingTrack(playingTrack === track.id ? null : track.id)}
                  >
                    {playingTrack === track.id ? 'Stop' : 'Play'}
                  </button>
                )}
                {playingTrack === track.id && track.segments[0]?.audioUrl && (
                  <audio
                    src={track.segments[0].audioUrl}
                    controls
                    autoPlay
                    className={styles.audio}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
