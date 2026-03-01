'use client';

import { useEffect, useRef, useState } from 'react';
import { VoiceCard } from './VoiceCard';
import { HumeVoiceBrowser } from './HumeVoiceBrowser';
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
  provider: string;
  createdAt: string;
}

interface SharedVoice extends VoiceClone {
  owner: { id: string; name: string | null };
}

export interface VoiceSelection {
  voices?: Array<{ speaker: string; voiceId: string }>;
  ttsProvider?: string;
  speakers?: Array<{ name: string; description: string }>;
}

interface VoicePickerProps {
  onSelectionChange: (selection: VoiceSelection) => void;
  /** Speakers to assign voices to (from discovery metadata). Defaults to Host + Expert. */
  speakers?: Array<{ name: string; description: string }>;
  /** Maximum speakers allowed by the user's tier (2 = FREE, 4 = PRO). */
  maxSpeakers?: number;
  /** Currently selected TTS provider (e.g. 'hume'). When set, shows provider-specific voice browser. */
  ttsProvider?: string;
}

// Speaker presets use UPPERCASE names to match TTS provider convention.
// Display labels are capitalized via CSS text-transform.
const SPEAKER_PRESETS: Record<number, Array<{ name: string; description: string }>> = {
  1: [
    { name: 'HOST', description: 'Warm, engaging narrator who guides the listener through the topic with energy and clarity. Speaks in first person, uses rhetorical questions, personal anecdotes, and vivid storytelling.' },
  ],
  2: [
    { name: 'HOST', description: 'Warm, curious, asks great questions, guides the conversation. Represents the listener. Reacts naturally — laughs, expresses surprise, interjects.' },
    { name: 'EXPERT', description: 'Knowledgeable, vivid storyteller, uses analogies, examples, and occasionally humor. Explains complex topics in ways that create "aha" moments.' },
  ],
  3: [
    { name: 'HOST', description: 'Warm, curious moderator who keeps the conversation flowing and asks clarifying questions.' },
    { name: 'EXPERT', description: 'Deep domain knowledge, explains concepts clearly, backs claims with evidence and examples.' },
    { name: 'GUEST', description: "Brings a fresh, opinionated real-world perspective that challenges or extends the Expert's view." },
  ],
  4: [
    { name: 'HOST', description: 'Warm moderator who guides the discussion and ensures all voices are heard.' },
    { name: 'EXPERT', description: 'Knowledgeable, data-driven, explains complex ideas with clarity and precision.' },
    { name: 'GUEST', description: 'Practical real-world experience and a fresh perspective that enriches the discussion.' },
    { name: 'SKEPTIC', description: 'Challenges assumptions, plays devil\'s advocate, asks the tough "but why?" questions.' },
  ],
};

const FORMAT_LABELS: Record<number, string> = {
  1: 'Solo',
  2: 'Dialogue',
  3: 'Panel',
  4: 'Roundtable',
};

export function VoicePicker({ onSelectionChange, maxSpeakers = 2, ttsProvider }: VoicePickerProps) {
  const [poolVoices, setPoolVoices] = useState<VoiceProfile[]>([]);
  const [userClones, setUserClones] = useState<VoiceClone[]>([]);
  const [sharedVoices, setSharedVoices] = useState<SharedVoice[]>([]);
  const [customMode, setCustomMode] = useState(false);
  const [voiceMap, setVoiceMap] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [speakerCount, setSpeakerCount] = useState(Math.min(2, maxSpeakers));

  const activeSpeakers = SPEAKER_PRESETS[speakerCount] ?? SPEAKER_PRESETS[2];
  const prevProviderRef = useRef(ttsProvider);

  // Clear voice selections when TTS provider changes (voice IDs are provider-specific)
  useEffect(() => {
    if (prevProviderRef.current !== ttsProvider) {
      prevProviderRef.current = ttsProvider;
      setVoiceMap({});
    }
  }, [ttsProvider]);

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
      onSelectionChange({ speakers: activeSpeakers });
      return;
    }
    const voices = Object.entries(voiceMap)
      .filter(([, voiceId]) => !!voiceId)
      .map(([speaker, voiceId]) => ({ speaker, voiceId }));
    onSelectionChange({
      voices: voices.length > 0 ? voices : undefined,
      speakers: activeSpeakers,
    });
  }, [customMode, voiceMap, activeSpeakers, onSelectionChange]);

  function handleToggleCustom() {
    setCustomMode((prev) => !prev);
    if (customMode) {
      setVoiceMap({});
    }
  }

  function handleSpeakerCountChange(count: number) {
    if (count > maxSpeakers) return;
    setSpeakerCount(count);
    setVoiceMap({});
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

      <div className={styles.formatRow}>
        <span className={styles.formatLabel}>Format</span>
        <div className={styles.formatPills}>
          {([1, 2, 3, 4] as const).map((count) => {
            const locked = count > maxSpeakers;
            return (
              <span key={count} className={locked ? styles.lockedPillWrapper : undefined}>
                <button
                  type="button"
                  className={`${styles.formatPill} ${speakerCount === count ? styles.formatPillActive : ''} ${locked ? styles.formatPillLocked : ''}`}
                  onClick={() => handleSpeakerCountChange(count)}
                  disabled={locked}
                  aria-label={`${FORMAT_LABELS[count]}${locked ? ' — upgrade to Pro to unlock' : ''}`}
                  aria-pressed={speakerCount === count}
                >
                  {FORMAT_LABELS[count]}
                  {locked && <span className={styles.proBadge}>PRO</span>}
                </button>
                {locked && <span className={styles.lockedTooltip}>Upgrade to Pro to unlock {FORMAT_LABELS[count]} format</span>}
              </span>
            );
          })}
        </div>
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

      {customMode && activeSpeakers.map((speaker, i) => {
        const selectedVoiceId = voiceMap[speaker.name];
        const colorIdx = i % 4;
        return (
          <div key={speaker.name} className={styles.roleSection} data-speaker-index={colorIdx}>
            <span className={styles.roleLabel} style={{ color: speakerColors[colorIdx] }}>
              {speaker.name} Voice
            </span>
            {ttsProvider === 'hume' ? (
              <>
                {userClones.filter((c) => c.provider === 'hume').length > 0 && (
                  <>
                    <span className={styles.clonesLabel}>Your Hume Voices</span>
                    <div className={styles.voiceGrid}>
                      {userClones.filter((c) => c.provider === 'hume').map((clone) => (
                        <VoiceCard
                          key={clone.externalVoiceId}
                          voiceId={clone.externalVoiceId}
                          name={clone.name}
                          accent="imported"
                          character="Hume custom voice"
                          isSelected={selectedVoiceId === clone.externalVoiceId}
                          onSelect={() => handleSelectVoice(speaker.name, clone.externalVoiceId)}
                          provider="hume"
                        />
                      ))}
                    </div>
                    <div className={styles.separator} />
                  </>
                )}
                <HumeVoiceBrowser
                  selectedVoiceId={selectedVoiceId}
                  onSelect={(voiceId) => handleSelectVoice(speaker.name, voiceId)}
                />
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
