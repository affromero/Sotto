'use client';

import { useState, useEffect } from 'react';
import styles from './BriefingSettings.module.css';

const DEPTH_OPTIONS = [
  { value: 'eli5', label: 'ELI5' },
  { value: 'quick_overview', label: 'Quick Overview' },
  { value: 'standard', label: 'Standard' },
  { value: 'deep_dive', label: 'Deep Dive' },
];

const TONE_OPTIONS = [
  { value: 'casual', label: 'Casual' },
  { value: 'professional', label: 'Professional' },
  { value: 'socratic', label: 'Socratic' },
  { value: 'comedic', label: 'Comedic' },
  { value: 'satirical', label: 'Satirical' },
  { value: 'storytelling', label: 'Storytelling' },
];

const AUDIENCE_OPTIONS = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'expert', label: 'Expert' },
];

const DURATION_OPTIONS = [
  { value: 3, label: '3 min' },
  { value: 6, label: '6 min' },
  { value: 10, label: '10 min' },
  { value: 15, label: '15 min' },
  { value: 20, label: '20 min' },
  { value: 30, label: '30 min' },
];

const VOICE_POOL_NAMES = [
  'Adam', 'Eric', 'Brian', 'Will', 'Roger', 'Charlie', 'George', 'Callum',
  'Aria', 'Rachel', 'Jessica', 'Laura', 'Matilda', 'Alice', 'Charlotte', 'Grace',
];

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface BriefingSettingsProps {
  initialTime: string | null;
  initialDays: number;
  initialVisibility: string;
  initialAiModel: string | null;
  initialTtsOption: string | null;
  initialHostVoiceId: string | null;
  initialExpertVoiceId: string | null;
  initialDepth: string | null;
  initialTone: string | null;
  initialAudienceLevel: string | null;
  initialDuration: number | null;
  initialPrompt: string | null;
  initialUseByokKeys: boolean;
  hasByokKeys: boolean;
  aiModelOptions: Array<{ id: string; displayName: string; tier: string; group?: string }>;
  ttsOptions: Array<{ id: string; displayName: string; badge?: string; group?: string }>;
}

function patchUser(data: Record<string, unknown>) {
  return fetch('/api/users/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function BriefingSettings({
  initialTime,
  initialDays,
  initialVisibility,
  initialAiModel,
  initialTtsOption,
  initialHostVoiceId,
  initialExpertVoiceId,
  initialDepth,
  initialTone,
  initialAudienceLevel,
  initialDuration,
  initialPrompt,
  initialUseByokKeys,
  hasByokKeys,
  aiModelOptions,
  ttsOptions,
}: BriefingSettingsProps) {
  const [time, setTime] = useState(initialTime ?? '08:00');
  const [days, setDays] = useState(initialDays);
  const [visibility, setVisibility] = useState(initialVisibility);
  const [aiModel, setAiModel] = useState(initialAiModel ?? '');
  const [ttsOption, setTtsOption] = useState(initialTtsOption ?? '');
  const [hostVoice, setHostVoice] = useState(initialHostVoiceId ?? '');
  const [expertVoice, setExpertVoice] = useState(initialExpertVoiceId ?? '');
  const [depth, setDepth] = useState(initialDepth ?? '');
  const [tone, setTone] = useState(initialTone ?? '');
  const [audienceLevel, setAudienceLevel] = useState(initialAudienceLevel ?? '');
  const [duration, setDuration] = useState(initialDuration?.toString() ?? '');
  const [prompt, setPrompt] = useState(initialPrompt ?? '');
  const [useByokKeys, setUseByokKeys] = useState(initialUseByokKeys);

  // Debounce prompt saves
  const [promptTimer, setPromptTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (promptTimer) clearTimeout(promptTimer);
    };
  }, [promptTimer]);

  const handlePromptChange = (value: string) => {
    setPrompt(value);
    if (promptTimer) clearTimeout(promptTimer);
    const timer = setTimeout(() => {
      patchUser({ briefingPrompt: value || null });
    }, 800);
    setPromptTimer(timer);
  };

  return (
    <div className={styles.customizeSection}>
      {/* Schedule */}
      <div className={styles.group} role="group" aria-labelledby="briefing-schedule">
        <h3 className={styles.groupTitle} id="briefing-schedule">Schedule</h3>
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label className={styles.label}>Delivery Time</label>
            <input
              type="time"
              className={styles.timeInput}
              value={time}
              onChange={async (e) => {
                const val = e.target.value;
                setTime(val);
                await patchUser({ briefingTime: val });
              }}
              aria-label="Briefing delivery time"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Days</label>
            <div className={styles.dayChips}>
              {DAY_LABELS.map((day, i) => {
                const bit = i === 6 ? 64 : (1 << i);
                return (
                  <button
                    key={day}
                    type="button"
                    className={styles.dayChip}
                    data-active={(days & bit) !== 0 || undefined}
                    onClick={async () => {
                      const newDays = days ^ bit;
                      setDays(newDays);
                      await patchUser({ briefingDays: newDays });
                    }}
                    aria-label={`Toggle ${day}`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className={styles.group} role="group" aria-labelledby="briefing-content">
        <h3 className={styles.groupTitle} id="briefing-content">Content</h3>
        <div className={styles.field}>
          <label className={styles.label}>Custom Instructions</label>
          <textarea
            className={styles.textarea}
            value={prompt}
            onChange={(e) => handlePromptChange(e.target.value)}
            placeholder="e.g. Focus on AI research and TypeScript ecosystem news"
            maxLength={2000}
            aria-label="Briefing custom instructions"
          />
          {prompt.length > 0 && (
            <span className={styles.charCount}>{prompt.length}/2000</span>
          )}
        </div>
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label className={styles.label}>Depth</label>
            <select
              className={styles.select}
              value={depth}
              onChange={async (e) => {
                const val = e.target.value;
                setDepth(val);
                await patchUser({ briefingDepth: val || null });
              }}
              aria-label="Briefing depth"
            >
              <option value="">Default (Quick Overview)</option>
              {DEPTH_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Tone</label>
            <select
              className={styles.select}
              value={tone}
              onChange={async (e) => {
                const val = e.target.value;
                setTone(val);
                await patchUser({ briefingTone: val || null });
              }}
              aria-label="Briefing tone"
            >
              <option value="">Default (Casual)</option>
              {TONE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label className={styles.label}>Audience Level</label>
            <select
              className={styles.select}
              value={audienceLevel}
              onChange={async (e) => {
                const val = e.target.value;
                setAudienceLevel(val);
                await patchUser({ briefingAudienceLevel: val || null });
              }}
              aria-label="Briefing audience level"
            >
              <option value="">Default (Intermediate)</option>
              {AUDIENCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Duration</label>
            <select
              className={styles.select}
              value={duration}
              onChange={async (e) => {
                const val = e.target.value;
                setDuration(val);
                await patchUser({ briefingDuration: val ? parseInt(val, 10) : null });
              }}
              aria-label="Briefing duration"
            >
              <option value="">Default (6 min)</option>
              {DURATION_OPTIONS.map((o) => (
                <option key={o.value} value={String(o.value)}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Audio */}
      <div className={styles.group} role="group" aria-labelledby="briefing-audio">
        <h3 className={styles.groupTitle} id="briefing-audio">Audio</h3>
        <div className={styles.field}>
          <label className={styles.label}>AI Model</label>
          <select
            className={styles.select}
            value={aiModel}
            onChange={async (e) => {
              const val = e.target.value;
              setAiModel(val);
              await patchUser({ briefingAiModel: val || null });
            }}
            aria-label="Briefing AI model"
          >
            <option value="">Use my default model</option>
            {aiModelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}{m.tier === 'pro' ? ' (Pro)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Voice Provider</label>
          <select
            className={styles.select}
            value={ttsOption}
            onChange={async (e) => {
              const val = e.target.value;
              setTtsOption(val);
              if (val) {
                const [provider, ...modelParts] = val.split(':');
                const model = modelParts.join(':');
                await patchUser({ briefingTtsProvider: provider, briefingTtsModel: model || null });
              } else {
                await patchUser({ briefingTtsProvider: null, briefingTtsModel: null });
              }
            }}
            aria-label="Briefing voice provider"
          >
            <option value="">Use my default provider</option>
            {ttsOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.displayName}{o.badge ? ` (${o.badge})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label className={styles.label}>Host Voice</label>
            <select
              className={styles.select}
              value={hostVoice}
              onChange={async (e) => {
                const val = e.target.value;
                setHostVoice(val);
                await patchUser({ briefingHostVoiceId: val || null });
              }}
              aria-label="Briefing host voice"
            >
              <option value="">Auto-assign</option>
              {VOICE_POOL_NAMES.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Expert Voice</label>
            <select
              className={styles.select}
              value={expertVoice}
              onChange={async (e) => {
                const val = e.target.value;
                setExpertVoice(val);
                await patchUser({ briefingExpertVoiceId: val || null });
              }}
              aria-label="Briefing expert voice"
            >
              <option value="">Auto-assign</option>
              {VOICE_POOL_NAMES.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Advanced */}
      <div className={styles.group} role="group" aria-labelledby="briefing-advanced">
        <h3 className={styles.groupTitle} id="briefing-advanced">Advanced</h3>
        <div className={styles.field}>
          <label className={styles.label}>Visibility</label>
          <select
            className={styles.select}
            value={visibility}
            onChange={async (e) => {
              const val = e.target.value;
              setVisibility(val);
              await patchUser({ briefingVisibility: val });
            }}
            aria-label="Briefing visibility"
          >
            <option value="PRIVATE">Private</option>
            <option value="UNLISTED">Unlisted</option>
            <option value="PUBLIC">Public</option>
          </select>
        </div>
        {hasByokKeys && (
          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={useByokKeys}
              onChange={async (e) => {
                const checked = e.target.checked;
                setUseByokKeys(checked);
                await patchUser({ briefingUseByokKeys: checked });
              }}
              aria-label="Use my own API keys for briefings"
            />
            <span className={styles.checkboxLabel}>Use my own API keys for briefings</span>
          </label>
        )}
      </div>
    </div>
  );
}
