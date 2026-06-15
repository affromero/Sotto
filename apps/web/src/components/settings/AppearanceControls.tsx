'use client';

import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '@/components/providers/ThemeProvider';
import styles from './AppearanceControls.module.css';

type ThemeOption = 'light' | 'dark' | 'system';

const modeOptions: Array<{ value: ThemeOption; label: string; Icon: typeof Sun }> = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
];

const ACCENT_SWATCHES = [
  { hex: '#3F4FB0', label: 'Aula blue' },
  { hex: '#1C7A6B', label: 'Teal' },
  { hex: '#BC4B26', label: 'Rust' },
  { hex: '#80487F', label: 'Plum' },
  { hex: '#2A3550', label: 'Ink slate' },
];

export function AppearanceControls() {
  const {
    theme,
    setTheme,
    resolvedTheme,
    accent,
    setAccent,
    palette,
    setPalette,
    reducedMotion,
    setReducedMotion,
  } = useTheme();

  return (
    <div className={styles.root}>
      {/* MODE ---------------------------------------------------------------- */}
      <div className={styles.group}>
        <span className={styles.groupLabel}>Mode</span>
        <div className={styles.segmented} role="group" aria-label="Color mode">
          {modeOptions.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              className={`${styles.segBtn} ${theme === value ? styles.segBtnActive : ''}`}
              onClick={() => setTheme(value)}
              aria-pressed={theme === value}
              aria-label={label}
            >
              <Icon size={16} className={styles.segIcon} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* LIGHT PALETTE ------------------------------------------------------- */}
      <div className={styles.group}>
        <span className={styles.groupLabel}>
          Light palette
          {resolvedTheme === 'dark' && (
            <span className={styles.dimNote}> (dark mode active)</span>
          )}
        </span>
        <div className={styles.paletteRow} role="group" aria-label="Light palette">
          <button
            type="button"
            className={`${styles.paletteBtn} ${palette === 'aula' ? styles.paletteBtnActive : ''}`}
            onClick={() => setPalette('aula')}
            aria-pressed={palette === 'aula'}
            disabled={resolvedTheme === 'dark'}
          >
            <span className={styles.paletteSwatch} style={{ background: '#F5F4F0', borderColor: '#DEDDD6' }} aria-hidden="true" />
            <span>Aula cool</span>
          </button>
          <button
            type="button"
            className={`${styles.paletteBtn} ${palette === 'paper' ? styles.paletteBtnActive : ''}`}
            onClick={() => setPalette('paper')}
            aria-pressed={palette === 'paper'}
            disabled={resolvedTheme === 'dark'}
          >
            <span className={styles.paletteSwatch} style={{ background: '#F1EADC', borderColor: '#D3C9B6' }} aria-hidden="true" />
            <span>Paper warm</span>
          </button>
        </div>
      </div>

      {/* ACCENT -------------------------------------------------------------- */}
      <div className={styles.group}>
        <span className={styles.groupLabel}>Accent color</span>
        <div className={styles.accentRow} role="group" aria-label="Accent color">
          {ACCENT_SWATCHES.map(({ hex, label }) => {
            const isActive = accent.toLowerCase() === hex.toLowerCase();
            return (
              <button
                key={hex}
                type="button"
                className={`${styles.accentSwatch} ${isActive ? styles.accentSwatchActive : ''}`}
                style={{ '--swatch-color': hex } as React.CSSProperties}
                onClick={() => setAccent(hex)}
                aria-pressed={isActive}
                aria-label={label}
                title={label}
              />
            );
          })}
        </div>
      </div>

      {/* MOTION -------------------------------------------------------------- */}
      <div className={styles.group}>
        <span className={styles.groupLabel}>Motion</span>
        <div className={styles.segmented} role="group" aria-label="Motion">
          <button
            type="button"
            className={`${styles.segBtn} ${!reducedMotion ? styles.segBtnActive : ''}`}
            onClick={() => setReducedMotion(false)}
            aria-pressed={!reducedMotion}
          >
            <span>Full</span>
          </button>
          <button
            type="button"
            className={`${styles.segBtn} ${reducedMotion ? styles.segBtnActive : ''}`}
            onClick={() => setReducedMotion(true)}
            aria-pressed={reducedMotion}
          >
            <span>Reduced</span>
          </button>
        </div>
      </div>
    </div>
  );
}
