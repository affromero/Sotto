'use client';

import { SOURCES, iconFor } from '../data';
import { Glyph } from '../Glyph';
import t from '../theme.module.css';
import c from '../components.module.css';

interface Props {
  sources: Set<string>;
  toggle: (id: string) => void;
  onNext: () => void;
  onBack: () => void;
}

export function StepContext({ sources, toggle, onNext, onBack }: Props) {
  const n = sources.size;

  return (
    <div className={t.stepEnter}>
      <div className={t.eyebrow}>
        <span className={t.eyebrowIdx}>03 ·</span> Grant context
      </div>
      <h1 className={t.title}>
        Teach it <em>what you care about</em>.
      </h1>
      <p className={t.lede}>
        This is the part that makes Sotto yours. Choose what the agent may read — it draws every
        lesson, reading, and podcast from your real life. Nothing leaves your machine.
      </p>

      <div className={c.sourceList}>
        {SOURCES.map((s) => {
          const on = sources.has(s.id);
          return (
            <button
              key={s.id}
              className={`${c.sourceRow} ${on ? c.sourceRowOn : ''}`}
              onClick={() => toggle(s.id)}
              role="switch"
              aria-checked={on}
              aria-label={`${s.label}: ${s.meta}`}
            >
              <span className={c.sico}>
                <Glyph name={iconFor(s.id)} size={20} />
              </span>
              <div>
                <div className={c.stop}>
                  <span className={c.slabel}>{s.label}</span>
                  <span className={c.smeta}>{s.meta}</span>
                </div>
                <div className={c.ssample}>e.g. {s.sample}</div>
              </div>
              <span className={c.switch} aria-hidden="true" />
            </button>
          );
        })}
      </div>

      <div className={c.ctxTally}>
        {n === 0 ? (
          'Pick at least one source — the richer the context, the better your course.'
        ) : (
          <>
            Sotto will weave your course from{' '}
            <b>
              {n} source{n > 1 ? 's' : ''}
            </b>
            .
          </>
        )}
      </div>

      <div className={t.actions}>
        <button className={`${t.btn} ${t.btnBare}`} onClick={onBack}>
          ← Back
        </button>
        <span className={t.spacer} />
        <button
          className={`${t.btn} ${t.btnPrimary}`}
          disabled={n === 0}
          onClick={onNext}
        >
          Continue{' '}
          <span className={t.btnArrow}>
            <Glyph name="arrow" size={17} />
          </span>
        </button>
      </div>
    </div>
  );
}
