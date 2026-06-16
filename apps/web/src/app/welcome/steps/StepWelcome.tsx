'use client';

import { BASE_LANGS, LANGUAGES } from '../data';
import type { FlowState } from '../WelcomeFlow';
import { Glyph } from '../Glyph';
import t from '../theme.module.css';
import c from '../components.module.css';

interface Props {
  state: FlowState;
  demoMode: boolean;
  setBaseLang: (code: string) => void;
  setLanguage: (code: string) => void;
  onNext: () => void;
  onBack: () => void;
}

export function StepWelcome({ state, demoMode, setBaseLang, setLanguage, onNext, onBack }: Props) {
  const { baseLang, language } = state;

  return (
    <div className={t.stepEnter}>
      <div className={t.eyebrow}>
        <span className={t.eyebrowIdx}>02 ·</span> Languages
      </div>
      <h1 className={t.title}>
        Choose the first <em>language bridge</em>.
      </h1>
      <p className={t.lede}>
        Sotto teaches through the things you already care about. Set the pair this admin learner
        starts with; more courses can be added later.
      </p>

      <div className={c.fromRow}>
        <span className={c.fromLabel}>I speak</span>
        <div className={c.fromChips}>
          {BASE_LANGS.map((b) => (
            <button
              key={b.code}
              className={`${c.fromChip} ${baseLang === b.code ? c.fromChipSel : ''}`}
              onClick={() => setBaseLang(b.code)}
              aria-pressed={baseLang === b.code}
            >
              {b.name}
            </button>
          ))}
        </div>
      </div>

      <span className={`${t.mlabel} ${c.learnLabel}`}>I want to learn</span>
      <div className={c.langGrid}>
        {LANGUAGES.filter((l) => l.code !== baseLang).map((l, i) => {
          const isSelected = language === l.code;
          return (
            <button
              key={l.code}
              className={[c.langChip, isSelected ? c.langChipSel : ''].filter(Boolean).join(' ')}
              style={{ animationDelay: `${i * 45}ms` }}
              onClick={() => setLanguage(l.code)}
              aria-pressed={isSelected}
              aria-label={`Learn ${l.name}`}
            >
              <span className={c.langTick}>
                <Glyph name="check" size={16} />
              </span>
              <div className={c.langNative}>{l.native}</div>
              <div className={c.langEn}>{l.names?.[baseLang] ?? l.name}</div>
              <div className={c.langHi}>&ldquo;{l.hi}&rdquo;</div>
            </button>
          );
        })}
      </div>

      <div className={t.actions}>
        <button className={`${t.btn} ${t.btnGhost}`} onClick={onBack} type="button">
          Back
        </button>
        <span className={t.spacer} />
        <button
          className={`${t.btn} ${t.btnPrimary}`}
          disabled={!language}
          onClick={onNext}
          aria-label="Continue to agent setup"
        >
          Continue{' '}
          <span className={t.btnArrow}>
            <Glyph name="arrow" size={17} />
          </span>
        </button>
        <span className={t.mlabel}>
          {demoMode ? 'public demo · no signup' : 'open-source · self-hosted'}
        </span>
      </div>
    </div>
  );
}
