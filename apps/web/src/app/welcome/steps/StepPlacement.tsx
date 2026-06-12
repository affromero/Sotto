'use client';

import { LANGUAGES, PLACEMENT_BY_LANG, LEVELS } from '../data';
import type { CefrLevel } from '../data';
import { Glyph } from '../Glyph';
import t from '../theme.module.css';
import c from '../components.module.css';

interface Props {
  baseLang: string;
  language: string;
  understood: Set<CefrLevel>;
  toggleUnderstood: (lvl: CefrLevel) => void;
  level: CefrLevel | null;
  demoMode?: boolean;
  onNext: () => void;
  onBack: () => void;
}

export function StepPlacement({
  baseLang,
  language,
  understood,
  toggleUnderstood,
  level,
  demoMode = false,
  onNext,
  onBack,
}: Props) {
  const idx = level ? LEVELS.indexOf(level) : -1;
  const pct = level ? ((idx + 1) / LEVELS.length) * 100 : 0;
  const lang = LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0];
  const items = PLACEMENT_BY_LANG[language] ?? PLACEMENT_BY_LANG['it'] ?? [];
  const rtl = language === 'ar';

  return (
    <div className={t.stepEnter}>
      <div className={t.eyebrow}>
        <span className={t.eyebrowIdx}>04 ·</span> Placement
      </div>
      <h1 className={t.title}>
        Where do you <em>start</em> in {lang.native}?
      </h1>
      <p className={t.lede}>
        Tap every sentence you fully understand. Sotto anchors your syllabus to the CEFR level just
        above your reach — never busywork, never over your head.
      </p>
      {demoMode && (
        <aside className={c.placementAside} aria-label="Placement test available">
          <span className={c.placementAsideKicker}>Full placement test</span>
          <span>
            Prefer a formal check? The app also has a short adaptive test that places learners before
            their first course; this demo shows the same idea as a quick sentence ladder.
          </span>
        </aside>
      )}

      <div className={c.placementList}>
        {items.map((p) => {
          const on = understood.has(p.level);
          const gloss = p.glosses?.[baseLang] ?? p.gloss;
          return (
            <button
              key={p.level}
              className={`${c.plRow} ${on ? c.plRowOn : ''}`}
              onClick={() => toggleUnderstood(p.level)}
              aria-pressed={on}
              aria-label={`${p.level}: ${p.text}`}
            >
              <span className={c.plLvl}>{p.level}</span>
              <span className={c.plText}>
                <span
                  className={c.plIt}
                  dir={rtl ? 'rtl' : 'auto'}
                  style={rtl ? { textAlign: 'right' } : undefined}
                >
                  {p.text}
                </span>
                <span className={c.plGloss}>{gloss}</span>
              </span>
              <span className={c.plCheck}>
                <Glyph name="check" size={18} />
              </span>
            </button>
          );
        })}
      </div>

      <div className={c.cefr}>
        <div className={c.cefrTrack}>
          <div className={c.cefrFill} style={{ width: `${pct}%` }} />
          <div className={c.cefrPointer} style={{ left: `${pct}%` }} />
        </div>
        <div className={c.cefrTicks}>
          {LEVELS.map((l) => (
            <span key={l} className={`${c.cefrTick} ${l === level ? c.cefrTickHit : ''}`}>
              {l}
            </span>
          ))}
        </div>
        <div className={c.cefrRead}>
          {level ? (
            <>
              Estimated level <b>{level}</b> — your course begins one rung higher.
            </>
          ) : (
            'Select what you understand to estimate your level.'
          )}
        </div>
      </div>

      <div className={t.actions}>
        <button className={`${t.btn} ${t.btnBare}`} onClick={onBack}>
          ← Back
        </button>
        <span className={t.spacer} />
        <button className={`${t.btn} ${t.btnPrimary}`} disabled={!level} onClick={onNext}>
          Compose my course{' '}
          <span className={t.btnArrow}>
            <Glyph name="arrow" size={17} />
          </span>
        </button>
      </div>
    </div>
  );
}
