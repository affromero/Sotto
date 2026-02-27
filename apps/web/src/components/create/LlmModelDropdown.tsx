'use client';

import { useEffect, useState } from 'react';
import { ModelDropdown, type ModelOption } from './ModelDropdown';

const STORAGE_KEY = 'sotto:aiModel';
const AUTO_ID = '__auto__';

interface AiModelsResponse {
  models: Array<{
    id: string;
    displayName: string;
    tier: string;
    requiredPlan: 'FREE' | 'PRO';
    isDefault: boolean;
    group?: string;
    hint?: string;
  }>;
  readOnly: boolean;
  userPlan?: 'FREE' | 'PRO';
  isByok?: boolean;
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
        const userPlan = data.userPlan ?? 'FREE';
        const isByok = data.isByok ?? false;
        const isLocked = (m: AiModelsResponse['models'][number]) =>
          m.requiredPlan === 'PRO' && userPlan === 'FREE' && !isByok;

        const autoOption: ModelOption = {
          id: AUTO_ID,
          displayName: 'Auto (recommended)',
          hint: 'Sotto picks the best model for you',
        };

        const modelOptions: ModelOption[] = (data.models || []).map((m) => ({
          id: m.id,
          displayName: m.displayName,
          badge: isLocked(m) ? 'Pro' : undefined,
          hint: m.hint,
          group: m.group,
          unavailable: isLocked(m),
        }));

        setOptions([autoOption, ...modelOptions]);
        setReadOnly(data.readOnly ?? false);

        // Restore from localStorage if valid, otherwise default to Auto
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored && stored !== AUTO_ID && modelOptions.some((o) => o.id === stored && !o.unavailable)) {
          onChange(stored);
        } else {
          // Auto = undefined model → backend uses admin-configured default
          onChange(undefined);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist to localStorage on change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, value ?? AUTO_ID);
  }, [value]);

  return (
    <ModelDropdown
      label="AI Model"
      options={options}
      value={value ?? AUTO_ID}
      onChange={(id) => onChange(id === AUTO_ID ? undefined : id)}
      disabled={readOnly}
      loading={loading}
    />
  );
}
