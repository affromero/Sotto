'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GripVertical,
  Pencil,
  Trash2,
  Plus,
  ChevronUp,
  ChevronDown,
  Save,
  RefreshCw,
  Play,
  MessageSquare,
} from 'lucide-react';
import { parseTextWithCitations } from '@/lib/citation-parser';
import { getSpeakerIndex, getUniqueSpeakers } from '@/lib/speaker-colors';
import type { ScriptTurn } from '@/lib/script-generator';
import type { ReferenceData } from '@/types/reference';
import { wordsToMinutes } from '@/lib/duration';
import { ClaimFlagButton } from '@/components/player/ClaimFlagButton';
import styles from './ScriptEditor.module.css';

interface ScriptEditorProps {
  podcastId: string;
  onApprove: () => void;
  onRegenerate: () => void;
}

interface TurnState extends ScriptTurn {
  id: string; // Stable key for React
}

let turnIdCounter = 0;
function nextTurnId(): string {
  return `turn-${++turnIdCounter}`;
}

export function ScriptEditor({ podcastId, onApprove, onRegenerate }: ScriptEditorProps) {
  const [turns, setTurns] = useState<TurnState[]>([]);
  const [references, setReferences] = useState<ReferenceData[]>([]);
  const [, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [editDirection, setEditDirection] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [generalFeedback, setGeneralFeedback] = useState('');
  const [showFeedbackPanel, setShowFeedbackPanel] = useState(false);
  const [turnComments, setTurnComments] = useState<Record<number, string>>({});
  const [commentingIndex, setCommentingIndex] = useState<number | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const savedTurnsRef = useRef<TurnState[]>([]);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch script data
  useEffect(() => {
    let mounted = true;
    async function fetchScript() {
      try {
        const res = await fetch(`/api/podcasts/${podcastId}/script`);
        if (!res.ok) throw new Error('Failed to load script');
        const data = await res.json();
        if (!mounted) return;
        const turnsWithIds = (data.turns as ScriptTurn[]).map((t) => ({
          ...t,
          id: nextTurnId(),
        }));
        setTurns(turnsWithIds);
        savedTurnsRef.current = turnsWithIds;
        setReferences(data.references ?? []);
        setVersion(data.version ?? 0);
        setLoading(false);
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load script');
        setLoading(false);
      }
    }
    fetchScript();
    return () => { mounted = false; };
  }, [podcastId]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [editText]);

  // Auto-save on 5s debounce
  useEffect(() => {
    if (!dirty) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      saveDraft();
    }, 5000);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns, dirty]);

  // beforeunload warning
  const hasFeedback = generalFeedback.trim().length > 0;
  const hasComments = Object.values(turnComments).some((c) => c.trim().length > 0);
  useEffect(() => {
    if (!dirty && !hasFeedback && !hasComments) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty, hasFeedback, hasComments]);

  // Stats
  const stats = useMemo(() => {
    const wordCount = turns.reduce(
      (sum, t) => sum + t.text.split(/\s+/).filter(Boolean).length,
      0
    );
    const estimatedMinutes = Math.round(wordsToMinutes(wordCount));
    return { wordCount, estimatedMinutes, turnCount: turns.length, refCount: references.length };
  }, [turns, references]);

  // Save draft
  const saveDraft = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/script`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          turns: turns.map(({ speaker, text, direction }) => ({
            speaker,
            text,
            ...(direction ? { direction } : {}),
          })),
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      const data = await res.json();
      setVersion(data.version);
      savedTurnsRef.current = turns;
      setDirty(false);
    } catch {
      setError('Failed to save draft');
    } finally {
      setSaving(false);
    }
  }, [podcastId, turns, saving]);

  // Edit mode handlers
  const startEdit = useCallback((index: number) => {
    setEditingIndex(index);
    setEditText(turns[index].text);
    setEditDirection(turns[index].direction ?? '');
    setDeletingIndex(null);
    // Focus textarea after render
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [turns]);

  const confirmEdit = useCallback(() => {
    if (editingIndex === null) return;
    const trimmedText = editText.trim();
    if (!trimmedText) return;
    setTurns((prev) => {
      const updated = [...prev];
      updated[editingIndex] = {
        ...updated[editingIndex],
        text: trimmedText,
        direction: editDirection.trim() || undefined,
      };
      return updated;
    });
    setDirty(true);
    setEditingIndex(null);
  }, [editingIndex, editText, editDirection]);

  const cancelEdit = useCallback(() => {
    setEditingIndex(null);
  }, []);

  // Handle keyboard in textarea
  const handleTextareaKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      cancelEdit();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      confirmEdit();
    }
  }, [cancelEdit, confirmEdit]);

  // Cycle speaker through all unique speakers in the script
  const toggleSpeaker = useCallback((index: number) => {
    setTurns((prev) => {
      const speakers = getUniqueSpeakers(prev);
      const currentSpeaker = prev[index].speaker;
      const currentIdx = speakers.indexOf(currentSpeaker);
      const nextSpeaker = speakers[(currentIdx + 1) % speakers.length];
      const updated = [...prev];
      updated[index] = { ...updated[index], speaker: nextSpeaker };
      return updated;
    });
    setDirty(true);
  }, []);

  // Reorder
  const moveTurn = useCallback((fromIndex: number, toIndex: number) => {
    setTurns((prev) => {
      const updated = [...prev];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      return updated;
    });
    setDirty(true);
  }, []);

  // Delete turn
  const deleteTurn = useCallback((index: number) => {
    setTurns((prev) => {
      if (prev.length <= 2) return prev;
      return prev.filter((_, i) => i !== index);
    });
    setDirty(true);
    setDeletingIndex(null);
    if (editingIndex === index) setEditingIndex(null);
  }, [editingIndex]);

  // Add turn — pick the next speaker in rotation
  const addTurn = useCallback(() => {
    const speakers = getUniqueSpeakers(turns);
    const lastSpeaker = turns.length > 0 ? turns[turns.length - 1].speaker : speakers[speakers.length - 1] ?? 'Host';
    const lastIdx = speakers.indexOf(lastSpeaker);
    const newSpeaker = speakers[(lastIdx + 1) % speakers.length];
    const newTurn: TurnState = {
      id: nextTurnId(),
      speaker: newSpeaker,
      text: '',
    };
    setTurns((prev) => [...prev, newTurn]);
    setDirty(true);
    // Start editing the new turn
    const newIndex = turns.length;
    setEditingIndex(newIndex);
    setEditText('');
    setEditDirection('');
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [turns]);

  // Approve
  const handleApprove = useCallback(async () => {
    setApproving(true);
    try {
      // Auto-save if dirty
      if (dirty) {
        const res = await fetch(`/api/podcasts/${podcastId}/script`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            turns: turns.map(({ speaker, text, direction }) => ({
              speaker,
              text,
              ...(direction ? { direction } : {}),
            })),
          }),
        });
        if (!res.ok) throw new Error('Failed to save before approving');
        setDirty(false);
      }

      const res = await fetch(`/api/podcasts/${podcastId}/script/approve`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to approve script');
      onApprove();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve');
      setApproving(false);
    }
  }, [dirty, turns, podcastId, onApprove]);

  // Regenerate (with optional feedback)
  const handleRegenerate = useCallback(async (withFeedback = false) => {
    setRegenerating(true);
    setShowRegenerateConfirm(false);
    try {
      const feedbackText = generalFeedback.trim();
      // Filter to only non-empty comments
      const filteredComments: Record<number, string> = {};
      for (const [k, v] of Object.entries(turnComments)) {
        if (v.trim()) filteredComments[Number(k)] = v.trim();
      }
      const hasAnyFeedback = feedbackText || Object.keys(filteredComments).length > 0;
      const shouldSendBody = withFeedback && hasAnyFeedback;
      const res = await fetch(`/api/podcasts/${podcastId}/script/regenerate`, {
        method: 'POST',
        ...(shouldSendBody ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(feedbackText ? { feedback: feedbackText } : {}),
            ...(Object.keys(filteredComments).length > 0 ? { turnComments: filteredComments } : {}),
          }),
        } : {}),
      });
      if (!res.ok) throw new Error('Failed to regenerate');
      onRegenerate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate');
      setRegenerating(false);
    }
  }, [podcastId, onRegenerate, generalFeedback, turnComments]);

  // Drag and drop handlers
  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  }, []);

  const handleDrop = useCallback((index: number) => {
    if (dragIndex !== null && dragIndex !== index) {
      moveTurn(dragIndex, index);
    }
    setDragIndex(null);
    setDragOverIndex(null);
  }, [dragIndex, moveTurn]);

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDragOverIndex(null);
  }, []);

  if (loading) {
    return (
      <div className={styles.root}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
        </div>
      </div>
    );
  }

  if (error && turns.length === 0) {
    return (
      <div className={styles.root}>
        <div className={styles.error}>{error}</div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {/* Header with stats */}
      <header className={styles.header}>
        <h3 className={styles.title}>Script Preview</h3>
        <div className={styles.stats}>
          <span className={styles.statItem}>
            {stats.wordCount.toLocaleString()} words
          </span>
          <span className={styles.statDivider} aria-hidden="true" />
          <span className={styles.statItem}>
            ~{stats.estimatedMinutes} min
          </span>
          <span className={styles.statDivider} aria-hidden="true" />
          <span className={styles.statItem}>
            {stats.turnCount} turns
          </span>
          {stats.refCount > 0 && (
            <>
              <span className={styles.statDivider} aria-hidden="true" />
              <span className={styles.statItem}>
                {stats.refCount} references
              </span>
            </>
          )}
          {dirty && (
            <>
              <span className={styles.statDivider} aria-hidden="true" />
              <span className={styles.unsavedBadge}>Unsaved</span>
            </>
          )}
        </div>
      </header>

      {/* Error banner */}
      {error && turns.length > 0 && (
        <div className={styles.error} role="alert">{error}</div>
      )}

      {/* Turns */}
      <div className={styles.turns} role="list" aria-label="Script turns">
        {turns.map((turn, index) => {
          const allSpeakers = getUniqueSpeakers(turns);
          const speakerIdx = getSpeakerIndex(turn.speaker, allSpeakers);
          const isEditing = editingIndex === index;
          const isDeleting = deletingIndex === index;

          return (
            <div
              key={turn.id}
              className={[
                styles.turn,
                isEditing ? styles.turnEditing : '',
                dragIndex === index ? styles.turnDragging : '',
                dragOverIndex === index ? styles.turnDragOver : '',
              ].filter(Boolean).join(' ')}
              data-speaker-index={speakerIdx}
              role="listitem"
              style={{ animationDelay: `${Math.min(index * 50, 500)}ms` }}
              draggable={!isEditing}
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={() => handleDrop(index)}
              onDragEnd={handleDragEnd}
            >
              <div className={styles.turnRow}>
                {/* Desktop drag handle */}
                <div className={styles.dragHandle} aria-hidden="true">
                  <GripVertical size={16} />
                </div>

                {/* Mobile move buttons */}
                <div className={styles.moveButtons}>
                  <button
                    type="button"
                    className={styles.moveBtn}
                    onClick={() => moveTurn(index, index - 1)}
                    disabled={index === 0}
                    aria-label="Move up"
                  >
                    <ChevronUp size={16} />
                  </button>
                  <button
                    type="button"
                    className={styles.moveBtn}
                    onClick={() => moveTurn(index, index + 1)}
                    disabled={index === turns.length - 1}
                    aria-label="Move down"
                  >
                    <ChevronDown size={16} />
                  </button>
                </div>

                {/* Content */}
                <div className={styles.turnContent}>
                  {/* Speaker label (clickable to cycle) */}
                  <button
                    type="button"
                    className={styles.speakerLabel}
                    data-speaker-index={speakerIdx}
                    onClick={() => toggleSpeaker(index)}
                    aria-label={`Cycle speaker (current: ${turn.speaker})`}
                  >
                    {turn.speaker}
                  </button>

                  {/* Direction */}
                  {isEditing ? (
                    <input
                      type="text"
                      className={styles.directionInput}
                      value={editDirection}
                      onChange={(e) => setEditDirection(e.target.value)}
                      placeholder="Direction (e.g., laughing, excited)..."
                      aria-label="Delivery direction"
                    />
                  ) : (
                    turn.direction && (
                      <span className={styles.direction}>({turn.direction})</span>
                    )
                  )}

                  {/* Text */}
                  {isEditing ? (
                    <textarea
                      ref={textareaRef}
                      className={styles.turnTextarea}
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={handleTextareaKeyDown}
                      onBlur={confirmEdit}
                      aria-label="Edit turn text"
                      rows={3}
                    />
                  ) : (
                    <p
                      className={styles.turnText}
                      onDoubleClick={() => startEdit(index)}
                    >
                      {references.length > 0
                        ? parseTextWithCitations(turn.text, references)
                        : turn.text}
                    </p>
                  )}
                </div>

                {/* Action buttons */}
                <div className={styles.turnActions}>
                  {isDeleting ? (
                    <div className={styles.deleteConfirm}>
                      <span>Delete?</span>
                      <button
                        type="button"
                        className={`${styles.deleteConfirmBtn} ${styles.deleteConfirmYes}`}
                        onClick={() => deleteTurn(index)}
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        className={`${styles.deleteConfirmBtn} ${styles.deleteConfirmNo}`}
                        onClick={() => setDeletingIndex(null)}
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <>
                      {!isEditing && (
                        <button
                          type="button"
                          className={styles.turnActionBtn}
                          onClick={() => startEdit(index)}
                          aria-label="Edit turn"
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                      {turns.length > 2 && (
                        <button
                          type="button"
                          className={`${styles.turnActionBtn} ${styles.turnActionBtnDanger}`}
                          onClick={() => setDeletingIndex(index)}
                          aria-label="Delete turn"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                      <button
                        type="button"
                        className={`${styles.turnActionBtn} ${turnComments[index]?.trim() ? styles.turnActionBtnActive : ''}`}
                        onClick={() => setCommentingIndex(commentingIndex === index ? null : index)}
                        aria-label={turnComments[index]?.trim() ? 'Edit comment' : 'Add comment'}
                      >
                        <MessageSquare size={14} />
                        {turnComments[index]?.trim() && (
                          <span className={styles.turnCommentBadge} />
                        )}
                      </button>
                      <ClaimFlagButton
                        podcastId={podcastId}
                        turnIndex={index}
                        turnText={turn.text}
                      />
                    </>
                  )}
                </div>
              </div>

              {/* Inline comment */}
              {(commentingIndex === index || turnComments[index]?.trim()) && (
                <div className={styles.turnComment}>
                  <textarea
                    className={styles.turnCommentInput}
                    value={turnComments[index] ?? ''}
                    onChange={(e) => setTurnComments((prev) => ({ ...prev, [index]: e.target.value }))}
                    placeholder={`Comment on this ${turn.speaker} turn...`}
                    rows={2}
                    maxLength={2000}
                    aria-label={`Comment on turn ${index + 1}`}
                    autoFocus={commentingIndex === index}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add turn */}
      <div className={styles.addTurnRow}>
        <button
          type="button"
          className={styles.addTurnBtn}
          onClick={addTurn}
        >
          <Plus size={16} />
          Add Turn
        </button>
      </div>

      {/* Feedback panel */}
      <div className={styles.feedbackPanel}>
        <button
          type="button"
          className={styles.feedbackToggle}
          onClick={() => setShowFeedbackPanel(!showFeedbackPanel)}
          aria-expanded={showFeedbackPanel}
        >
          {showFeedbackPanel ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          Notes for regeneration
          {(hasFeedback || hasComments) && !showFeedbackPanel && (
            <span className={styles.feedbackBadge}>
              {(hasFeedback ? 1 : 0) + Object.values(turnComments).filter((c) => c.trim()).length}
            </span>
          )}
        </button>
        {showFeedbackPanel && (
          <textarea
            className={styles.feedbackTextarea}
            value={generalFeedback}
            onChange={(e) => setGeneralFeedback(e.target.value)}
            placeholder="Describe what you'd like changed — tone, emphasis, missing topics, too technical, etc."
            rows={4}
            maxLength={5000}
            aria-label="General feedback for script regeneration"
          />
        )}
      </div>

      {/* Actions footer */}
      <footer className={styles.actions}>
        <button
          type="button"
          className={styles.saveBtn}
          onClick={saveDraft}
          disabled={!dirty || saving}
        >
          <Save size={16} />
          {saving ? 'Saving...' : 'Save Draft'}
        </button>
        <button
          type="button"
          className={styles.regenerateBtn}
          onClick={() => setShowRegenerateConfirm(true)}
          disabled={regenerating}
        >
          <RefreshCw size={16} />
          Regenerate Script
        </button>
        <button
          type="button"
          className={styles.approveBtn}
          onClick={handleApprove}
          disabled={approving || regenerating}
        >
          <Play size={16} />
          {approving ? 'Approving...' : 'Generate Audio'}
        </button>
      </footer>

      {/* Regenerate confirmation dialog */}
      {showRegenerateConfirm && (
        <div
          className={styles.confirmOverlay}
          onClick={() => setShowRegenerateConfirm(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="regen-title"
        >
          <div
            className={styles.confirmDialog}
            onClick={(e) => e.stopPropagation()}
          >
            <h4 id="regen-title" className={styles.confirmTitle}>
              Regenerate Script?
            </h4>
            {(hasFeedback || hasComments) ? (
              <>
                <p className={styles.confirmText}>
                  Regenerate using your notes, or start fresh from scratch?
                </p>
                <div className={styles.confirmActions}>
                  <button
                    type="button"
                    className={styles.confirmCancel}
                    onClick={() => setShowRegenerateConfirm(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.confirmSecondary}
                    onClick={() => handleRegenerate(false)}
                  >
                    From Scratch
                  </button>
                  <button
                    type="button"
                    className={styles.confirmConfirm}
                    onClick={() => handleRegenerate(true)}
                  >
                    Regenerate with Notes
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className={styles.confirmText}>
                  This will discard the current script and generate a new one from scratch.
                  This action cannot be undone.
                </p>
                <div className={styles.confirmActions}>
                  <button
                    type="button"
                    className={styles.confirmCancel}
                    onClick={() => setShowRegenerateConfirm(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.confirmConfirm}
                    onClick={() => handleRegenerate(false)}
                  >
                    Regenerate
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
