'use client';

import styles from './DiscoveryParamsCard.module.css';
import type { DiscoveryMetadata } from '@/types/discovery';

const DEPTH_OPTIONS = ['eli5', 'quick_overview', 'standard', 'deep_dive'] as const;
const AUDIENCE_OPTIONS = ['general', 'kids', 'teens', 'family', 'nerds', 'mature'] as const;
const LEVEL_OPTIONS = ['beginner', 'intermediate', 'expert'] as const;
const TONE_OPTIONS = ['casual', 'professional', 'socratic', 'comedic', 'satirical', 'storytelling'] as const;

const PARAM_LABELS: Record<string, string> = {
  eli5: 'ELI5',
  quick_overview: 'Quick overview',
  standard: 'Standard',
  deep_dive: 'Deep dive',
  general: 'General',
  kids: 'Kids',
  teens: 'Teens',
  family: 'Family',
  nerds: 'Nerds',
  mature: 'Mature',
  beginner: 'Beginner',
  intermediate: 'Some knowledge',
  expert: 'Expert',
  casual: 'Casual',
  professional: 'Professional',
  socratic: 'Socratic',
  comedic: 'Comedic',
  satirical: 'Satirical',
  storytelling: 'Storytelling',
};

interface DiscoveryParamsCardProps {
  metadata: DiscoveryMetadata;
  onUpdate: (patch: Partial<DiscoveryMetadata>) => void;
  disabled?: boolean;
}

interface ParamRowProps {
  label: string;
  options: readonly string[];
  selected: string;
  onSelect: (value: string) => void;
  disabled?: boolean;
  fieldKey: string;
}

function ParamRow({ label, options, selected, onSelect, disabled, fieldKey }: ParamRowProps) {
  return (
    <div className={styles.row} role="group" aria-label={label}>
      <span className={styles.rowLabel}>{label}</span>
      <div className={styles.chips}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={`${styles.chip} ${selected === option ? styles.chipSelected : ''}`}
            onClick={() => onSelect(option)}
            disabled={disabled}
            aria-pressed={selected === option}
            aria-label={`${label}: ${PARAM_LABELS[option] ?? option}`}
            data-field={fieldKey}
          >
            {PARAM_LABELS[option] ?? option}
          </button>
        ))}
      </div>
    </div>
  );
}

export function DiscoveryParamsCard({ metadata, onUpdate, disabled }: DiscoveryParamsCardProps) {
  return (
    <div className={styles.root}>
      <ParamRow
        label="Depth"
        options={DEPTH_OPTIONS}
        selected={metadata.depth}
        onSelect={(value) => onUpdate({ depth: value as DiscoveryMetadata['depth'] })}
        disabled={disabled}
        fieldKey="depth"
      />
      <ParamRow
        label="Audience"
        options={AUDIENCE_OPTIONS}
        selected={metadata.audience}
        onSelect={(value) => onUpdate({ audience: value as DiscoveryMetadata['audience'] })}
        disabled={disabled}
        fieldKey="audience"
      />
      <ParamRow
        label="Level"
        options={LEVEL_OPTIONS}
        selected={metadata.audienceLevel}
        onSelect={(value) => onUpdate({ audienceLevel: value as DiscoveryMetadata['audienceLevel'] })}
        disabled={disabled}
        fieldKey="audienceLevel"
      />
      <ParamRow
        label="Tone"
        options={TONE_OPTIONS}
        selected={metadata.tone}
        onSelect={(value) => onUpdate({ tone: value as DiscoveryMetadata['tone'] })}
        disabled={disabled}
        fieldKey="tone"
      />
    </div>
  );
}
