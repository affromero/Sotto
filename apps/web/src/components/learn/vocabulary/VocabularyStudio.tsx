'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  vocabularyStudySessionSchema,
  type DictionaryWord,
  type VocabularyStudyMode,
  type VocabularyStudySession,
  type VocabularySupport,
} from '@sotto/shared';
import { STUDY_MODES, VocabularyStudyRunner } from './VocabularyStudyRunner';
import { VocabularySupportSettings } from './VocabularySupportSettings';
import { LocalPronunciation } from './LocalPronunciation';
import { VocabularyImports, type VocabularyImport } from './VocabularyImports';
import styles from './VocabularyStudio.module.css';

interface Dictionary {
  words: DictionaryWord[];
  total: number;
  page: number;
  pages: number;
  counts: { unseen: number; due: number; strong: number };
  vocabularySupport: VocabularySupport | null;
  materials: VocabularyImport[];
}
const STATES = {
  all: 'All words',
  unseen: 'Unseen',
  learning: 'Learning',
  due: 'Due',
  strong: 'Strong',
};
const STATE_LABELS = {
  unseen: 'Unseen',
  introduced: 'Studied, unassessed',
  learning: 'Learning',
  due: 'Review due',
  strong: 'Strong',
};

export function VocabularyStudio({
  courseId,
  courseName,
  support,
  sessionId,
}: {
  courseId: string;
  courseName: string;
  support: VocabularySupport | null;
  sessionId?: string;
}) {
  const router = useRouter();
  const [dictionary, setDictionary] = useState<Dictionary | null>(null);
  const [search, setSearch] = useState('');
  const [state, setState] = useState('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<VocabularyStudyMode>(
    support === 'WORD_RECALL'
      ? 'WORD_RECALL'
      : support === 'LISTENING_RECOGNITION'
        ? 'LISTENING_RECALL'
        : 'MEANING_RECALL'
  );
  const [study, setStudy] = useState<VocabularyStudySession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<DictionaryWord | null>(null);
  const [meaning, setMeaning] = useState('');
  const [aliases, setAliases] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [pendingAdmission, setPendingAdmission] = useState<{
    requestId: string;
    mode: VocabularyStudyMode;
    wordIds?: string[];
  } | null>(null);
  const base = `/api/v1/courses/${courseId}/vocabulary`;

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        void fetch(`${base}?${new URLSearchParams({ search, state, page: String(page) })}`, {
          signal: controller.signal,
        })
          .then(async (response) => {
            const data = await response.json();
            if (!response.ok) throw new Error(data.error ?? 'Dictionary could not be loaded.');
            if (!controller.signal.aborted) setDictionary(data as Dictionary);
          })
          .catch((cause: unknown) => {
            if (!controller.signal.aborted)
              setError(cause instanceof Error ? cause.message : 'Dictionary could not be loaded.');
          });
      },
      search ? 200 : 0
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [base, search, state, page, refresh]);
  useEffect(() => {
    if (!dictionary?.materials.some((material) => ['PENDING', 'ACTIVE'].includes(material.status)))
      return;
    const timer = setTimeout(() => setRefresh((value) => value + 1), 4000);
    return () => clearTimeout(timer);
  }, [dictionary]);

  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    void fetch(`/api/v1/practice/${sessionId}`, { signal: controller.signal })
      .then(async (response) => {
        const data: unknown = await response.json();
        if (!response.ok) throw new Error('Saved vocabulary study could not be loaded.');
        const saved = vocabularyStudySessionSchema.parse(data);
        if (saved.courseId !== courseId)
          throw new Error('This study belongs to a different course.');
        if (!controller.signal.aborted) setStudy(saved);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Study could not be loaded.');
      });
    return () => controller.abort();
  }, [sessionId, courseId]);

  const leave = useCallback(() => {
    setStudy(null);
    setRefresh((value) => value + 1);
    router.replace(`/learn/vocabulary?course=${courseId}`);
  }, [courseId, router]);

  async function begin() {
    setBusy(true);
    setError('');
    const input = pendingAdmission ?? {
      requestId: crypto.randomUUID(),
      mode,
      ...(selected.length ? { wordIds: [...selected] } : {}),
    };
    setPendingAdmission(input);
    try {
      const response = await fetch(`${base}/study`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        setPendingAdmission(null);
        throw new Error(
          data && typeof data === 'object' && 'error' in data
            ? String(data.error)
            : 'Study could not be started.'
        );
      }
      setStudy(vocabularyStudySessionSchema.parse(data));
      setPendingAdmission(null);
      router.replace(`/learn/vocabulary?course=${courseId}&session=${input.requestId}`);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The response was lost. Reload to check the saved session.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveMeaning() {
    if (!editing) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${base}/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          translation: meaning,
          acceptedMeanings: aliases
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Meaning could not be saved.');
      setEditing(null);
      setRefresh((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Meaning could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  if (study)
    return (
      <div className={styles.root} role="region" aria-label="Vocabulary">
        <VocabularyStudyRunner key={study.sessionId} start={study} onDone={leave} />
      </div>
    );
  return (
    <div className={styles.root} role="region" aria-label="Vocabulary">
      <header className={styles.header}>
        <p className={styles.eyebrow}>{courseName} / Vocabulary</p>
        <h1>
          Your words,
          <br />
          <span>within reach.</span>
        </h1>
        <p className={styles.intro}>
          Meet a few words, retrieve their meanings, and return when they need you. Your classes use
          this same dictionary.
        </p>
      </header>
      <section className={styles.practice} aria-label="Vocabulary practice">
        <div>
          <p className={styles.eyebrow}>A little practice, often</p>
          <h2>Make the meaning stick.</h2>
          <p>
            {selected.length
              ? `${selected.length} selected words`
              : 'A small set of due words and new introductions, paced by your recall.'}
          </p>
        </div>
        <div className={styles.startControls}>
          <label htmlFor="vocabulary-mode">Practice mode</label>
          <select
            id="vocabulary-mode"
            value={mode}
            disabled={busy || pendingAdmission !== null}
            onChange={(event) => setMode(event.target.value as VocabularyStudyMode)}
          >
            {Object.entries(STUDY_MODES).map(([key, value]) => (
              <option key={key} value={key}>
                {value.title}
              </option>
            ))}
          </select>
          <button
            className={styles.primary}
            disabled={busy || dictionary?.total === 0}
            onClick={() => void begin()}
          >
            {busy
              ? 'Opening…'
              : pendingAdmission
                ? 'Retry saved attempt'
                : selected.length
                  ? 'Practice selection'
                  : 'Start practice'}
          </button>
        </div>
      </section>
      <div className={styles.stats} aria-label="Vocabulary progress">
        <span>
          <strong>{dictionary?.total ?? '…'}</strong> words in this view
        </span>
        <span>
          <strong>{dictionary?.counts.unseen ?? '…'}</strong> waiting to be introduced
        </span>
        <span>
          <strong>{dictionary?.counts.due ?? '…'}</strong> due for recall
        </span>
        <span>
          <strong>{dictionary?.counts.strong ?? '…'}</strong> with strong recall
        </span>
      </div>
      {dictionary && (
        <VocabularyImports
          materials={dictionary.materials}
          onChanged={() => setRefresh((value) => value + 1)}
        />
      )}
      <section aria-label="Dictionary" className={styles.dictionary}>
        <div className={styles.tools}>
          <label className={styles.search}>
            Find a word
            <input
              type="search"
              placeholder="Search word or meaning"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            Show
            <select
              value={state}
              onChange={(event) => {
                setState(event.target.value);
                setPage(1);
              }}
            >
              {Object.entries(STATES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {selected.length > 0 && (
          <div className={styles.selection}>
            <span>{selected.length} / 24 selected</span>
            <button onClick={() => setSelected([])}>Clear selection</button>
          </div>
        )}
        {!dictionary ? (
          <p role="status">Loading your dictionary…</p>
        ) : dictionary.words.length === 0 ? (
          <div className={styles.empty}>
            <h2>
              {search || state !== 'all'
                ? 'No words match this view.'
                : 'Your dictionary starts here.'}
            </h2>
            <p>
              {search || state !== 'all'
                ? 'Try another search or show all words.'
                : 'Add course materials or take a class to build your vocabulary.'}
            </p>
          </div>
        ) : (
          <ul className={styles.words}>
            {dictionary.words.map((word) => (
              <li key={word.id} className={styles.row}>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${word.lemma}`}
                    checked={selected.includes(word.id)}
                    disabled={!selected.includes(word.id) && selected.length >= 24}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, word.id]
                          : current.filter((id) => id !== word.id)
                      )
                    }
                  />
                </label>
                <div className={styles.lexeme}>
                  <strong>{word.lemma}</strong>
                  <span>{word.translation}</span>
                  {word.partOfSpeech && <small>{word.partOfSpeech}</small>}
                  <LocalPronunciation endpoint={`${base}/${word.id}/audio`} />
                  {word.sourceCount > 0 && (
                    <details>
                      <summary>
                        {word.sourceCount} source{' '}
                        {word.sourceCount === 1 ? 'location' : 'locations'}
                      </summary>
                      {word.sources.map((source, sourceIndex) => (
                        <p key={`${source.materialId}-${source.startOffset}-${sourceIndex}`}>
                          <a href={`/api/v1/materials/${source.materialId}/file`}>{source.name}</a>
                          <br />
                          <q>{source.quote}</q> · {source.meaning}
                        </p>
                      ))}
                      {word.sourceCount > word.sources.length && (
                        <small>Showing the first {word.sources.length} locations.</small>
                      )}
                    </details>
                  )}
                </div>
                <div className={styles.memory}>
                  <span>{STATE_LABELS[word.state]}</span>
                  {word.lastReviewed && (
                    <small>
                      Recall estimate{' '}
                      {word.mastery > 0 && word.mastery < 0.01
                        ? '<1'
                        : Math.round(word.mastery * 100)}
                      % · {word.reviews} recorded {word.reviews === 1 ? 'review' : 'reviews'}
                    </small>
                  )}
                  {word.dueAt && (
                    <small>Next review {new Date(word.dueAt).toLocaleDateString()}</small>
                  )}
                </div>
                <button
                  className={styles.edit}
                  aria-label={`Edit meanings for ${word.lemma}`}
                  onClick={() => {
                    setEditing(word);
                    setMeaning(word.translation);
                    setAliases(word.acceptedMeanings.join('\n'));
                  }}
                >
                  Edit meanings
                </button>
              </li>
            ))}
          </ul>
        )}
        {dictionary && dictionary.pages > 1 && (
          <nav className={styles.pagination} aria-label="Dictionary pages">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <span>
              {page} / {dictionary.pages}
            </span>
            <button disabled={page >= dictionary.pages} onClick={() => setPage(page + 1)}>
              Next
            </button>
          </nav>
        )}
      </section>
      {editing && (
        <section className={styles.editor} aria-label={`Edit ${editing.lemma}`}>
          <h2>{editing.lemma}</h2>
          <p>
            These meanings are accepted in future recall checks. Existing sessions keep their
            original answers.
          </p>
          <label>
            Primary meaning
            <input
              value={meaning}
              onChange={(event) => setMeaning(event.target.value)}
              maxLength={2000}
            />
          </label>
          <label>
            Other accepted meanings, one per line
            <textarea
              value={aliases}
              onChange={(event) => setAliases(event.target.value)}
              rows={4}
            />
          </label>
          <div className={styles.pagination}>
            <button onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </button>
            <button
              className={styles.primary}
              onClick={() => void saveMeaning()}
              disabled={busy || !meaning.trim()}
            >
              Save meanings
            </button>
          </div>
        </section>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <details className={styles.help}>
        <summary>How practice adapts to you</summary>
        <p>
          Studying a flashcard introduces a word. Checking an answer records recall and schedules a
          later review. Due and weaker words return first; stronger recall creates room for new
          words in classes and practice.
        </p>
        <p>
          The recall estimate reflects your answers so far. It takes repeated practice over time to
          become reliable.
        </p>
        <VocabularySupportSettings courseId={courseId} current={support} />
      </details>
    </div>
  );
}
