'use client';

import { useState, useEffect, useCallback } from 'react';
import styles from './VisualShowcasePanel.module.css';

interface ShowcaseItem {
  visualType: string;
  label: string;
  description: string;
  url: string;
  mediaType: 'image' | 'video';
  credits?: string;
}

interface ShowcaseSet {
  id: string;
  name: string;
  items: ShowcaseItem[];
  active: boolean;
  createdAt: string;
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
  const [sets, setSets] = useState<ShowcaseSet[]>([]);
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState('');
  const [newName, setNewName] = useState('');
  const [costPreview, setCostPreview] = useState<CostPreview | null>(null);
  const [selectedModel, setSelectedModel] = useState('');

  const fetchSets = useCallback(async () => {
    const res = await fetch('/api/admin/showcase');
    if (!res.ok) return;
    const data = await res.json();
    setSets(data.sets ?? []);
    setCostPreview(data.costPreview ?? null);
    if (data.costPreview?.aiIllustration?.defaultModel) {
      setSelectedModel(data.costPreview.aiIllustration.defaultModel);
    }
  }, []);

  useEffect(() => { fetchSets(); }, [fetchSets]);

  const selectedSet = sets.find((s) => s.id === selectedSetId);

  const handleGenerate = async () => {
    const name = newName.trim();
    if (!name) { setProgress('Enter a name for the showcase set'); return; }
    setGenerating(true);
    setProgress('Generating clips for all 11 visual types...');

    try {
      const res = await fetch('/api/admin/showcase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, imageModel: selectedModel || undefined }),
      });
      const data = await res.json();

      if (res.ok) {
        const failCount = data.failures?.length ?? 0;
        setProgress(`Saved "${name}" with ${(data.set.items as ShowcaseItem[]).length} visual types${failCount > 0 ? ` (${failCount} failed)` : ''}`);
        setNewName('');
        await fetchSets();
        setSelectedSetId(data.set.id);
      } else {
        setProgress(`Error: ${data.error ?? 'Unknown error'}`);
      }
    } catch (err) {
      setProgress(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleToggleActive = async (id: string, active: boolean) => {
    await fetch('/api/admin/showcase', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, active }),
    });
    await fetchSets();
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete showcase "${name}"? This cannot be undone.`)) return;
    await fetch(`/api/admin/showcase?id=${id}`, { method: 'DELETE' });
    if (selectedSetId === id) setSelectedSetId(null);
    await fetchSets();
  };

  const activeSets = sets.filter((s) => s.active);

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Visual Type Showcase</h2>
          <p className={styles.subtitle}>
            Generate animated clips for all 11 visual types. Active sets are shown randomly on the landing page.
          </p>
        </div>
      </div>

      {/* Saved sets list */}
      {sets.length > 0 && (
        <div className={styles.setsList}>
          <h3 className={styles.costTitle}>
            Saved Sets ({sets.length})
            {activeSets.length > 0 && (
              <span className={styles.activeCount}> &middot; {activeSets.length} active</span>
            )}
          </h3>
          {sets.map((s) => (
            <div
              key={s.id}
              className={`${styles.setRow} ${s.id === selectedSetId ? styles.setRowSelected : ''}`}
              onClick={() => setSelectedSetId(s.id === selectedSetId ? null : s.id)}
            >
              <div className={styles.setInfo}>
                <span className={styles.setName}>{s.name}</span>
                <span className={styles.setMeta}>
                  {(s.items as ShowcaseItem[]).length} types &middot; {new Date(s.createdAt).toLocaleDateString()}
                </span>
              </div>
              <div className={styles.setActions}>
                <button
                  type="button"
                  className={styles.toggleBtn}
                  onClick={(e) => { e.stopPropagation(); handleToggleActive(s.id, !s.active); }}
                  aria-pressed={s.active}
                >
                  <span className={`${styles.toggleTrack} ${s.active ? styles.toggleOn : ''}`}>
                    <span className={styles.toggleKnob} />
                  </span>
                </button>
                <button
                  type="button"
                  className={styles.deleteBtn}
                  onClick={(e) => { e.stopPropagation(); handleDelete(s.id, s.name); }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Selected set preview */}
      {selectedSet && (
        <div className={styles.grid}>
          {(selectedSet.items as ShowcaseItem[]).map((item) => (
            <div key={item.visualType} className={styles.card}>
              <div className={styles.imageWrap}>
                {item.mediaType === 'video' ? (
                  <video src={item.url} className={styles.image} autoPlay loop muted playsInline />
                ) : (
                  <img src={item.url} alt={item.label} className={styles.image} />
                )}
                {item.credits && <span className={styles.credits}>{item.credits}</span>}
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

      {/* Generate new set */}
      <div className={styles.generateSection}>
        <h3 className={styles.costTitle}>Generate New Set</h3>

        <div className={styles.generateRow}>
          <input
            type="text"
            className={styles.nameInput}
            placeholder="Set name (e.g. Fusion Energy, AI Revolution)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={generating}
          />
          <button
            type="button"
            className={styles.generateBtn}
            onClick={handleGenerate}
            disabled={generating || !newName.trim()}
          >
            {generating ? 'Generating...' : 'Generate'}
          </button>
        </div>

        {costPreview && !generating && (
          <div className={styles.costPreview}>
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
                    : <span className={styles.unavailable}>PEXELS_API_KEY not set</span>}
                </span>
              </div>
              <div className={styles.costItem}>
                <span className={styles.costLabel}>Map Overlay</span>
                <span className={styles.costValue}>
                  {costPreview.mapOverlay.available
                    ? <>{costPreview.mapOverlay.provider} &middot; {costPreview.mapOverlay.cost}</>
                    : <span className={styles.unavailable}>MAPBOX_ACCESS_TOKEN not set</span>}
                </span>
              </div>
            </div>
          </div>
        )}

        {progress && <p className={styles.progress}>{progress}</p>}
      </div>
    </section>
  );
}
