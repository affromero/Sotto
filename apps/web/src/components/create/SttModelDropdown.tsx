'use client';

import { useEffect, useState } from 'react';
import { ModelDropdown, type ModelOption } from './ModelDropdown';

const STORAGE_KEY = 'sotto:sttProvider';

interface SttProvidersResponse {
  providers: Array<{
    id: string;
    displayName: string;
    description: string;
  }>;
  configuredProviders: string[];
}

interface SttModelDropdownProps {
  value: string | undefined;
  onChange: (provider: string | undefined) => void;
}

export function SttModelDropdown({ value, onChange }: SttModelDropdownProps) {
  const [options, setOptions] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/stt-providers')
      .then((res) => res.json())
      .then((data: SttProvidersResponse) => {
        const configured = new Set(data.configuredProviders || []);
        const mapped: ModelOption[] = (data.providers || []).map((p) => ({
          id: p.id,
          displayName: p.displayName,
          badge: p.description,
          unavailable: !configured.has(p.id),
        }));
        setOptions(mapped);

        // Restore from localStorage if valid and available
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored && mapped.some((o) => o.id === stored && !o.unavailable)) {
          onChange(stored === 'openai' ? undefined : stored);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist to localStorage on change (skip initial undefined before providers load)
  useEffect(() => {
    if (value) {
      localStorage.setItem(STORAGE_KEY, value);
    }
  }, [value]);

  return (
    <ModelDropdown
      label="Transcription"
      options={options}
      value={value}
      onChange={onChange}
      loading={loading}
    />
  );
}
