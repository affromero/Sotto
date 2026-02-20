'use client';

import { useEffect, useState } from 'react';
import { VoiceCard } from './VoiceCard';
import styles from './VoicePicker.module.css';

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
  createdAt: string;
}

interface SharedVoice extends VoiceClone {
  owner: { id: string; name: string | null };
}

export interface VoiceSelection {
  voices?: Array<{ speaker: string; voiceId: string }>;
  ttsProvider?: string;
}

interface VoicePickerProps {
  onSelectionChange: (selection: VoiceSelection) => void;
  /** Speakers to assign voices to (from discovery metadata). Defaults to Host + Expert. */
  speakers?: Array<{ name: string; description: string }>;
}

const DEFAULT_SPEAKERS = [
  { name: 'Host', description: 'The main host' },
  { name: 'Expert', description: 'The subject expert' },
];

export function VoicePicker({ onSelectionChange, speakers = DEFAULT_SPEAKERS }: VoicePickerProps) {
  const [poolVoices, setPoolVoices] = useState<VoiceProfile[]>([]);
  const [userClones, setUserClones] = useState<VoiceClone[]>([]);
  const [sharedVoices, setSharedVoices] = useState<SharedVoice[]>([]);
  const [customMode, setCustomMode] = useState(false);
  const [voiceMap, setVoiceMap] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/voices');
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
  }, []);

  useEffect(() => {
    if (!customMode) {
      onSelectionChange({});
      return;
    }
    const voices = Object.entries(voiceMap)
      .filter(([, voiceId]) => !!voiceId)
      .map(([speaker, voiceId]) => ({ speaker, voiceId }));
    onSelectionChange({ voices: voices.length > 0 ? voices : undefined });
  }, [customMode, voiceMap, onSelectionChange]);

  function handleToggleCustom() {
    setCustomMode((prev) => !prev);
    if (customMode) {
      setVoiceMap({});
    }
  }

  function handleSelectVoice(speaker: string, voiceId: string) {
    setVoiceMap((prev) => ({ ...prev, [speaker]: voiceId }));
  }

  const speakerColors = ['var(--color-speaker-0)', 'var(--color-speaker-1)', 'var(--color-speaker-2)', 'var(--color-speaker-3)'];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>Voice Selection</h3>
        <p className={styles.subtitle}>
          Choose voices for your podcast or let Sotto auto-assign them.
        </p>
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
              Complementary AI voices will be selected automatically.
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
        const selectedVoiceId = voiceMap[speaker.name];
        const colorIdx = i % 4;
        return (
          <div key={speaker.name} className={styles.roleSection} data-speaker-index={colorIdx}>
            <span className={styles.roleLabel} style={{ color: speakerColors[colorIdx] }}>
              {speaker.name} Voice
            </span>
            {userClones.length > 0 && (
              <>
                <span className={styles.clonesLabel}>Your Voices</span>
                <div className={styles.voiceGrid}>
                  {userClones.map((clone) => (
                    <VoiceCard
                      key={clone.externalVoiceId}
                      voiceId={clone.externalVoiceId}
                      name={clone.name}
                      accent="custom"
                      character="Cloned voice"
                      isSelected={selectedVoiceId === clone.externalVoiceId}
                      onSelect={() => handleSelectVoice(speaker.name, clone.externalVoiceId)}
                    />
                  ))}
                </div>
                <div className={styles.separator} />
              </>
            )}
            {sharedVoices.length > 0 && (
              <>
                <span className={styles.clonesLabel}>Shared With You</span>
                <div className={styles.voiceGrid}>
                  {sharedVoices.map((voice) => (
                    <VoiceCard
                      key={voice.externalVoiceId}
                      voiceId={voice.externalVoiceId}
                      name={voice.name}
                      accent="shared"
                      character={`by ${voice.owner.name || 'Unknown'}`}
                      isSelected={selectedVoiceId === voice.externalVoiceId}
                      onSelect={() => handleSelectVoice(speaker.name, voice.externalVoiceId)}
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
                  onSelect={() => handleSelectVoice(speaker.name, voice.id)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
