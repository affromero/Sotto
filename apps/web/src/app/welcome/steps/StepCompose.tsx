'use client';

import { useState, useEffect, useRef } from 'react';
import { COMPOSE_LOG, MODULES, TTS_PROVIDERS, STT_PROVIDERS } from '../data';
import type { CefrLevel } from '../data';
import type { VoiceState } from '../WelcomeFlow';
import { Glyph } from '../Glyph';
import t from '../theme.module.css';
import c from '../components.styles';

interface ResolvedLine {
  t: 'ctx' | 'ok' | 'plan' | 'done';
  text: string;
}

interface Props {
  level: CefrLevel | null;
  voice: VoiceState;
  demoMode: boolean;
  onDone: () => void;
  onBack: () => void;
}

export function StepCompose({ level, voice, demoMode, onDone, onBack }: Props) {
  const [lines, setLines] = useState<ResolvedLine[]>([]);
  const [liveCount, setLiveCount] = useState(0);
  const [finished, setFinished] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const lvl = level ?? 'A2';
  const ttsName = (TTS_PROVIDERS.find((p) => p.id === voice.tts) ?? TTS_PROVIDERS[0]).name;
  const sttName = (STT_PROVIDERS.find((p) => p.id === voice.stt) ?? STT_PROVIDERS[0]).name;

  useEffect(() => {
    let i = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];

    function tick() {
      if (i >= COMPOSE_LOG.length) {
        setFinished(true);
        return;
      }
      const item = COMPOSE_LOG[i];
      const text = item.text
        .replace(/\{\{LEVEL\}\}/g, lvl)
        .replace(/\{\{TTS\}\}/g, ttsName)
        .replace(/\{\{STT\}\}/g, sttName);

      setLines((prev) => [...prev, { t: item.t, text }]);
      if (item.t === 'ok') {
        setLiveCount((v) => v + 1);
      }
      i++;
      timers.push(setTimeout(tick, item.t === 'done' ? 600 : 360 + Math.random() * 260));
    }

    timers.push(setTimeout(tick, 400));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div className={t.stepEnter}>
      <div className={t.eyebrow}>
        <span className={t.eyebrowIdx}>08 ·</span> Composing
      </div>
      <h1 className={t.title}>
        {finished ? (
          <>
            Your course is <em>ready</em>.
          </>
        ) : (
          <>
            Composing <em>your course</em>...
          </>
        )}
      </h1>
      <p className={t.lede}>
        {demoMode
          ? 'This preview simulates the composer so you can feel the course shape without creating a profile, saving keys, or connecting sources.'
          : 'Your agent is reading your context and writing a course only you could have. This runs entirely on your infrastructure.'}
      </p>

      <div className={c.compose}>
        <div className={c.term} aria-label="Compose log" aria-live="polite">
          <div className={c.termHead}>
            <span className={c.termDots}>
              <i />
              <i />
              <i />
            </span>
            sotto · compose
          </div>
          <div className={c.termBody} ref={bodyRef}>
            {lines.map((l, i) => (
              <div
                key={i}
                className={[
                  c.termLine,
                  l.t === 'ctx' ? c.termLineCtx : '',
                  l.t === 'ok' ? c.termLineOk : '',
                  l.t === 'plan' ? c.termLinePlan : '',
                  l.t === 'done' ? c.termLineDone : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className={c.termPf}>{l.t === 'ok' ? '✓' : l.t === 'done' ? '★' : '›'}</span>
                <span>
                  {l.text}
                  {i === lines.length - 1 && !finished && (
                    <span className={c.termCursor} aria-hidden="true" />
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className={c.moduleStack}>
          {MODULES.map((m, i) => (
            <div key={m.id} className={`${c.moduleCard} ${i < liveCount ? c.moduleCardLive : ''}`}>
              <span className={c.mico}>
                <Glyph name={m.glyph} size={19} />
              </span>
              <div>
                <div className={c.mname}>{m.name}</div>
                <div className={c.mmeta}>{m.meta}</div>
              </div>
              <span className={c.mdone}>
                <Glyph name="check" size={16} />
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className={t.actions}>
        <button className={`${t.btn} ${t.btnBare}`} onClick={onBack}>
          ← Back
        </button>
        <span className={t.spacer} />
        <button className={`${t.btn} ${t.btnPrimary}`} disabled={!finished} onClick={onDone}>
          {demoMode ? 'See course preview' : 'Enter Sotto'}{' '}
          <span className={t.btnArrow}>
            <Glyph name="arrow" size={17} />
          </span>
        </button>
      </div>
    </div>
  );
}
