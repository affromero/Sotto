'use client';

import { useId } from 'react';
import { VOCABULARY_SUPPORT_OPTIONS, type VocabularySupport } from '@sotto/shared';
import styles from './VocabularySupportPicker.module.css';

interface Props {
  value: VocabularySupport | null;
  onChange: (value: VocabularySupport | null) => void;
  disabled?: boolean;
}

export function VocabularySupportPicker({ value, onChange, disabled = false }: Props) {
  const id = useId();
  return (
    <fieldset className={styles.root} disabled={disabled} aria-describedby={`${id}-help`}>
      <legend className={styles.legend}>What makes vocabulary difficult right now?</legend>
      <p className={styles.help} id={`${id}-help`}>
        Choose what you would like help with most. This guides future lessons and practice. You can
        change it in your course settings.
      </p>
      {VOCABULARY_SUPPORT_OPTIONS.map((option) => (
        <label key={option.value} className={styles.option}>
          <input
            type="radio"
            name={id}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
      <label className={styles.option}>
        <input
          type="radio"
          name={id}
          value="unsure"
          checked={value === null}
          onChange={() => onChange(null)}
        />
        <span>I’m not sure yet.</span>
      </label>
    </fieldset>
  );
}
