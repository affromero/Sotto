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
  elevenLabsVoiceId: string;
  sourceType: string;
  createdAt: string;
}

interface SharedVoice extends VoiceClone {
  owner: { id: string; name: string | null };
}

export interface VoiceSelection {
  hostVoiceId?: string;
  expertVoiceId?: string;
  ttsProvider?: string;
}

interface VoicePickerProps {
  onSelectionChange: (selection: VoiceSelection) => void;
}

export function VoicePicker({ onSelectionChange }: VoicePickerProps) {
  const [poolVoices, setPoolVoices] = useState<VoiceProfile[]>([]);
  const [userClones, setUserClones] = useState<VoiceClone[]>([]);
  const [sharedVoices, setSharedVoices] = useState<SharedVoice[]>([]);
  const [customMode, setCustomMode] = useState(false);
  const [hostVoiceId, setHostVoiceId] = useState<string | undefined>();
  const [expertVoiceId, setExpertVoiceId] = useState<string | undefined>();
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
    onSelectionChange({
      hostVoiceId: customMode ? hostVoiceId : undefined,
      expertVoiceId: customMode ? expertVoiceId : undefined,
    });
  }, [customMode, hostVoiceId, expertVoiceId, onSelectionChange]);

  function handleToggleCustom() {
    setCustomMode((prev) => !prev);
    if (customMode) {
      setHostVoiceId(undefined);
      setExpertVoiceId(undefined);
    }
  }

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
              Two complementary AI voices will be selected automatically.
            </span>
          </div>
        </div>
      )}

      {loaded && (
        <div className={styles.toggleRow}>
          <div className={styles.toggleLabel}>
            <span className={styles.toggleTitle}>Choose Custom Voices</span>
            <span className={styles.toggleHint}>
              Pick specific voices for host and expert
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

      {customMode && (
        <>
          <div className={`${styles.roleSection} ${styles.roleHost}`}>
            <span className={styles.roleLabel}>Host Voice</span>
            {userClones.length > 0 && (
              <>
                <span className={styles.clonesLabel}>Your Voices</span>
                <div className={styles.voiceGrid}>
                  {userClones.map((clone) => (
                    <VoiceCard
                      key={clone.elevenLabsVoiceId}
                      voiceId={clone.elevenLabsVoiceId}
                      name={clone.name}
                      accent="custom"
                      character="Cloned voice"
                      isSelected={hostVoiceId === clone.elevenLabsVoiceId}
                      onSelect={() => setHostVoiceId(clone.elevenLabsVoiceId)}
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
                      key={voice.elevenLabsVoiceId}
                      voiceId={voice.elevenLabsVoiceId}
                      name={voice.name}
                      accent="shared"
                      character={`by ${voice.owner.name || 'Unknown'}`}
                      isSelected={hostVoiceId === voice.elevenLabsVoiceId}
                      onSelect={() => setHostVoiceId(voice.elevenLabsVoiceId)}
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
                  isSelected={hostVoiceId === voice.id}
                  onSelect={() => setHostVoiceId(voice.id)}
                />
              ))}
            </div>
          </div>

          <div className={`${styles.roleSection} ${styles.roleExpert}`}>
            <span className={styles.roleLabel}>Expert Voice</span>
            {userClones.length > 0 && (
              <>
                <span className={styles.clonesLabel}>Your Voices</span>
                <div className={styles.voiceGrid}>
                  {userClones.map((clone) => (
                    <VoiceCard
                      key={clone.elevenLabsVoiceId}
                      voiceId={clone.elevenLabsVoiceId}
                      name={clone.name}
                      accent="custom"
                      character="Cloned voice"
                      isSelected={expertVoiceId === clone.elevenLabsVoiceId}
                      onSelect={() => setExpertVoiceId(clone.elevenLabsVoiceId)}
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
                      key={voice.elevenLabsVoiceId}
                      voiceId={voice.elevenLabsVoiceId}
                      name={voice.name}
                      accent="shared"
                      character={`by ${voice.owner.name || 'Unknown'}`}
                      isSelected={expertVoiceId === voice.elevenLabsVoiceId}
                      onSelect={() => setExpertVoiceId(voice.elevenLabsVoiceId)}
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
                  isSelected={expertVoiceId === voice.id}
                  onSelect={() => setExpertVoiceId(voice.id)}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
