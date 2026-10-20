'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
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
import { MaterialCoverage, MaterialPartialConsent } from '@/components/placement/MaterialCoverage';
import { MaterialAnalysisRetry } from '@/components/placement/MaterialAnalysisRetry';
import {
  analyzePlacementMaterials,
  materialPlacementReference,
  type MaterialPlacementCheckpoint,
  type MaterialPlacementReference,
  type MaterialAnalysisProjection,
} from '@/lib/course-materials/client/analysis';
import t from '../theme.module.css';
import c from '@/app/welcome/components.styles';

interface Props {
  baseLang: string;
  language: string;
  understood: Set<CefrLevel>;
  toggleUnderstood: (lvl: CefrLevel) => void;
  selectPlacementLevel?: (lvl: CefrLevel) => void;
  onAddContextItems?: (items: Array<Omit<ContextItem, 'id'>>) => void;
  onAnalysis?: (value: { level: CefrLevel; reference: MaterialPlacementReference } | null) => void;
  onAnalysisPending?: (pending: boolean) => void;
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
  analysis?: MaterialAnalysisProjection;
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
  onAnalysis,
  onAnalysisPending,
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
  const checkpoint = useRef<MaterialPlacementCheckpoint | null>(null);
  const notesController = useRef<AbortController | null>(null);
  const [acceptPartial, setAcceptPartial] = useState(false);
  const [notesProgress, setNotesProgress] = useState('Reading material...');
  const [lastAnalysis, setLastAnalysis] = useState<MaterialAnalysisProjection | null>(null);
  useEffect(
    () => () => {
      notesController.current?.abort();
      onAnalysisPending?.(false);
    },
    [onAnalysisPending]
  );

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
  const invalidateSourceSelection = () => {
    notesController.current?.abort();
    notesController.current = null;
    checkpoint.current = null;
    setNotesDeduction(null);
    setAcceptPartial(false);
    setNotesPhase('input');
    setLastAnalysis(null);
    onAnalysis?.(null);
    onAnalysisPending?.(false);
  };

  const assignLevel = (nextLevel: CefrLevel) => {
    if (selectPlacementLevel) {
      selectPlacementLevel(nextLevel);
      return;
    }
    toggleUnderstood(nextLevel);
  };
  const chooseLevel = (nextLevel: CefrLevel) => {
    invalidateSourceSelection();
    assignLevel(nextLevel);
  };
  const chooseMode = (nextMode: PlacementMode) => {
    invalidateSourceSelection();
    setMode(nextMode);
  };

  function addNotesAsContext(
    materials: Array<{ id: string; name: string; extractedText: string }> = []
  ) {
    const itemsToAdd: Array<Omit<ContextItem, 'id'>> = [];
    const trimmed = notesText.trim();
    if (trimmed) {
      itemsToAdd.push({
        kind: 'text',
        label: 'Placement notes',
        value: trimmed,
      });
    }
    for (const material of materials) {
      itemsToAdd.push({
        kind: 'file',
        label: material.name,
        value: material.extractedText,
        materialId: material.id,
      });
    }
    if (itemsToAdd.length) onAddContextItems?.(itemsToAdd);
  }

  async function deduceFromNotes() {
    if (!hasNotesMaterial) return;
    setNotesPhase('deducing');
    onAnalysis?.(null);
    onAnalysisPending?.(true);
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
      assignLevel(inferred);
      addNotesAsContext();
      setNotesPhase('result');
      onAnalysisPending?.(false);
      return;
    }

    const controller = new AbortController();
    notesController.current?.abort();
    notesController.current = controller;
    try {
      const analysis = await analyzePlacementMaterials({
        native: baseLang,
        target: language,
        content: notesText,
        files: notesFiles,
        checkpoint: checkpoint.current,
        signal: controller.signal,
        onCheckpoint: (value) => {
          checkpoint.current = value;
        },
        onProgress: setNotesProgress,
        onProjection: setLastAnalysis,
      });
      controller.signal.throwIfAborted();
      const inference = analysis.summary?.inference;
      if (!inference || !isCefrLevel(inference.level))
        throw new Error(
          'These materials do not support a level estimate. Take the test or choose a level manually.'
        );
      const deducedLevel = inference.level;
      const deduction: NotesDeduction = {
        deducedLevel,
        rationale: inference.rationale,
        confidence: inference.confidence,
        imported: notesFiles.length,
        analysis,
      };
      setNotesDeduction(deduction);
      setAcceptPartial(false);
      if (analysis.status === 'COMPLETE') {
        assignLevel(deducedLevel);
        onAnalysis?.({
          level: deducedLevel,
          reference: materialPlacementReference(analysis, false),
        });
      }
      setNotesPhase('result');
    } catch (error) {
      if (controller.signal.aborted) return;
      setNotesError(
        error instanceof Error
          ? error.message
          : 'Could not reach the server. Try again or choose a level manually.'
      );
      setNotesPhase('error');
    } finally {
      if (notesController.current === controller) onAnalysisPending?.(false);
    }
  }

  function handleNotesFiles(event: ChangeEvent<HTMLInputElement>) {
    setNotesFiles(Array.from(event.currentTarget.files ?? []));
    invalidateSourceSelection();
  }
  async function resumeRetry(analysisId: string, parentId: string) {
    if (!checkpoint.current || checkpoint.current.analysisId !== parentId)
      throw new Error('The source selection changed. Open its current analysis before retrying.');
    checkpoint.current.analysisId = analysisId;
    await deduceFromNotes();
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
        <span className={t.eyebrowIdx}>07 ·</span> Placement
      </div>
      <h1 className={t.title}>{title}</h1>
      <p className={t.lede}>{lede}</p>

      {mode === 'choose' && (
        <div className={c.placementChoiceGrid}>
          <button type="button" className={c.placementChoice} onClick={() => chooseMode('ladder')}>
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
          <button type="button" className={c.placementChoice} onClick={() => chooseMode('notes')}>
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
          <button type="button" className={c.placementChoice} onClick={() => chooseMode('manual')}>
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
            onChange={(event) => {
              setNotesText(event.currentTarget.value);
              invalidateSourceSelection();
            }}
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
            {notesPhase === 'deducing' ? notesProgress : 'Estimate from material'}
          </button>

          {notesPhase === 'error' && (
            <div className={c.placementNotice} role="alert">
              {notesError}
            </div>
          )}
          {notesPhase === 'error' && (
            <MaterialAnalysisRetry analysis={lastAnalysis} onRetry={resumeRetry} />
          )}

          {notesPhase === 'result' && notesDeduction && (
            <div className={c.placementNotesResult} aria-live="polite">
              <div className={c.placementNotesLevel}>
                <span>{notesDeduction.deducedLevel}</span>
                <b>{LEVEL_LABELS[notesDeduction.deducedLevel]}</b>
              </div>
              <p>{notesDeduction.rationale}</p>
              {notesDeduction.analysis && <MaterialCoverage analysis={notesDeduction.analysis} />}
              {notesDeduction.analysis && (
                <MaterialAnalysisRetry analysis={notesDeduction.analysis} onRetry={resumeRetry} />
              )}
              {notesDeduction.analysis?.status === 'PARTIAL' && (
                <MaterialPartialConsent
                  disabled={!notesDeduction.analysis.coverage}
                  checked={acceptPartial}
                  onChange={(accepted) => {
                    setAcceptPartial(accepted);
                    if (accepted && notesDeduction.analysis) {
                      assignLevel(notesDeduction.deducedLevel);
                      onAnalysis?.({
                        level: notesDeduction.deducedLevel,
                        reference: materialPlacementReference(notesDeduction.analysis, true),
                      });
                    } else onAnalysis?.(null);
                  }}
                />
              )}
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
                  onClick={() => {
                    invalidateSourceSelection();
                    toggleUnderstood(p.level);
                  }}
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
          onClick={mode === 'choose' ? onBack : () => chooseMode('choose')}
        >
          ← Back
        </button>
        <span className={t.spacer} />
        {mode !== 'choose' && (
          <button
            className={`${t.btn} ${t.btnPrimary}`}
            disabled={
              !level ||
              (mode === 'notes' &&
                (notesPhase !== 'result' ||
                  !notesDeduction ||
                  (notesDeduction.analysis?.status === 'PARTIAL' && !acceptPartial)))
            }
            onClick={onNext}
          >
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
