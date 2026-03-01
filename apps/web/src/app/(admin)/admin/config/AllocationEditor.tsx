'use client';

import styles from './AllocationEditor.module.css';

interface ModelOption {
  id: string;
  displayName: string;
  tier: string;
}

interface ProviderOption {
  id: string;
  displayName: string;
  models: ModelOption[];
}

export interface Allocation {
  provider: string;
  model: string;
  quota: number;
}

interface AllocationEditorProps {
  label: string;
  providers: ProviderOption[];
  allocations: Allocation[];
  onChange: (allocations: Allocation[]) => void;
  dailyGenerationLimit: number;
}

export function AllocationEditor({
  label,
  providers,
  allocations,
  onChange,
  dailyGenerationLimit,
}: AllocationEditorProps) {
  const quotaSum = allocations.reduce((sum, a) => sum + a.quota, 0);
  const isOver = quotaSum > dailyGenerationLimit;

  const handleAdd = () => {
    const usedProviders = new Set(allocations.map((a) => a.provider));
    const available = providers.find((p) => !usedProviders.has(p.id));
    if (!available) return;

    onChange([
      ...allocations,
      { provider: available.id, model: available.models[0]?.id ?? '', quota: 1 },
    ]);
  };

  const handleRemove = (index: number) => {
    onChange(allocations.filter((_, i) => i !== index));
  };

  const handleProviderChange = (index: number, newProvider: string) => {
    const provider = providers.find((p) => p.id === newProvider);
    const updated = [...allocations];
    updated[index] = {
      provider: newProvider,
      model: provider?.models[0]?.id ?? '',
      quota: updated[index].quota,
    };
    onChange(updated);
  };

  const handleModelChange = (index: number, newModel: string) => {
    const updated = [...allocations];
    updated[index] = { ...updated[index], model: newModel };
    onChange(updated);
  };

  const handleQuotaChange = (index: number, newQuota: number) => {
    const updated = [...allocations];
    updated[index] = { ...updated[index], quota: Math.max(1, Math.min(50, newQuota)) };
    onChange(updated);
  };

  const canAdd = allocations.length < providers.length;

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <h4 className={styles.sectionTitle}>{label} Allocations</h4>
        <span className={`${styles.quotaSummary} ${isOver ? styles.quotaOver : ''}`}>
          {quotaSum} / {dailyGenerationLimit} allocated
        </span>
      </div>

      {allocations.map((alloc, i) => {
        const provider = providers.find((p) => p.id === alloc.provider);
        const models = provider?.models ?? [];

        return (
          <div key={i} className={styles.row}>
            <div className={styles.rowField}>
              <label className={styles.rowLabel}>Provider</label>
              <select
                className={styles.rowSelect}
                value={alloc.provider}
                onChange={(e) => handleProviderChange(i, e.target.value)}
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.rowField}>
              <label className={styles.rowLabel}>Model</label>
              <select
                className={styles.rowSelect}
                value={alloc.model}
                onChange={(e) => handleModelChange(i, e.target.value)}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName} ({m.tier})
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.rowFieldSmall}>
              <label className={styles.rowLabel}>Quota</label>
              <input
                type="number"
                className={styles.rowInput}
                value={alloc.quota}
                onChange={(e) => handleQuotaChange(i, parseInt(e.target.value, 10) || 1)}
                min={1}
                max={50}
              />
            </div>

            <button
              type="button"
              className={styles.removeButton}
              onClick={() => handleRemove(i)}
              aria-label={`Remove ${provider?.displayName ?? 'provider'}`}
            >
              &times;
            </button>
          </div>
        );
      })}

      {canAdd && (
        <button type="button" className={styles.addButton} onClick={handleAdd}>
          + Add Provider
        </button>
      )}
    </div>
  );
}
