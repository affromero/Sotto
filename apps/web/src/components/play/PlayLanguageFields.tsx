'use client';

import { useId } from 'react';
import {
  LANGUAGE_DISPLAY,
  PLAY_CARD_LANGUAGES,
  playLevelSchema,
  playSettingsSchema,
  type PlaySettings,
} from '@sotto/shared';
import styles from './PlayLanguageFields.module.css';

export function validPlaySettings(settings: PlaySettings, cards: boolean) {
  return (
    playSettingsSchema.safeParse(settings).success &&
    (!cards || PLAY_CARD_LANGUAGES.some((code) => code === settings.targetLang))
  );
}

export function PlayLanguageFields({
  value,
  onChange,
  cards = false,
  disabled = false,
}: {
  value: PlaySettings;
  onChange: (settings: PlaySettings) => void;
  cards?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const same = value.nativeLang === value.targetLang;
  const unavailable = cards && !PLAY_CARD_LANGUAGES.some((code) => code === value.targetLang);
  const languages = Object.entries(LANGUAGE_DISPLAY);
  return (
    <fieldset className={styles.root} disabled={disabled}>
      <legend>Your language turn</legend>
      <div className={styles.fields}>
        <label htmlFor={`${id}-target`}>
          Language to practice
          <select
            id={`${id}-target`}
            value={value.targetLang}
            aria-invalid={same || unavailable}
            aria-describedby={same || unavailable ? `${id}-error` : undefined}
            onChange={(event) => onChange({ ...value, targetLang: event.target.value })}
          >
            {languages.map(([code, label]) => (
              <option
                key={code}
                value={code}
                disabled={cards && !PLAY_CARD_LANGUAGES.some((supported) => supported === code)}
              >
                {label}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-support`}>
          Language for meanings
          <select
            id={`${id}-support`}
            value={value.nativeLang}
            onChange={(event) => onChange({ ...value, nativeLang: event.target.value })}
          >
            {languages.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-level`}>
          Your comfort level
          <select
            id={`${id}-level`}
            value={value.level}
            onChange={(event) =>
              onChange({ ...value, level: playLevelSchema.parse(event.target.value) })
            }
          >
            {playLevelSchema.options.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
      </div>
      {(same || unavailable) && (
        <p id={`${id}-error`} className={styles.error} role="alert">
          {same
            ? 'Choose two different languages.'
            : 'Choose a supported card language, or play Describe or Mission with your own words.'}
        </p>
      )}
      <p className={styles.note}>
        Your partner chooses their own language and level. You swap turns.
      </p>
    </fieldset>
  );
}
