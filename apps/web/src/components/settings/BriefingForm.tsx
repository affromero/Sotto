'use client';

import { useState, useEffect } from 'react';
import { LANGUAGE_DISPLAY } from '@sotto/shared';
import styles from './BriefingSettings.module.css';

export const DEPTH_OPTIONS = [
  { value: 'eli5', label: 'ELI5' },
  { value: 'quick_overview', label: 'Quick Overview' },
  { value: 'standard', label: 'Standard' },
  { value: 'deep_dive', label: 'Deep Dive' },
];

export const TONE_OPTIONS = [
  { value: 'casual', label: 'Casual' },
  { value: 'professional', label: 'Professional' },
  { value: 'socratic', label: 'Socratic' },
  { value: 'comedic', label: 'Comedic' },
  { value: 'satirical', label: 'Satirical' },
  { value: 'storytelling', label: 'Storytelling' },
];

export const AUDIENCE_OPTIONS = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'expert', label: 'Expert' },
];

export const DURATION_OPTIONS = [
  { value: 3, label: '3 min' },
  { value: 6, label: '6 min' },
  { value: 10, label: '10 min' },
  { value: 15, label: '15 min' },
  { value: 20, label: '20 min' },
  { value: 30, label: '30 min' },
];

export const FORMAT_OPTIONS = [
  { value: 1, label: 'Solo (Monologue)' },
  { value: 2, label: 'Dialogue (2 voices)' },
  { value: 3, label: 'Panel (3 voices)' },
  { value: 4, label: 'Roundtable (4 voices)' },
];

export const LANGUAGE_MODE_OPTIONS = [
  { value: 'vocabulary_intro', label: 'Vocabulary intro (mostly English)' },
  { value: 'conversational_mix', label: 'Conversational mix' },
  { value: 'full_immersion', label: 'Full immersion' },
];

interface VoiceOption {
  id: string;
  name: string;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface BriefingFormData {
  name: string;
  time: string;
  timezone: string;
  days: number;
  prompt: string | null;
  depth: string | null;
  tone: string | null;
  audienceLevel: string | null;
  duration: number | null;
  format: number;
  aiModel: string | null;
  ttsProvider: string | null;
  ttsModel: string | null;
  hostVoiceId: string | null;
  expertVoiceId: string | null;
  continuousLearning: boolean;
  contextEpisodes: number;
  visibility: string;
  useByokKeys: boolean;
  targetLanguage: string | null;
  languageMode: string | null;
}

interface BriefingFormProps {
  mode: 'create' | 'edit';
  briefingId?: string;
  initial?: Partial<BriefingFormData>;
  hasByokKeys: boolean;
  aiModelOptions: Array<{ id: string; displayName: string; tier: string; group?: string }>;
  ttsOptions: Array<{ id: string; displayName: string; badge?: string; group?: string }>;
  onSaved?: () => void;
  onCancel?: () => void;
}

/** Group items by their `group` field and render <optgroup> elements. */
function renderGroupedOptions<T extends { id: string; group?: string }>(
  items: T[],
  renderLabel: (item: T) => string,
) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = item.group ?? '';
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return Array.from(groups.entries()).map(([group, groupItems]) =>
    group ? (
      <optgroup key={group} label={group}>
        {groupItems.map((item) => (
          <option key={item.id} value={item.id}>{renderLabel(item)}</option>
        ))}
      </optgroup>
    ) : (
      groupItems.map((item) => (
        <option key={item.id} value={item.id}>{renderLabel(item)}</option>
      ))
    ),
  );
}

function patchBriefing(id: string, data: Record<string, unknown>) {
  return fetch(`/api/briefings/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function BriefingForm({
  mode,
  briefingId,
  initial,
  hasByokKeys,
  aiModelOptions,
  ttsOptions,
  onSaved,
  onCancel,
}: BriefingFormProps) {
  const defaultTz = typeof window !== 'undefined'
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : 'America/New_York';

  const [name, setName] = useState(initial?.name ?? '');
  const [time, setTime] = useState(initial?.time ?? '08:00');
  const [timezone] = useState(initial?.timezone ?? defaultTz);
  const [days, setDays] = useState(initial?.days ?? 127);
  const [visibility, setVisibility] = useState(initial?.visibility ?? 'PRIVATE');
  const [aiModel, setAiModel] = useState(initial?.aiModel ?? '');
  const [ttsOption, setTtsOption] = useState(
    initial?.ttsProvider && initial?.ttsModel
      ? `${initial.ttsProvider}:${initial.ttsModel}`
      : initial?.ttsProvider ?? '',
  );
  const [hostVoice, setHostVoice] = useState(initial?.hostVoiceId ?? '');
  const [expertVoice, setExpertVoice] = useState(initial?.expertVoiceId ?? '');
  const [depth, setDepth] = useState(initial?.depth ?? '');
  const [tone, setTone] = useState(initial?.tone ?? '');
  const [audienceLevel, setAudienceLevel] = useState(initial?.audienceLevel ?? '');
  const [duration, setDuration] = useState(initial?.duration?.toString() ?? '');
  const [format, setFormat] = useState(initial?.format ?? 2);
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  const [continuousLearning, setContinuousLearning] = useState(initial?.continuousLearning ?? false);
  const [contextEpisodes, setContextEpisodes] = useState(initial?.contextEpisodes ?? 3);
  const [useByokKeys, setUseByokKeys] = useState(initial?.useByokKeys ?? false);
  const [targetLanguage, setTargetLanguage] = useState(initial?.targetLanguage ?? '');
  const [languageMode, setLanguageMode] = useState(initial?.languageMode ?? 'conversational_mix');

  const [voiceOptions, setVoiceOptions] = useState<VoiceOption[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    const provider = ttsOption ? ttsOption.split(':')[0] : null;
    if (!provider) {
      setVoiceOptions([]);
      return;
    }
    let cancelled = false;
    setVoicesLoading(true);
    fetch(`/api/voices?provider=${encodeURIComponent(provider)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const voices: VoiceOption[] = (data?.poolVoices ?? []).map((v: { id: string; name: string }) => ({
          id: v.id,
          name: v.name,
        }));
        setVoiceOptions(voices);
      })
      .catch(() => {
        if (!cancelled) setVoiceOptions([]);
      })
      .finally(() => {
        if (!cancelled) setVoicesLoading(false);
      });
    return () => { cancelled = true; };
  }, [ttsOption]);

  // Debounce prompt saves in edit mode
  const [promptTimer, setPromptTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (promptTimer) clearTimeout(promptTimer);
    };
  }, [promptTimer]);

  const handlePromptChange = (value: string) => {
    setPrompt(value);
    if (mode === 'edit' && briefingId) {
      if (promptTimer) clearTimeout(promptTimer);
      const timer = setTimeout(() => {
        patchBriefing(briefingId, { prompt: value || null });
      }, 800);
      setPromptTimer(timer);
    }
  };

  const autoSave = (data: Record<string, unknown>) => {
    if (mode === 'edit' && briefingId) {
      patchBriefing(briefingId, data);
    }
  };

  const buildPayload = (): Record<string, unknown> => {
    const ttsProvider = ttsOption ? ttsOption.split(':')[0] : null;
    const ttsModel = ttsOption ? ttsOption.split(':').slice(1).join(':') || null : null;
    return {
      name,
      time,
      timezone,
      days,
      prompt: prompt || null,
      depth: depth || null,
      tone: tone || null,
      audienceLevel: audienceLevel || null,
      duration: duration ? parseInt(duration, 10) : null,
      format,
      aiModel: aiModel || null,
      ttsProvider,
      ttsModel,
      hostVoiceId: hostVoice || null,
      expertVoiceId: expertVoice || null,
      continuousLearning,
      contextEpisodes,
      visibility,
      useByokKeys,
      targetLanguage: targetLanguage || null,
      languageMode: targetLanguage && targetLanguage !== 'en' ? languageMode : null,
    };
  };

  const handleCreate = async (generateNow: boolean) => {
    if (!name.trim() || !time) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/briefings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setCreateError(typeof data?.error === 'string' ? data.error : 'Failed to create briefing.');
        return;
      }
      const created = await res.json();

      if (generateNow && created.id) {
        const genRes = await fetch(`/api/briefings/${created.id}/generate`, { method: 'POST' });
        if (genRes.ok) {
          const { podcastId } = await genRes.json();
          if (podcastId) {
            window.location.href = `/podcast/${podcastId}`;
            return;
          }
        } else {
          const genData = await genRes.json().catch(() => null);
          // Briefing was created but generate failed — still save, show error inline
          setCreateError(typeof genData?.error === 'string' ? genData.error : 'Briefing saved, but generation failed. You can retry from the card.');
          onSaved?.();
          return;
        }
      }
      onSaved?.();
    } catch {
      setCreateError('Network error. Check your connection and try again.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className={styles.customizeSection}>
      {/* Name (create mode) or hidden (edit mode — name shown in card header) */}
      {mode === 'create' && (
        <div className={styles.group} role="group" aria-labelledby="briefing-name">
          <div className={styles.field}>
            <label className={styles.label}>
              Briefing Name <span className={styles.required}>*</span>
            </label>
            <input
              type="text"
              className={styles.timeInput}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Morning Tech News"
              maxLength={100}
              aria-label="Briefing name"
              aria-required="true"
              autoFocus
            />
          </div>
        </div>
      )}

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
              onChange={(e) => {
                const val = e.target.value;
                setTime(val);
                autoSave({ time: val });
              }}
              aria-label="Briefing delivery time"
            />
            <span className={styles.timezoneHint}>{timezone}</span>
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
                    aria-pressed={(days & bit) !== 0}
                    onClick={() => {
                      const newDays = days ^ bit;
                      setDays(newDays);
                      autoSave({ days: newDays });
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
          <label className={styles.label}>
            Custom Instructions <span className={styles.required}>*</span>
          </label>
          <textarea
            className={`${styles.textarea}${!prompt.trim() ? ` ${styles.textareaEmpty}` : ''}`}
            value={prompt}
            onChange={(e) => handlePromptChange(e.target.value)}
            placeholder="Required — e.g. Focus on AI research breakthroughs, TypeScript ecosystem updates, and startup funding rounds. Skip sports and celebrity news."
            maxLength={2000}
            aria-label="Briefing custom instructions"
            aria-required="true"
          />
          {!prompt.trim() && (
            <span className={styles.hint}>Tell us what topics matter to you. Without this, briefings cover random stories.</span>
          )}
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
              onChange={(e) => {
                const val = e.target.value;
                setDepth(val);
                autoSave({ depth: val || null });
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
              onChange={(e) => {
                const val = e.target.value;
                setTone(val);
                autoSave({ tone: val || null });
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
              onChange={(e) => {
                const val = e.target.value;
                setAudienceLevel(val);
                autoSave({ audienceLevel: val || null });
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
              onChange={(e) => {
                const val = e.target.value;
                setDuration(val);
                autoSave({ duration: val ? parseInt(val, 10) : null });
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
        <div className={styles.field}>
          <label className={styles.label}>Format</label>
          <select
            className={styles.select}
            value={String(format)}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              setFormat(val);
              autoSave({ format: val });
            }}
            aria-label="Briefing format"
          >
            {FORMAT_OPTIONS.map((o) => (
              <option key={o.value} value={String(o.value)}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label className={styles.label}>Language</label>
            <select
              className={styles.select}
              value={targetLanguage}
              onChange={(e) => {
                const val = e.target.value;
                setTargetLanguage(val);
                autoSave({ targetLanguage: val || null });
              }}
              aria-label="Briefing language"
            >
              <option value="">Auto (English)</option>
              {Object.entries(LANGUAGE_DISPLAY).map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
          </div>
          {targetLanguage && targetLanguage !== 'en' && (
            <div className={styles.field}>
              <label className={styles.label}>Language Mode</label>
              <select
                className={styles.select}
                value={languageMode}
                onChange={(e) => {
                  const val = e.target.value;
                  setLanguageMode(val);
                  autoSave({ languageMode: val });
                }}
                aria-label="Language learning mode"
              >
                {LANGUAGE_MODE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Continuous Learning */}
      <div className={styles.group} role="group" aria-labelledby="briefing-learning">
        <h3 className={styles.groupTitle} id="briefing-learning">Continuous Learning</h3>
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={continuousLearning}
            onChange={(e) => {
              const checked = e.target.checked;
              setContinuousLearning(checked);
              autoSave({ continuousLearning: checked });
            }}
            aria-label="Build on previous episodes"
          />
          <span className={styles.checkboxLabel}>Build on previous episodes</span>
        </label>
        <p className={styles.hint}>
          Each episode picks up where the last one left off, creating a progressive learning experience.
        </p>
        {continuousLearning && (
          <div className={styles.field}>
            <label className={styles.label}>
              Episodes to build on: <strong>{contextEpisodes}</strong>
            </label>
            <input
              type="range"
              className={styles.rangeInput}
              min={1}
              max={5}
              step={1}
              value={contextEpisodes}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                setContextEpisodes(val);
                autoSave({ contextEpisodes: val });
              }}
              aria-label="Number of previous episodes to include as context"
            />
            <div className={styles.rangeLabels}>
              <span>1</span>
              <span>2</span>
              <span>3</span>
              <span>4</span>
              <span>5</span>
            </div>
          </div>
        )}
      </div>

      {/* Audio */}
      <div className={styles.group} role="group" aria-labelledby="briefing-audio">
        <h3 className={styles.groupTitle} id="briefing-audio">Audio</h3>
        <div className={styles.field}>
          <label className={styles.label}>AI Model</label>
          <select
            className={styles.select}
            value={aiModel}
            onChange={(e) => {
              const val = e.target.value;
              setAiModel(val);
              autoSave({ aiModel: val || null });
            }}
            aria-label="Briefing AI model"
          >
            <option value="">Use my default model</option>
            {renderGroupedOptions(aiModelOptions, (m) => m.displayName)}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Voice Provider</label>
          <select
            className={styles.select}
            value={ttsOption}
            onChange={(e) => {
              const val = e.target.value;
              setTtsOption(val);
              setHostVoice('');
              setExpertVoice('');
              if (val) {
                const [provider, ...modelParts] = val.split(':');
                const model = modelParts.join(':');
                autoSave({ ttsProvider: provider, ttsModel: model || null, hostVoiceId: null, expertVoiceId: null });
              } else {
                autoSave({ ttsProvider: null, ttsModel: null, hostVoiceId: null, expertVoiceId: null });
              }
            }}
            aria-label="Briefing voice provider"
          >
            <option value="">Use my default provider</option>
            {renderGroupedOptions(ttsOptions, (o) => `${o.displayName}${o.badge ? ` (${o.badge})` : ''}`)}
          </select>
        </div>
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label className={styles.label}>Host Voice</label>
            <select
              className={styles.select}
              value={hostVoice}
              onChange={(e) => {
                const val = e.target.value;
                setHostVoice(val);
                autoSave({ hostVoiceId: val || null });
              }}
              disabled={voicesLoading || voiceOptions.length === 0}
              aria-label="Briefing host voice"
            >
              <option value="">Auto-assign</option>
              {voiceOptions.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Expert Voice</label>
            <select
              className={styles.select}
              value={expertVoice}
              onChange={(e) => {
                const val = e.target.value;
                setExpertVoice(val);
                autoSave({ expertVoiceId: val || null });
              }}
              disabled={voicesLoading || voiceOptions.length === 0}
              aria-label="Briefing expert voice"
            >
              <option value="">Auto-assign</option>
              {voiceOptions.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
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
            onChange={(e) => {
              const val = e.target.value;
              setVisibility(val);
              autoSave({ visibility: val });
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
              onChange={(e) => {
                const checked = e.target.checked;
                setUseByokKeys(checked);
                autoSave({ useByokKeys: checked });
              }}
              aria-label="Use my own API keys for briefings"
            />
            <span className={styles.checkboxLabel}>Use my own API keys for briefings</span>
          </label>
        )}
      </div>

      {/* Error display */}
      {createError && (
        <div className={styles.hint} style={{ color: 'var(--color-error, #ef4444)' }}>
          {createError}
        </div>
      )}

      {/* Actions (create mode only) */}
      {mode === 'create' && (
        <div className={styles.fieldRow}>
          <button
            type="button"
            className={styles.dayChip}
            data-active
            onClick={() => handleCreate(true)}
            disabled={creating || !name.trim()}
            aria-label="Generate now and schedule"
          >
            {creating ? 'Creating...' : 'Generate now & schedule'}
          </button>
          <button
            type="button"
            className={styles.dayChip}
            onClick={() => handleCreate(false)}
            disabled={creating || !name.trim()}
            aria-label="Just schedule"
          >
            Just schedule
          </button>
          {onCancel && (
            <button
              type="button"
              className={styles.dayChip}
              onClick={onCancel}
              aria-label="Cancel"
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}
