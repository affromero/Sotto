'use client';

import { MAP_PRESETS, PRESET_IDS } from '@sotto/maps';
import type { MapPresetId } from '@sotto/maps';
import styles from './PresetPicker.module.css';

interface PresetPickerProps {
  value: MapPresetId;
  onChange: (preset: MapPresetId) => void;
}

export function PresetPicker({ value, onChange }: PresetPickerProps) {
  return (
    <div className={styles.root} role="radiogroup" aria-label="Map style preset">
      {PRESET_IDS.map((id) => {
        const preset = MAP_PRESETS[id];
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={value === id}
            className={`${styles.chip} ${value === id ? styles.active : ''}`}
            onClick={() => onChange(id)}
            title={preset.description}
          >
            {preset.name}
          </button>
        );
      })}
    </div>
  );
}
