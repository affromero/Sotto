'use client';

import { useEffect, useState } from 'react';
import { ModelDropdown, type ModelOption } from './ModelDropdown';

const STORAGE_KEY = 'sotto:aiModel';

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

type AiModelOption = ModelOption & { isDefault?: boolean };

interface LlmModelDropdownProps {
  value: string | undefined;
  onChange: (model: string | undefined) => void;
}

export function LlmModelDropdown({ value, onChange }: LlmModelDropdownProps) {
  const [options, setOptions] = useState<AiModelOption[]>([]);
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

        const modelOptions: AiModelOption[] = (data.models || []).map((m) => ({
          id: m.id,
          displayName: m.displayName,
          isDefault: m.isDefault,
          badge: isLocked(m) ? 'Pro' : undefined,
          hint: m.hint,
          group: m.group,
          unavailable: isLocked(m),
        }));

        setOptions(modelOptions);
        setReadOnly(data.readOnly ?? false);

        const defaultOption =
          modelOptions.find((o) => o.isDefault && !o.unavailable) ??
          modelOptions.find((o) => !o.unavailable);

        // Restore from localStorage if valid, otherwise use the concrete server default.
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored && modelOptions.some((o) => o.id === stored && !o.unavailable)) {
          onChange(stored);
        } else if (defaultOption) {
          onChange(defaultOption.id);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist to localStorage on change
  useEffect(() => {
    if (value) {
      localStorage.setItem(STORAGE_KEY, value);
    } else {
      localStorage.removeItem(STORAGE_KEY);
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
