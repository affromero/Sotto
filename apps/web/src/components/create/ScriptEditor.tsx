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
  X,
  ExternalLink,
} from 'lucide-react';
import { parseTextWithCitations } from '@/lib/citation-parser';
import { getSpeakerIndex, getUniqueSpeakers } from '@/lib/speaker-colors';
import type { ScriptTurn } from '@/lib/script-generator';
import type { ReferenceData } from '@/types/reference';
import { wordsToMinutes } from '@/lib/duration';
import styles from './ScriptEditor.module.css';

interface Highlight {
  turnIndex: number;
  text: string;
  note: string;
}

interface SelectionPopover {
  turnIndex: number;
  text: string;
  top: number;
  left: number;
}

interface ScriptEditorProps {
  episodeId: string;
  onApprove: () => void;
  onRegenerate: () => void;
  getApproveBody?: () => Record<string, unknown>;
}

interface TurnState extends ScriptTurn {
  id: string; // Stable key for React
}

let turnIdCounter = 0;
function nextTurnId(): string {
  return `turn-${++turnIdCounter}`;
}

export function ScriptEditor({
  episodeId,
  onApprove,
  onRegenerate,
  getApproveBody,
}: ScriptEditorProps) {
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
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [selectionPopover, setSelectionPopover] = useState<SelectionPopover | null>(null);
  const [highlightNoteInput, setHighlightNoteInput] = useState('');
  const [showReferences, setShowReferences] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const savedTurnsRef = useRef<TurnState[]>([]);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch script data
  useEffect(() => {
    let mounted = true;
    async function fetchScript() {
      try {
        const res = await fetch(`/api/v1/episodes/${episodeId}/script`);
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
    return () => {
      mounted = false;
    };
  }, [episodeId]);

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
  const hasHighlights = highlights.length > 0;
  useEffect(() => {
    if (!dirty && !hasFeedback && !hasComments && !hasHighlights) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty, hasFeedback, hasComments, hasHighlights]);

  // Stats
  const stats = useMemo(() => {
    const wordCount = turns.reduce((sum, t) => sum + t.text.split(/\s+/).filter(Boolean).length, 0);
    const estimatedMinutes = Math.round(wordsToMinutes(wordCount));
    return { wordCount, estimatedMinutes, turnCount: turns.length, refCount: references.length };
  }, [turns, references]);

  // Save draft
  const saveDraft = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/episodes/${episodeId}/script`, {
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
  }, [episodeId, turns, saving]);

  // Edit mode handlers
  const startEdit = useCallback(
    (index: number) => {
      setEditingIndex(index);
      setEditText(turns[index].text);
      setEditDirection(turns[index].direction ?? '');
      setDeletingIndex(null);
      // Focus textarea after render
      setTimeout(() => textareaRef.current?.focus(), 0);
    },
    [turns]
  );

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
  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelEdit();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        confirmEdit();
      }
    },
    [cancelEdit, confirmEdit]
  );

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
  const deleteTurn = useCallback(
    (index: number) => {
      setTurns((prev) => {
        if (prev.length <= 2) return prev;
        return prev.filter((_, i) => i !== index);
      });
      setDirty(true);
      setDeletingIndex(null);
      if (editingIndex === index) setEditingIndex(null);
    },
    [editingIndex]
  );

  // Add turn and pick the next speaker in rotation.
  const addTurn = useCallback(() => {
    const speakers = getUniqueSpeakers(turns);
    const lastSpeaker =
      turns.length > 0
        ? turns[turns.length - 1].speaker
        : (speakers[speakers.length - 1] ?? 'Host');
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
        const res = await fetch(`/api/v1/episodes/${episodeId}/script`, {
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

      const extraBody = getApproveBody ? getApproveBody() : {};
      const res = await fetch(`/api/v1/episodes/${episodeId}/script/approve`, {
        method: 'POST',
        ...(Object.keys(extraBody).length > 0
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(extraBody) }
          : {}),
      });
      if (!res.ok) throw new Error('Failed to approve script');
      onApprove();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve');
      setApproving(false);
    }
  }, [dirty, turns, episodeId, onApprove, getApproveBody]);

  // Regenerate (with optional feedback)
  const handleRegenerate = useCallback(
    async (withFeedback = false) => {
      setRegenerating(true);
      setShowRegenerateConfirm(false);
      try {
        const feedbackText = generalFeedback.trim();
        // Filter to only non-empty comments
        const filteredComments: Record<number, string> = {};
        for (const [k, v] of Object.entries(turnComments)) {
          if (v.trim()) filteredComments[Number(k)] = v.trim();
        }
        const hasAnyFeedback =
          feedbackText || Object.keys(filteredComments).length > 0 || highlights.length > 0;
        const shouldSendBody = withFeedback && hasAnyFeedback;
        const res = await fetch(`/api/v1/episodes/${episodeId}/script/regenerate`, {
          method: 'POST',
          ...(shouldSendBody
            ? {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  ...(feedbackText ? { feedback: feedbackText } : {}),
                  ...(Object.keys(filteredComments).length > 0
                    ? { turnComments: filteredComments }
                    : {}),
                  ...(highlights.length > 0
                    ? {
                        highlights: highlights.map(({ turnIndex, text, note }) => ({
                          turnIndex,
                          text,
                          note,
                        })),
                      }
                    : {}),
                }),
              }
            : {}),
        });
        if (!res.ok) throw new Error('Failed to regenerate');
        onRegenerate();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to regenerate');
        setRegenerating(false);
      }
    },
    [episodeId, onRegenerate, generalFeedback, turnComments, highlights]
  );

  // Text selection for highlighting (desktop only)
  const handleTurnTextMouseUp = useCallback((index: number) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      return;
    }
    const selectedText = selection.toString().trim();
    if (selectedText.length < 2) return; // Ignore single char selections

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const rootRect = rootRef.current?.getBoundingClientRect();
    if (!rootRect) return;

    setSelectionPopover({
      turnIndex: index,
      text: selectedText,
      top: rect.top - rootRect.top - 40, // Position above selection
      left: rect.left - rootRect.left + rect.width / 2,
    });
    setHighlightNoteInput('');
  }, []);

  const addHighlight = useCallback(() => {
    if (!selectionPopover || !highlightNoteInput.trim()) return;
    setHighlights((prev) => [
      ...prev,
      {
        turnIndex: selectionPopover.turnIndex,
        text: selectionPopover.text,
        note: highlightNoteInput.trim(),
      },
    ]);
    setSelectionPopover(null);
    setHighlightNoteInput('');
    window.getSelection()?.removeAllRanges();
  }, [selectionPopover, highlightNoteInput]);

  const removeHighlight = useCallback((index: number) => {
    setHighlights((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Dismiss selection popover on click outside or Escape
  useEffect(() => {
    if (!selectionPopover) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setSelectionPopover(null);
    }
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest(`.${styles.highlightPopover}`)) {
        setSelectionPopover(null);
      }
    }
    document.addEventListener('keydown', handleKey);
    // Delay adding click listener to avoid immediately dismissing
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClick), 100);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClick);
      clearTimeout(timer);
    };
  }, [selectionPopover]);

  // Render turn text with highlights applied
  const renderTurnText = useCallback(
    (turnIndex: number, text: string) => {
      const turnHighlights = highlights.filter((h) => h.turnIndex === turnIndex);
      if (turnHighlights.length === 0) {
        return references.length > 0 ? parseTextWithCitations(text, references) : text;
      }

      // Build segments by splitting text at highlighted substrings
      type Segment = { text: string; highlight?: Highlight };
      const segments: Segment[] = [];
      let offset = 0;

      // Sort highlights by position in text
      const positioned = turnHighlights
        .map((h) => ({ ...h, pos: text.indexOf(h.text, 0) }))
        .filter((h) => h.pos !== -1)
        .sort((a, b) => a.pos - b.pos);

      for (const h of positioned) {
        const pos = text.indexOf(h.text, offset);
        if (pos === -1) continue;
        if (pos > offset) {
          segments.push({ text: text.slice(offset, pos) });
        }
        segments.push({ text: h.text, highlight: h });
        offset = pos + h.text.length;
      }
      if (offset < text.length) {
        segments.push({ text: text.slice(offset) });
      }

      return segments.map((seg, i) => {
        const content =
          references.length > 0 ? parseTextWithCitations(seg.text, references) : seg.text;

        if (seg.highlight) {
          return (
            <mark key={i} className={styles.highlightedText} title={seg.highlight.note}>
              {content}
              <span className={styles.annotationBadge} aria-label="Has annotation">
                {highlights.filter((h) => h.turnIndex === turnIndex).indexOf(seg.highlight) + 1}
              </span>
            </mark>
          );
        }
        return <span key={i}>{content}</span>;
      });
    },
    [highlights, references]
  );

  // Drag and drop handlers
  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  }, []);

  const handleDrop = useCallback(
    (index: number) => {
      if (dragIndex !== null && dragIndex !== index) {
        moveTurn(dragIndex, index);
      }
      setDragIndex(null);
      setDragOverIndex(null);
    },
    [dragIndex, moveTurn]
  );

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
    <div className={styles.root} ref={rootRef}>
      {/* Header with stats */}
      <header className={styles.header}>
        <h3 className={styles.title}>Script Preview</h3>
        <div className={styles.stats}>
          <span className={styles.statItem}>{stats.wordCount.toLocaleString()} words</span>
          <span className={styles.statDivider} aria-hidden="true" />
          <span className={styles.statItem}>~{stats.estimatedMinutes} min</span>
          <span className={styles.statDivider} aria-hidden="true" />
          <span className={styles.statItem}>{stats.turnCount} turns</span>
          {stats.refCount > 0 && (
            <>
              <span className={styles.statDivider} aria-hidden="true" />
              <span className={styles.statItem}>{stats.refCount} references</span>
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
        <div className={styles.error} role="alert">
          {error}
        </div>
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
              ]
                .filter(Boolean)
                .join(' ')}
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
                    turn.direction && <span className={styles.direction}>({turn.direction})</span>
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
                      onMouseUp={() => handleTurnTextMouseUp(index)}
                    >
                      {renderTurnText(index, turn.text)}
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
                          title="Edit turn"
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
                          title="Delete turn"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                      <button
                        type="button"
                        className={`${styles.turnActionBtn} ${turnComments[index]?.trim() ? styles.turnActionBtnActive : ''}`}
                        onClick={() => setCommentingIndex(commentingIndex === index ? null : index)}
                        aria-label={turnComments[index]?.trim() ? 'Edit comment' : 'Add comment'}
                        title={turnComments[index]?.trim() ? 'Edit comment' : 'Add comment'}
                      >
                        <MessageSquare size={14} />
                        {turnComments[index]?.trim() && (
                          <span className={styles.turnCommentBadge} />
                        )}
                      </button>
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
                    onChange={(e) =>
                      setTurnComments((prev) => ({ ...prev, [index]: e.target.value }))
                    }
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

      {/* Selection popover for highlighting */}
      {selectionPopover && (
        <div
          className={styles.highlightPopover}
          style={{
            top: selectionPopover.top,
            left: Math.max(
              16,
              Math.min(selectionPopover.left - 120, (rootRef.current?.clientWidth ?? 400) - 256)
            ),
          }}
        >
          <div className={styles.highlightPopoverQuote}>
            &ldquo;
            {selectionPopover.text.length > 60
              ? selectionPopover.text.slice(0, 60) + '...'
              : selectionPopover.text}
            &rdquo;
          </div>
          <input
            className={styles.highlightNoteInput}
            value={highlightNoteInput}
            onChange={(e) => setHighlightNoteInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && highlightNoteInput.trim()) addHighlight();
              if (e.key === 'Escape') setSelectionPopover(null);
            }}
            placeholder="Add a note about this text..."
            maxLength={2000}
            autoFocus
          />
          <div className={styles.highlightPopoverActions}>
            <button
              type="button"
              className={styles.highlightPopoverCancel}
              onClick={() => setSelectionPopover(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.highlightPopoverSave}
              onClick={addHighlight}
              disabled={!highlightNoteInput.trim()}
            >
              Add Note
            </button>
          </div>
        </div>
      )}

      {/* Add turn */}
      <div className={styles.addTurnRow}>
        <button type="button" className={styles.addTurnBtn} onClick={addTurn}>
          <Plus size={16} />
          Add Turn
        </button>
      </div>

      {/* References section */}
      {references.length > 0 && (
        <div className={styles.referencesPanel}>
          <button
            type="button"
            className={styles.feedbackToggle}
            onClick={() => setShowReferences(!showReferences)}
            aria-expanded={showReferences}
          >
            {showReferences ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            References ({references.length})
          </button>
          {showReferences && (
            <ol className={styles.referencesList} aria-label="Script references">
              {references
                .slice()
                .sort((a, b) => a.number - b.number)
                .map((ref) => (
                  <li key={ref.id} className={styles.referenceItem}>
                    <div className={styles.referenceHeader}>
                      <span className={styles.referenceNumber}>[{ref.number}]</span>
                      <span className={styles.referenceType}>{ref.type}</span>
                    </div>
                    <p className={styles.referenceTitle}>{ref.title}</p>
                    {ref.authors.length > 0 && (
                      <p className={styles.referenceAuthors}>{ref.authors.join(', ')}</p>
                    )}
                    {(ref.year || ref.publisher) && (
                      <p className={styles.referenceMeta}>
                        {ref.year && <span>{ref.year}</span>}
                        {ref.year && ref.publisher && <span> &middot; </span>}
                        {ref.publisher && <span>{ref.publisher}</span>}
                      </p>
                    )}
                    {ref.url && (
                      <a
                        href={ref.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.referenceLink}
                      >
                        View source <ExternalLink size={12} />
                      </a>
                    )}
                  </li>
                ))}
            </ol>
          )}
        </div>
      )}

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
          {(hasFeedback || hasComments || hasHighlights) && !showFeedbackPanel && (
            <span className={styles.feedbackBadge}>
              {(hasFeedback ? 1 : 0) +
                Object.values(turnComments).filter((c) => c.trim()).length +
                highlights.length}
            </span>
          )}
        </button>
        {showFeedbackPanel && (
          <>
            <textarea
              className={styles.feedbackTextarea}
              value={generalFeedback}
              onChange={(e) => setGeneralFeedback(e.target.value)}
              placeholder="Describe what you'd like changed: tone, emphasis, missing topics, too technical, etc."
              rows={4}
              maxLength={5000}
              aria-label="General feedback for script regeneration"
            />
            {highlights.length > 0 && (
              <div className={styles.highlightsList}>
                <span className={styles.highlightsLabel}>
                  Text annotations ({highlights.length})
                </span>
                {highlights.map((h, i) => (
                  <div key={i} className={styles.highlightItem}>
                    <div className={styles.highlightItemText}>
                      <span className={styles.highlightItemQuote}>
                        &ldquo;{h.text.length > 40 ? h.text.slice(0, 40) + '...' : h.text}&rdquo;
                      </span>
                      <span className={styles.highlightItemNote}>{h.note}</span>
                    </div>
                    <button
                      type="button"
                      className={styles.highlightItemRemove}
                      onClick={() => removeHighlight(i)}
                      aria-label="Remove annotation"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
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
          <div className={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
            <h4 id="regen-title" className={styles.confirmTitle}>
              Regenerate Script?
            </h4>
            {hasFeedback || hasComments || hasHighlights ? (
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
                  This will discard the current script and generate a new one from scratch. This
                  action cannot be undone.
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
