'use client';

import { useEffect, useState } from 'react';
import { ModelDropdown, type ModelOption } from './ModelDropdown';

const STORAGE_KEY = 'sotto:aiModel';

const TIER_BADGES: Record<string, string> = {
  fast: 'Fast',
  balanced: 'Balanced',
  best: 'Best',
};

interface AiModelsResponse {
  models: Array<{
    id: string;
    displayName: string;
    tier: string;
    isDefault: boolean;
    group?: string;
  }>;
  readOnly: boolean;
}

interface LlmModelDropdownProps {
  value: string | undefined;
  onChange: (model: string | undefined) => void;
}

export function LlmModelDropdown({ value, onChange }: LlmModelDropdownProps) {
  const [options, setOptions] = useState<ModelOption[]>([]);
  const [readOnly, setReadOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/ai-models')
      .then((res) => res.json())
      .then((data: AiModelsResponse) => {
        const mapped: ModelOption[] = (data.models || []).map((m) => ({
          id: m.id,
          displayName: m.displayName,
          badge: TIER_BADGES[m.tier],
          group: m.group,
        }));
        setOptions(mapped);
        setReadOnly(data.readOnly ?? false);

        // Restore from localStorage if valid, otherwise use first option
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored && mapped.some((o) => o.id === stored)) {
          onChange(stored);
        } else if (mapped.length > 0) {
          onChange(mapped[0].id);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist to localStorage on change (skip initial undefined before models load)
  useEffect(() => {
    if (value) {
      localStorage.setItem(STORAGE_KEY, value);
    }
  }, [value]);

  return (
    <ModelDropdown
      label="AI Model"
      options={options}
      value={value}
      onChange={onChange}
      disabled={readOnly}
      loading={loading}
    />
  );
}
