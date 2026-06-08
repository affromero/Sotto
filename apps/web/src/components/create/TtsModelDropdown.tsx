'use client';

import { useEffect, useState } from 'react';
import { ModelDropdown, type ModelOption } from './ModelDropdown';
import styles from './TtsModelDropdown.module.css';

const STORAGE_KEY = 'sotto:ttsOption';

interface TtsOptionsResponse {
  options: Array<{
    id: string;
    displayName: string;
    badge?: string;
    group?: string;
    hint?: string;
    supportedLanguages?: string[];
  }>;
  readOnly: boolean;
}

interface TtsModelDropdownProps {
  ttsProvider: string | undefined;
  ttsModel: string | undefined;
  onChange: (ttsProvider: string | undefined, ttsModel: string | undefined) => void;
  /** When set, shows a warning if the selected provider/model doesn't support this language. */
  detectedLanguage?: string | null;
}

function parseValue(combined: string | undefined): {
  provider: string | undefined;
  model: string | undefined;
} {
  if (!combined || combined === 'auto') return { provider: undefined, model: undefined };
  const [provider, ...rest] = combined.split(':');
  return { provider, model: rest.join(':') || undefined };
}

function toValue(provider: string | undefined, model: string | undefined): string | undefined {
  if (!provider || !model) return undefined;
  return `${provider}:${model}`;
}

export function TtsModelDropdown({
  ttsProvider,
  ttsModel,
  onChange,
  detectedLanguage,
}: TtsModelDropdownProps) {
  const [options, setOptions] = useState<ModelOption[]>([]);
  const [rawOptions, setRawOptions] = useState<TtsOptionsResponse['options']>([]);
  const [readOnly, setReadOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  const currentValue = toValue(ttsProvider, ttsModel);

  useEffect(() => {
    fetch('/api/tts-options')
      .then((res) => res.json())
      .then((data: TtsOptionsResponse) => {
        const opts = data.options || [];
        setRawOptions(opts);
        const mapped: ModelOption[] = opts.map((o) => ({
          id: o.id,
          displayName: o.displayName,
          badge: o.badge,
          group: o.group,
          hint: o.hint,
        }));
        setOptions(mapped);
        setReadOnly(data.readOnly ?? false);

        // Restore from localStorage if valid, otherwise select the first concrete provider.
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored && mapped.some((o) => o.id === stored)) {
          const { provider, model } = parseValue(stored);
          onChange(provider, model);
        } else if (!currentValue && mapped[0] && mapped[0].id !== 'auto') {
          const { provider, model } = parseValue(mapped[0].id);
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
    // value is undefined only when the explicit Auto option is selected.
    const combined = value ?? 'auto';
    const { provider, model } = parseValue(combined);
    onChange(provider, model);
  };

  // Check if selected model supports the detected language
  const languageUnsupported = (() => {
    if (!detectedLanguage || !currentValue) return false;
    const selected = rawOptions.find((o) => o.id === currentValue);
    if (!selected?.supportedLanguages) return false;
    return !selected.supportedLanguages.includes(detectedLanguage);
  })();

  return (
    <div>
      <ModelDropdown
        label="Voice Provider"
        options={options}
        value={currentValue}
        onChange={handleChange}
        disabled={readOnly}
        loading={loading}
      />
      {languageUnsupported && detectedLanguage && (
        <p role="alert" className={styles.languageWarning}>
          This model may not support {detectedLanguage.toUpperCase()} audio. Consider switching to a
          multilingual model.
        </p>
      )}
    </div>
  );
}
