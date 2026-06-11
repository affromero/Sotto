'use client';

import { useId } from 'react';
import { ANIMAL_AVATARS, avatarImagePath } from '@/lib/avatars';
import { AvatarTile } from './AvatarTile';
import styles from './AvatarPicker.module.css';

interface AvatarPickerProps {
  /** Visible label for the radiogroup. */
  legend: string;
  /** Currently selected avatar slug. */
  value: string;
  onChange: (slug: string) => void;
  disabled?: boolean;
  /** Tile size in px (default 48). */
  size?: number;
}

/**
 * Reusable profile-avatar grid: the preset animal avatars as a radiogroup.
 * Shared by the household manager and the sign-in owner-creation panel so
 * choosing a profile avatar looks and behaves the same everywhere.
 */
export function AvatarPicker({
  legend,
  value,
  onChange,
  disabled = false,
  size = 48,
}: AvatarPickerProps) {
  const groupId = useId();
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel} id={groupId}>
        {legend}
      </span>
      <ul className={styles.avatarGrid} role="radiogroup" aria-labelledby={groupId}>
        {ANIMAL_AVATARS.map((animal) => {
          const isSelected = animal.slug === value;
          return (
            <li key={animal.slug} className={styles.avatarItem}>
              <button
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-label={animal.name}
                className={`${styles.avatarBtn} ${isSelected ? styles.avatarBtnSelected : ''}`}
                onClick={() => onChange(animal.slug)}
                disabled={disabled}
              >
                <AvatarTile
                  image={avatarImagePath(animal.slug)}
                  emoji={animal.emoji}
                  name={animal.name}
                  size={size}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
