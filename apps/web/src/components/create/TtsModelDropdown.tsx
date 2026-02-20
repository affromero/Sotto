'use client';

import { useEffect, useState } from 'react';
import { ModelDropdown, type ModelOption } from './ModelDropdown';

const STORAGE_KEY = 'sotto:ttsOption';

interface TtsOptionsResponse {
  options: Array<{
    id: string;
    displayName: string;
    badge?: string;
    group?: string;
  }>;
  readOnly: boolean;
}

interface TtsModelDropdownProps {
  ttsProvider: string | undefined;
  ttsModel: string | undefined;
  onChange: (ttsProvider: string | undefined, ttsModel: string | undefined) => void;
}

function parseValue(combined: string | undefined): { provider: string | undefined; model: string | undefined } {
  if (!combined || combined === 'auto') return { provider: undefined, model: undefined };
  const [provider, ...rest] = combined.split(':');
  return { provider, model: rest.join(':') || undefined };
}

function toValue(provider: string | undefined, model: string | undefined): string | undefined {
  if (!provider || !model) return undefined;
  return `${provider}:${model}`;
}

export function TtsModelDropdown({ ttsProvider, ttsModel, onChange }: TtsModelDropdownProps) {
  const [options, setOptions] = useState<ModelOption[]>([]);
  const [readOnly, setReadOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  const currentValue = toValue(ttsProvider, ttsModel);

  useEffect(() => {
    fetch('/api/tts-options')
      .then((res) => res.json())
      .then((data: TtsOptionsResponse) => {
        const mapped: ModelOption[] = (data.options || []).map((o) => ({
          id: o.id,
          displayName: o.displayName,
          badge: o.badge,
          group: o.group,
        }));
        setOptions(mapped);
        setReadOnly(data.readOnly ?? false);

        // Restore from localStorage if valid
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored && mapped.some((o) => o.id === stored)) {
          const { provider, model } = parseValue(stored);
          onChange(provider, model);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist to localStorage on change
  useEffect(() => {
    const val = currentValue ?? 'auto';
    localStorage.setItem(STORAGE_KEY, val);
  }, [currentValue]);

  const handleChange = (value: string | undefined) => {
    // value is undefined when "Auto" (first option) is selected
    const combined = value ?? 'auto';
    const { provider, model } = parseValue(combined);
    onChange(provider, model);
  };

  return (
    <ModelDropdown
      label="Voice Provider"
      options={options}
      value={currentValue}
      onChange={handleChange}
      disabled={readOnly}
      loading={loading}
    />
  );
}
