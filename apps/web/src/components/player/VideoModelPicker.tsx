'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { ModelDropdown, type ModelOption } from '@/components/create/ModelDropdown';
import { Button } from '@/components/ui/Button';
import styles from './VideoModelPicker.module.css';

interface VideoModelPickerProps {
  onGenerate: (override?: { aiModel: string }) => void;
  onCancel: () => void;
  loading: boolean;
}

const AUTO_OPTION: ModelOption = {
  id: '__auto__',
  displayName: 'Auto (recommended)',
  hint: 'Sotto picks the best model',
};

export function VideoModelPicker({ onGenerate, onCancel, loading }: VideoModelPickerProps) {
  const [models, setModels] = useState<ModelOption[]>([AUTO_OPTION]);
  const [selected, setSelected] = useState<string | undefined>('__auto__');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/ai-models')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.models) return;
        const mapped: ModelOption[] = data.models.map((m: { id: string; displayName: string; group?: string; hint?: string; requiredPlan?: string }) => ({
          id: m.id,
          displayName: m.displayName,
          group: m.group,
          hint: m.hint,
          badge: m.requiredPlan === 'PRO' && data.userPlan === 'FREE' ? 'Pro' : undefined,
          unavailable: m.requiredPlan === 'PRO' && data.userPlan === 'FREE' && !data.isByok,
        }));
        setModels([AUTO_OPTION, ...mapped]);
      })
      .catch(() => {
        // Fall back to just "Auto" option
      });
    return () => { cancelled = true; };
  }, []);

  const handleGenerate = () => {
    if (selected === '__auto__' || !selected) {
      onGenerate();
    } else {
      onGenerate({ aiModel: selected });
    }
  };

  return (
    <div className={styles.root}>
      <ModelDropdown
        label="AI Model"
        options={models}
        value={selected}
        onChange={setSelected}
        disabled={loading}
      />
      <Button
        variant="primary"
        onClick={handleGenerate}
        loading={loading}
        disabled={loading}
      >
        <RefreshCw size={14} />
        Generate
      </Button>
      <button
        type="button"
        className={styles.cancel}
        onClick={onCancel}
        disabled={loading}
        aria-label="Cancel"
      >
        Cancel
      </button>
    </div>
  );
}
