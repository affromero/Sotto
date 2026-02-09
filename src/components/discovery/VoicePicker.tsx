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

interface VoiceCredits {
  used: number;
  total: number;
  remaining: number;
}

export interface VoiceSelection {
  hostVoiceId?: string;
  expertVoiceId?: string;
  usePremiumVoice: boolean;
}

interface VoicePickerProps {
  onSelectionChange: (selection: VoiceSelection) => void;
}

export function VoicePicker({ onSelectionChange }: VoicePickerProps) {
  const [poolVoices, setPoolVoices] = useState<VoiceProfile[]>([]);
  const [userClones, setUserClones] = useState<VoiceClone[]>([]);
  const [credits, setCredits] = useState<VoiceCredits>({ used: 0, total: 0, remaining: 0 });
  const [usePremium, setUsePremium] = useState(false);
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
          setCredits(data.credits || { used: 0, total: 0, remaining: 0 });
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
      hostVoiceId: usePremium ? hostVoiceId : undefined,
      expertVoiceId: usePremium ? expertVoiceId : undefined,
      usePremiumVoice: usePremium,
    });
  }, [usePremium, hostVoiceId, expertVoiceId, onSelectionChange]);

  function handleTogglePremium() {
    if (credits.remaining <= 0 && !usePremium) return;
    setUsePremium((prev) => !prev);
    if (usePremium) {
      setHostVoiceId(undefined);
      setExpertVoiceId(undefined);
    }
  }

  const hasCredits = credits.remaining > 0;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>Voice Selection</h3>
        <p className={styles.subtitle}>
          Choose voices for your podcast or let Sotto auto-assign them.
        </p>
      </div>

      {!usePremium && (
        <div className={styles.autoAssign}>
          <div className={styles.autoAssignIcon} aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </div>
          <div className={styles.autoAssignText}>
            <span className={styles.autoAssignTitle}>Auto-assign (Standard Voices)</span>
            <span className={styles.autoAssignHint}>
              Two complementary AI voices will be selected automatically. Free with every podcast.
            </span>
          </div>
        </div>
      )}

      {loaded && (
        <div className={styles.toggleRow}>
          <div className={styles.toggleLabel}>
            <span className={styles.toggleTitle}>Use Premium Voices</span>
            <span className={styles.toggleHint}>
              {hasCredits ? (
                <span className={styles.creditCount}>{credits.remaining} credit{credits.remaining !== 1 ? 's' : ''} remaining</span>
              ) : (
                'No credits remaining this month'
              )}
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={usePremium}
            className={`${styles.toggle} ${!hasCredits && !usePremium ? styles.toggleDisabled : ''}`}
            onClick={handleTogglePremium}
            disabled={!hasCredits && !usePremium}
            aria-label="Toggle premium voices"
          >
            <span className={styles.toggleKnob} />
          </button>
        </div>
      )}

      {usePremium && (
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
