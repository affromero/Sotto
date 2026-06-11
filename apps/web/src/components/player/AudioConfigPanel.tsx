'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from './AudioConfigPanel.module.css';

interface TtsOption {
  id: string;
  displayName: string;
  badge?: string;
  group?: string;
  hint?: string;
}

interface VoiceOption {
  id: string;
  name: string;
}

export interface AudioConfig {
  voices: Array<{ speaker: string; voiceId: string | null; provider?: string }>;
}

interface AudioConfigPanelProps {
  speakers: string[];
  onConfigChange: (config: AudioConfig) => void;
  failedProvider?: string | null;
}

interface SpeakerConfig {
  provider: string; // '' = auto
  voiceId: string;  // '' = auto
}

const SPEAKER_COLOR_CLASSES = ['speaker0', 'speaker1', 'speaker2', 'speaker3'] as const;

function parseProviderFromOption(optionId: string): { provider: string; model: string } {
  if (!optionId || optionId === 'auto') return { provider: '', model: '' };
  const [provider, ...rest] = optionId.split(':');
  return { provider, model: rest.join(':') };
}

export function AudioConfigPanel({ speakers, onConfigChange, failedProvider }: AudioConfigPanelProps) {
  const [providerOptions, setProviderOptions] = useState<TtsOption[]>([]);
  const [speakerConfigs, setSpeakerConfigs] = useState<Record<string, SpeakerConfig>>(() => {
    const initial: Record<string, SpeakerConfig> = {};
    for (const s of speakers) {
      initial[s] = { provider: '', voiceId: '' };
    }
    return initial;
  });
  // Voice options keyed by provider ID (e.g., 'elevenlabs')
  const [voicesByProvider, setVoicesByProvider] = useState<Record<string, VoiceOption[]>>({});
  const [loadingVoices, setLoadingVoices] = useState<Record<string, boolean>>({});

  // Fetch available TTS providers on mount
  useEffect(() => {
    fetch('/api/v1/tts-options')
      .then((res) => res.json())
      .then((data) => {
        setProviderOptions(data.options || []);
      })
      .catch(() => {});
  }, []);

  // Fetch voices for a provider (cached in voicesByProvider)
  const fetchVoicesForProvider = useCallback(async (providerKey: string) => {
    if (!providerKey || voicesByProvider[providerKey]) return;

    setLoadingVoices((prev) => ({ ...prev, [providerKey]: true }));
    try {
      const res = await fetch(`/api/v1/voices?provider=${providerKey}`);
      if (res.ok) {
        const data = await res.json();
        const voices: VoiceOption[] = (data.poolVoices || []).map((v: { id: string; name: string }) => ({
          id: v.id,
          name: v.name,
        }));
        setVoicesByProvider((prev) => ({ ...prev, [providerKey]: voices }));
      }
    } catch {
      // Non-critical
    } finally {
      setLoadingVoices((prev) => ({ ...prev, [providerKey]: false }));
    }
  }, [voicesByProvider]);

  // Emit config whenever speakerConfigs change
  useEffect(() => {
    const voices = speakers.map((speaker) => {
      const cfg = speakerConfigs[speaker] || { provider: '', voiceId: '' };
      return {
        speaker,
        voiceId: cfg.voiceId || null,
        provider: cfg.provider || undefined,
      };
    });
    onConfigChange({ voices });
  }, [speakerConfigs, speakers, onConfigChange]);

  const handleProviderChange = useCallback((speaker: string, optionId: string) => {
    const { provider } = parseProviderFromOption(optionId);
    setSpeakerConfigs((prev) => ({
      ...prev,
      [speaker]: { provider: optionId, voiceId: '' }, // Reset voice when provider changes
    }));
    // Fetch voices for this provider if not cached
    if (provider) {
      fetchVoicesForProvider(provider);
    }
  }, [fetchVoicesForProvider]);

  const handleVoiceChange = useCallback((speaker: string, voiceId: string) => {
    setSpeakerConfigs((prev) => ({
      ...prev,
      [speaker]: { ...prev[speaker], voiceId },
    }));
  }, []);

  return (
    <div className={styles.container}>
      {failedProvider && (
        <div className={styles.failedProviderInfo}>
          Previous attempt failed with {failedProvider}. Pick a different provider to retry.
        </div>
      )}

      <div className={styles.speakerList}>
        {speakers.map((speaker, i) => {
          const cfg = speakerConfigs[speaker] || { provider: '', voiceId: '' };
          const colorClass = styles[SPEAKER_COLOR_CLASSES[i % SPEAKER_COLOR_CLASSES.length]];
          const { provider: providerKey } = parseProviderFromOption(cfg.provider);
          const voices = providerKey ? voicesByProvider[providerKey] || [] : [];
          const isLoadingVoices = providerKey ? loadingVoices[providerKey] : false;

          return (
            <div key={speaker} className={styles.speakerRow}>
              <span className={`${styles.speakerLabel} ${colorClass}`}>
                {speaker}
              </span>
              <div className={styles.dropdowns}>
                <select
                  className={styles.providerSelect}
                  value={cfg.provider}
                  onChange={(e) => handleProviderChange(speaker, e.target.value)}
                  aria-label={`${speaker} voice provider`}
                >
                  <option value="">Auto</option>
                  {providerOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.displayName}
                    </option>
                  ))}
                </select>
                <select
                  className={styles.voiceSelect}
                  value={cfg.voiceId}
                  onChange={(e) => handleVoiceChange(speaker, e.target.value)}
                  disabled={!providerKey || isLoadingVoices}
                  aria-label={`${speaker} voice`}
                >
                  <option value="">Auto</option>
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
