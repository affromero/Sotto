'use client';

import { useState } from 'react';
import styles from './VisualShowcasePanel.module.css';

interface ShowcaseItem {
  visualType: string;
  label: string;
  description: string;
  imageUrl: string;
}

interface ShowcaseFailure {
  visualType: string;
  error: string;
}

export function VisualShowcasePanel() {
  const [items, setItems] = useState<ShowcaseItem[]>([]);
  const [failures, setFailures] = useState<ShowcaseFailure[]>([]);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState('');

  const handleGenerate = async () => {
    setGenerating(true);
    setProgress('Generating showcase stills for all 11 visual types...');
    setFailures([]);

    try {
      const res = await fetch('/api/admin/showcase', { method: 'POST' });
      const data = await res.json();

      if (res.ok) {
        setItems(data.items ?? []);
        setFailures(data.failures ?? []);
        setProgress(`Generated ${data.count} of 11 visual types`);
      } else {
        setProgress(`Error: ${data.error ?? 'Unknown error'}`);
      }
    } catch (err) {
      setProgress(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Visual Type Showcase</h2>
          <p className={styles.subtitle}>
            Generate example stills for each of the 11 video visual types.
            No podcast needed — uses curated sample data.
          </p>
        </div>
        <button
          type="button"
          className={styles.generateBtn}
          onClick={handleGenerate}
          disabled={generating}
        >
          {generating ? 'Generating...' : items.length > 0 ? 'Regenerate All' : 'Generate Showcase'}
        </button>
      </div>

      {progress && <p className={styles.progress}>{progress}</p>}

      {failures.length > 0 && (
        <div className={styles.failures}>
          {failures.map((f) => (
            <div key={f.visualType} className={styles.failureItem}>
              <strong>{f.visualType}</strong>: {f.error}
            </div>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className={styles.grid}>
          {items.map((item) => (
            <div key={item.visualType} className={styles.card}>
              <div className={styles.imageWrap}>
                <img
                  src={item.imageUrl}
                  alt={item.label}
                  className={styles.image}
                />
              </div>
              <div className={styles.cardBody}>
                <span className={styles.badge}>{item.visualType}</span>
                <h3 className={styles.cardTitle}>{item.label}</h3>
                <p className={styles.cardDesc}>{item.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
