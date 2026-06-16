'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import {
  LANGUAGES,
  PLACEMENT_BY_LANG,
  LEVELS,
  PLACEMENT_LEVEL_COPY,
  PLACEMENT_LEVEL_GUIDES,
} from '../data';
import type { CefrLevel } from '../data';
import type { ContextItem } from '../WelcomeFlow';
import { Glyph } from '../Glyph';
import t from '../theme.module.css';
import c from '../components.module.css';

interface Props {
  baseLang: string;
  language: string;
  understood: Set<CefrLevel>;
  toggleUnderstood: (lvl: CefrLevel) => void;
  selectPlacementLevel?: (lvl: CefrLevel) => void;
  onAddContextItems?: (items: Array<Omit<ContextItem, 'id'>>) => void;
  level: CefrLevel | null;
  demoMode?: boolean;
  onNext: () => void;
  onBack: () => void;
}

type PlacementMode = 'choose' | 'ladder' | 'notes' | 'manual';
type NotesPhase = 'input' | 'deducing' | 'result' | 'error';

interface NotesDeduction {
  deducedLevel: CefrLevel;
  rationale: string;
  confidence: number;
  imported?: number;
  failed?: number;
}

const LEVEL_LABELS: Record<CefrLevel, string> = {
  A1: 'Beginner',
  A2: 'Elementary',
  B1: 'Intermediate',
  B2: 'Upper-intermediate',
  C1: 'Advanced',
  C2: 'Proficient',
};

const MANUAL_HINTS: Record<CefrLevel, string> = {
  A1: 'Start from zero, sounds, greetings, and survival phrases.',
  A2: 'Everyday routines, travel basics, and short exchanges.',
  B1: 'Familiar topics, simple stories, and independent practice.',
  B2: 'Longer texts, real media, and more precise opinions.',
  C1: 'Nuance, registers, difficult source material, and speed.',
  C2: 'Near-native refinement, idiom, culture, and precision.',
};

const NOTE_FILE_ACCEPT =
  '.txt,.md,.csv,.html,.json,.rtf,.pdf,.docx,.pptx,.xlsx,.epub,text/*,application/pdf';

function isCefrLevel(value: unknown): value is CefrLevel {
  return typeof value === 'string' && LEVELS.includes(value as CefrLevel);
}

function noteFileLabel(files: File[]) {
  if (files.length === 0) return 'No files selected';
  if (files.length === 1) return files[0]?.name ?? '1 file selected';
  return `${files.length} files selected`;
}

export function StepPlacement({
  baseLang,
  language,
  toggleUnderstood,
  selectPlacementLevel,
  onAddContextItems,
  level,
  demoMode = false,
  onNext,
  onBack,
}: Props) {
  const [mode, setMode] = useState<PlacementMode>(level ? 'ladder' : 'choose');
  const [notesPhase, setNotesPhase] = useState<NotesPhase>('input');
  const [notesText, setNotesText] = useState('');
  const [notesFiles, setNotesFiles] = useState<File[]>([]);
  const [notesDeduction, setNotesDeduction] = useState<NotesDeduction | null>(null);
  const [notesError, setNotesError] = useState('');
  const notesInputRef = useRef<HTMLInputElement>(null);

  const idx = level ? LEVELS.indexOf(level) : -1;
  const pct = level ? ((idx + 1) / LEVELS.length) * 100 : 0;
  const lang = LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0];
  const items = PLACEMENT_BY_LANG[language] ?? PLACEMENT_BY_LANG['it'] ?? [];
  const copy = PLACEMENT_LEVEL_COPY[baseLang] ?? PLACEMENT_LEVEL_COPY.en;
  const guides = PLACEMENT_LEVEL_GUIDES[baseLang] ?? PLACEMENT_LEVEL_GUIDES.en;
  const guide = level ? guides[level] : null;
  const topLevel = level === LEVELS[LEVELS.length - 1];
  const sourceRtl = baseLang === 'ar';
  const rtl = language === 'ar';
  const hasNotesMaterial = notesText.trim().length > 0 || notesFiles.length > 0;

  const chooseLevel = (nextLevel: CefrLevel) => {
    if (selectPlacementLevel) {
      selectPlacementLevel(nextLevel);
      return;
    }
    toggleUnderstood(nextLevel);
  };

  function addNotesAsContext() {
    const itemsToAdd: Array<Omit<ContextItem, 'id'>> = [];
    const trimmed = notesText.trim();
    if (trimmed) {
      itemsToAdd.push({
        kind: 'text',
        label: 'Placement notes',
        value: trimmed,
      });
    }
    for (const file of notesFiles) {
      itemsToAdd.push({
        kind: 'file',
        label: file.name,
        value: `Uploaded placement material: ${file.name}`,
      });
    }
    if (itemsToAdd.length) onAddContextItems?.(itemsToAdd);
  }

  async function deduceFromNotes() {
    if (!hasNotesMaterial) return;
    setNotesPhase('deducing');
    setNotesError('');

    if (demoMode) {
      const inferred: CefrLevel =
        notesText.length > 900 || notesFiles.length > 1
          ? 'B1'
          : notesText.length > 240
            ? 'A2'
            : 'A1';
      const demoDeduction = {
        deducedLevel: inferred,
        rationale:
          'Demo estimate based on the amount of material provided. In self-hosted setup, your configured AI reads the notes and explains the level.',
        confidence: 0.72,
        imported: notesFiles.length,
        failed: 0,
      };
      setNotesDeduction(demoDeduction);
      chooseLevel(inferred);
      addNotesAsContext();
      setNotesPhase('result');
      return;
    }

    try {
      const form = new FormData();
      form.set('native', baseLang);
      form.set('target', language);
      if (notesText.trim()) form.set('content', notesText.trim());
      for (const file of notesFiles) form.append('files', file);

      const res = await fetch('/api/v1/placement/from-notes/upload', {
        method: 'POST',
        body: form,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setNotesError(
          body?.error ??
            'Could not read those materials. Try pasted text, a smaller file, or choose a level manually.'
        );
        setNotesPhase('error');
        return;
      }

      const data = (await res.json()) as {
        deducedLevel?: string;
        rationale?: string;
        confidence?: number;
        imported?: number;
        failed?: number;
      };
      const deducedLevel = isCefrLevel(data.deducedLevel) ? data.deducedLevel : 'A1';
      const deduction: NotesDeduction = {
        deducedLevel,
        rationale: data.rationale?.trim() || 'Estimated from the materials you shared.',
        confidence: typeof data.confidence === 'number' ? data.confidence : 0,
        imported: data.imported,
        failed: data.failed,
      };
      setNotesDeduction(deduction);
      chooseLevel(deducedLevel);
      addNotesAsContext();
      setNotesPhase('result');
    } catch {
      setNotesError('Could not reach the server. Try again or choose a level manually.');
      setNotesPhase('error');
    }
  }

  function handleNotesFiles(event: ChangeEvent<HTMLInputElement>) {
    setNotesFiles(Array.from(event.currentTarget.files ?? []));
  }

  const title =
    mode === 'choose' ? (
      <>
        How should we <em>place</em> you in {lang.native}?
      </>
    ) : (
      <>
        Where do you <em>start</em> in {lang.native}?
      </>
    );

  const lede =
    mode === 'choose'
      ? 'Choose the placement path that matches what you already have: answer a quick ladder, upload notes, or set a CEFR level yourself.'
      : mode === 'notes'
        ? 'Paste notes, upload class material, or share writing. Sotto estimates a level from the material before composing the course.'
        : mode === 'manual'
          ? 'Pick the CEFR level you want to start from. The course can adjust upward as you learn.'
          : 'This is a quick placement ladder. Tap the highest sentence you fully understand; higher rungs imply the earlier ones are in reach.';

  return (
    <div className={t.stepEnter}>
      <div className={t.eyebrow}>
        <span className={t.eyebrowIdx}>06 ·</span> Placement
      </div>
      <h1 className={t.title}>{title}</h1>
      <p className={t.lede}>{lede}</p>

      {mode === 'choose' && (
        <div className={c.placementChoiceGrid}>
          <button type="button" className={c.placementChoice} onClick={() => setMode('ladder')}>
            <span className={c.placementChoiceIcon} aria-hidden="true">
              <Glyph name="check" size={18} />
            </span>
            <span className={c.placementChoiceText}>
              <span className={c.placementChoiceTitle}>Take the quick placement test</span>
              <span className={c.placementChoiceBody}>
                Use the sentence ladder to estimate the highest level you understand now.
              </span>
            </span>
          </button>
          <button type="button" className={c.placementChoice} onClick={() => setMode('notes')}>
            <span className={c.placementChoiceIcon} aria-hidden="true">
              <Glyph name="upload" size={18} />
            </span>
            <span className={c.placementChoiceText}>
              <span className={c.placementChoiceTitle}>Upload notes or material</span>
              <span className={c.placementChoiceBody}>
                Paste notes, upload class files, or share writing for a material-based estimate.
              </span>
            </span>
          </button>
          <button type="button" className={c.placementChoice} onClick={() => setMode('manual')}>
            <span className={c.placementChoiceIcon} aria-hidden="true">
              <Glyph name="map" size={18} />
            </span>
            <span className={c.placementChoiceText}>
              <span className={c.placementChoiceTitle}>Choose my CEFR level</span>
              <span className={c.placementChoiceBody}>
                Start at A1-C2 directly when you already know where you belong.
              </span>
            </span>
          </button>
        </div>
      )}

      {mode === 'notes' && (
        <section className={c.placementNotes} aria-label="Notes-based placement">
          <label className={c.placementNotesLabel} htmlFor="placement-notes">
            Notes, lesson material, or writing sample
          </label>
          <textarea
            id="placement-notes"
            className={c.placementNotesInput}
            value={notesText}
            onChange={(event) => setNotesText(event.currentTarget.value)}
            rows={7}
            maxLength={20000}
            placeholder="Paste the exact material: class notes, a chapter excerpt, homework feedback, vocabulary you are studying, or a paragraph you wrote."
          />
          <div className={c.placementNotesUpload}>
            <button
              type="button"
              className={c.placementSecondary}
              onClick={() => notesInputRef.current?.click()}
            >
              <Glyph name="upload" size={16} />
              Add files
            </button>
            <span className={c.placementNotesFileCount}>{noteFileLabel(notesFiles)}</span>
          </div>
          <input
            ref={notesInputRef}
            className={c.fileInput}
            type="file"
            multiple
            accept={NOTE_FILE_ACCEPT}
            onChange={handleNotesFiles}
            aria-label="Choose placement note files"
          />
          <button
            type="button"
            className={c.placementPrimary}
            disabled={!hasNotesMaterial || notesPhase === 'deducing'}
            onClick={() => void deduceFromNotes()}
          >
            {notesPhase === 'deducing' ? 'Reading material...' : 'Estimate from material'}
          </button>

          {notesPhase === 'error' && (
            <div className={c.placementNotice} role="alert">
              {notesError}
            </div>
          )}

          {notesPhase === 'result' && notesDeduction && (
            <div className={c.placementNotesResult} aria-live="polite">
              <div className={c.placementNotesLevel}>
                <span>{notesDeduction.deducedLevel}</span>
                <b>{LEVEL_LABELS[notesDeduction.deducedLevel]}</b>
              </div>
              <p>{notesDeduction.rationale}</p>
              <span className={c.placementNotesConfidence}>
                Confidence {Math.round(notesDeduction.confidence * 100)}%
                {typeof notesDeduction.imported === 'number'
                  ? ` · ${notesDeduction.imported} file${notesDeduction.imported === 1 ? '' : 's'} read`
                  : ''}
                {notesDeduction.failed ? ` · ${notesDeduction.failed} skipped` : ''}
              </span>
            </div>
          )}
        </section>
      )}

      {mode === 'manual' && (
        <fieldset className={c.placementManual}>
          <legend className={c.placementManualLegend}>Choose a starting level</legend>
          {LEVELS.map((manualLevel) => (
            <button
              key={manualLevel}
              type="button"
              className={`${c.placementManualLevel} ${level === manualLevel ? c.placementManualLevelOn : ''}`}
              aria-pressed={level === manualLevel}
              onClick={() => chooseLevel(manualLevel)}
            >
              <span className={c.placementManualCode}>{manualLevel}</span>
              <span className={c.placementManualText}>
                <span>{LEVEL_LABELS[manualLevel]}</span>
                <small>{MANUAL_HINTS[manualLevel]}</small>
              </span>
            </button>
          ))}
        </fieldset>
      )}

      {mode === 'ladder' && (
        <>
          {demoMode && (
            <aside className={c.placementAside} aria-label="Placement test available">
              <span className={c.placementAsideKicker}>Placement options</span>
              <span>
                You can use this quick ladder, estimate from notes, or choose a CEFR level by hand.
                The adaptive course will keep checking your level as you learn.
              </span>
            </aside>
          )}

          <div className={c.placementList}>
            {items.map((p) => {
              const on = level === p.level;
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
            <div className={c.cefrRead} dir={sourceRtl ? 'rtl' : 'auto'}>
              {level ? (
                <>
                  {copy.estimatedLevel} <b>{level}</b>:{' '}
                  {topLevel ? copy.beginsTop : copy.beginsNext}
                </>
              ) : (
                'Select what you understand to estimate your level.'
              )}
            </div>
            {guide && (
              <section
                className={c.placementMeaning}
                aria-live="polite"
                dir={sourceRtl ? 'rtl' : 'auto'}
              >
                <div className={c.placementMeaningTitle}>
                  <strong>{level}</strong>
                  <span aria-hidden="true">-</span>
                  <span>{guide.title}</span>
                </div>
                <p className={c.placementMeaningBody}>
                  <span className={c.placementMeaningKicker}>{copy.comfortableWith}:</span>{' '}
                  {guide.comfortable.join(' · ')}
                </p>
                <p className={c.placementCourse}>
                  <span className={c.placementMeaningKicker}>{copy.courseFocus}:</span>{' '}
                  <span>{guide.course}</span>
                </p>
                <p className={c.placementMeaningFoot}>{copy.verifyLater}</p>
              </section>
            )}
          </div>
        </>
      )}

      <div className={t.actions}>
        <button
          className={`${t.btn} ${t.btnBare}`}
          onClick={mode === 'choose' ? onBack : () => setMode('choose')}
        >
          ← Back
        </button>
        <span className={t.spacer} />
        {mode !== 'choose' && (
          <button className={`${t.btn} ${t.btnPrimary}`} disabled={!level} onClick={onNext}>
            Compose my course{' '}
            <span className={t.btnArrow}>
              <Glyph name="arrow" size={17} />
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
