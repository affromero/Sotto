'use client';

import { useCallback, useEffect, useState } from 'react';
import { TtsModelDropdown } from '@/components/create/TtsModelDropdown';
import { VoiceCard } from '@/components/discovery/VoiceCard';
import { HumeVoiceBrowser } from '@/components/discovery/HumeVoiceBrowser';
import styles from './AudioConfigPanel.module.css';

interface VoiceProfile {
  id: string;
  name: string;
  gender: string;
  accent: string;
  ageRange: string;
  character: string;
}

interface VoiceClone {
  id: string;
  name: string;
  externalVoiceId: string;
  sourceType: string;
  provider: string;
  createdAt: string;
}

interface SharedVoice extends VoiceClone {
  owner: { id: string; name: string | null };
}

export interface AudioConfig {
  ttsProvider: string | undefined;
  ttsModel: string | undefined;
  voices: Array<{ speaker: string; voiceId: string | null }>;
}

interface AudioConfigPanelProps {
  speakers: string[];
  onConfigChange: (config: AudioConfig) => void;
  failedProvider?: string | null;
}

const SPEAKER_COLORS = [
  'var(--color-speaker-0)',
  'var(--color-speaker-1)',
  'var(--color-speaker-2)',
  'var(--color-speaker-3)',
];

export function AudioConfigPanel({ speakers, onConfigChange, failedProvider }: AudioConfigPanelProps) {
  const [ttsProvider, setTtsProvider] = useState<string | undefined>();
  const [ttsModel, setTtsModel] = useState<string | undefined>();
  const [customMode, setCustomMode] = useState(false);
  const [voiceMap, setVoiceMap] = useState<Record<string, string>>({});
  const [poolVoices, setPoolVoices] = useState<VoiceProfile[]>([]);
  const [userClones, setUserClones] = useState<VoiceClone[]>([]);
  const [sharedVoices, setSharedVoices] = useState<SharedVoice[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Load voice options — re-fetch when provider changes
  useEffect(() => {
    async function load() {
      setLoaded(false);
      try {
        const params = new URLSearchParams();
        if (ttsProvider) params.set('provider', ttsProvider);
        const url = `/api/voices${params.size ? `?${params}` : ''}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setPoolVoices(data.poolVoices || []);
          setUserClones(data.userClones || []);
          setSharedVoices(data.sharedVoices || []);
        }
      } catch {
        // Non-critical — defaults to auto-assign
      } finally {
        setLoaded(true);
      }
    }
    load();
  }, [ttsProvider]);

  // Emit config changes
  const emitConfig = useCallback(() => {
    const voices: AudioConfig['voices'] = customMode
      ? Object.entries(voiceMap)
          .filter(([, voiceId]) => !!voiceId)
          .map(([speaker, voiceId]) => ({ speaker, voiceId }))
      : [];
    onConfigChange({ ttsProvider, ttsModel, voices });
  }, [ttsProvider, ttsModel, customMode, voiceMap, onConfigChange]);

  useEffect(() => {
    emitConfig();
  }, [emitConfig]);

  const handleProviderChange = useCallback((provider: string | undefined, model: string | undefined) => {
    setTtsProvider((prev) => {
      // Clear voice selections when provider changes (voice IDs are provider-specific)
      if (prev !== provider) setVoiceMap({});
      return provider;
    });
    setTtsModel(model);
  }, []);

  function handleToggleCustom() {
    setCustomMode((prev) => !prev);
    if (customMode) {
      setVoiceMap({});
    }
  }

  function handleSelectVoice(speaker: string, voiceId: string) {
    setVoiceMap((prev) => ({ ...prev, [speaker]: voiceId }));
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>Audio Configuration</h3>
        <p className={styles.subtitle}>
          Choose a voice provider and optionally pick voices for each speaker.
        </p>
      </div>

      {failedProvider && (
        <div className={styles.failedProviderInfo}>
          Previous attempt failed with {failedProvider}. Pick a different provider to retry.
        </div>
      )}

      <div className={styles.providerSection}>
        <TtsModelDropdown
          ttsProvider={ttsProvider}
          ttsModel={ttsModel}
          onChange={handleProviderChange}
        />
      </div>

      {!customMode && (
        <div className={styles.autoAssign}>
          <div className={styles.autoAssignIcon} aria-hidden="true">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </div>
          <div className={styles.autoAssignText}>
            <span className={styles.autoAssignTitle}>Auto-assign Voices</span>
            <span className={styles.autoAssignHint}>
              Voices will be matched to your script automatically.
            </span>
          </div>
        </div>
      )}

      {loaded && (
        <div className={styles.toggleRow}>
          <div className={styles.toggleLabel}>
            <span className={styles.toggleTitle}>Choose Custom Voices</span>
            <span className={styles.toggleHint}>
              Pick specific voices for each speaker
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={customMode}
            className={styles.toggle}
            onClick={handleToggleCustom}
            aria-label="Toggle custom voice selection"
          >
            <span className={styles.toggleKnob} />
          </button>
        </div>
      )}

      {customMode && speakers.map((speaker, i) => {
        const selectedVoiceId = voiceMap[speaker];
        const colorIdx = i % SPEAKER_COLORS.length;
        return (
          <div key={speaker} className={styles.speakerSection}>
            <span
              className={styles.speakerLabel}
              style={{ color: SPEAKER_COLORS[colorIdx] }}
            >
              {speaker} Voice
            </span>
            {ttsProvider === 'hume' ? (
              <HumeVoiceBrowser
                selectedVoiceId={selectedVoiceId}
                onSelect={(voiceId) => handleSelectVoice(speaker, voiceId)}
              />
            ) : (
              <>
                {(() => {
                  const providerClones = ttsProvider
                    ? userClones.filter((c) => c.provider === ttsProvider)
                    : userClones;
                  const providerShared = ttsProvider
                    ? sharedVoices.filter((v) => v.provider === ttsProvider)
                    : sharedVoices;
                  return (
                    <>
                      {providerClones.length > 0 && (
                        <>
                          <span className={styles.clonesLabel}>Your Voices</span>
                          <div className={styles.voiceGrid}>
                            {providerClones.map((clone) => (
                              <VoiceCard
                                key={clone.externalVoiceId}
                                voiceId={clone.externalVoiceId}
                                name={clone.name}
                                accent="custom"
                                character="Cloned voice"
                                isSelected={selectedVoiceId === clone.externalVoiceId}
                                onSelect={() => handleSelectVoice(speaker, clone.externalVoiceId)}
                              />
                            ))}
                          </div>
                          <div className={styles.separator} />
                        </>
                      )}
                      {providerShared.length > 0 && (
                        <>
                          <span className={styles.clonesLabel}>Shared With You</span>
                          <div className={styles.voiceGrid}>
                            {providerShared.map((voice) => (
                              <VoiceCard
                                key={voice.externalVoiceId}
                                voiceId={voice.externalVoiceId}
                                name={voice.name}
                                accent="shared"
                                character={`by ${voice.owner.name || 'Unknown'}`}
                                isSelected={selectedVoiceId === voice.externalVoiceId}
                                onSelect={() => handleSelectVoice(speaker, voice.externalVoiceId)}
                              />
                            ))}
                          </div>
                          <div className={styles.separator} />
                        </>
                      )}
                      <div className={styles.voiceGrid}>
                        {poolVoices.map((voice) => (
                          <VoiceCard
                            key={voice.id}
                            voiceId={voice.id}
                            name={voice.name}
                            accent={voice.accent}
                            character={voice.character}
                            isSelected={selectedVoiceId === voice.id}
                            onSelect={() => handleSelectVoice(speaker, voice.id)}
                          />
                        ))}
                      </div>
                    </>
                  );
                })()}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
