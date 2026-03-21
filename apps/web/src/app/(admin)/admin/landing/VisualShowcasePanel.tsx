'use client';

import { useState, useEffect } from 'react';
import styles from './VisualShowcasePanel.module.css';

interface ShowcaseItem {
  visualType: string;
  label: string;
  description: string;
  imageUrl: string;
  credits?: string;
}

interface ShowcaseFailure {
  visualType: string;
  error: string;
}

interface ImageModelOption {
  modelId: string;
  displayName: string;
  formattedPrice: string;
}

interface CostPreview {
  programmatic: { count: number; cost: string };
  aiIllustration: { defaultModel: string; provider: string; available: boolean; models: ImageModelOption[] };
  stockFootage: { provider: string; available: boolean; cost: string };
  mapOverlay: { provider: string; available: boolean; cost: string };
}

export function VisualShowcasePanel() {
  const [items, setItems] = useState<ShowcaseItem[]>([]);
  const [failures, setFailures] = useState<ShowcaseFailure[]>([]);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState('');
  const [costPreview, setCostPreview] = useState<CostPreview | null>(null);
  const [selectedModel, setSelectedModel] = useState('');

  useEffect(() => {
    fetch('/api/admin/showcase')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) {
          setCostPreview(data);
          if (data.aiIllustration?.defaultModel) {
            setSelectedModel(data.aiIllustration.defaultModel);
          }
        }
      })
      .catch(() => {});
  }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    setProgress('Generating showcase stills for all 11 visual types...');
    setFailures([]);

    try {
      const res = await fetch('/api/admin/showcase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageModel: selectedModel || undefined }),
      });
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

      {costPreview && !generating && items.length === 0 && (
        <div className={styles.costPreview}>
          <h3 className={styles.costTitle}>What will be used</h3>
          <div className={styles.costGrid}>
            <div className={styles.costItem}>
              <span className={styles.costLabel}>Programmatic ({costPreview.programmatic.count} types)</span>
              <span className={styles.costValue}>{costPreview.programmatic.cost}</span>
            </div>
            <div className={styles.costItem}>
              <span className={styles.costLabel}>AI Illustration</span>
              <span className={styles.costValue}>
                {costPreview.aiIllustration.available ? (
                  <>
                    {costPreview.aiIllustration.provider}
                    {costPreview.aiIllustration.models.length > 0 ? (
                      <>
                        {' '}&middot;{' '}
                        <select
                          className={styles.modelSelect}
                          value={selectedModel}
                          onChange={(e) => setSelectedModel(e.target.value)}
                        >
                          {costPreview.aiIllustration.models.map((m) => (
                            <option key={m.modelId} value={m.modelId}>
                              {m.displayName} ({m.formattedPrice})
                            </option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <> &middot; pricing unavailable</>
                    )}
                  </>
                ) : (
                  <span className={styles.unavailable}>FAL_KEY not set</span>
                )}
              </span>
            </div>
            <div className={styles.costItem}>
              <span className={styles.costLabel}>Stock Footage</span>
              <span className={styles.costValue}>
                {costPreview.stockFootage.available
                  ? <>{costPreview.stockFootage.provider} &middot; {costPreview.stockFootage.cost}</>
                  : <span className={styles.unavailable}>PEXELS_API_KEY not set</span>
                }
              </span>
            </div>
            <div className={styles.costItem}>
              <span className={styles.costLabel}>Map Overlay</span>
              <span className={styles.costValue}>
                {costPreview.mapOverlay.available
                  ? <>{costPreview.mapOverlay.provider} &middot; {costPreview.mapOverlay.cost}</>
                  : <span className={styles.unavailable}>MAPBOX_ACCESS_TOKEN not set</span>
                }
              </span>
            </div>
          </div>
        </div>
      )}

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
                {item.credits && (
                  <span className={styles.credits}>{item.credits}</span>
                )}
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
