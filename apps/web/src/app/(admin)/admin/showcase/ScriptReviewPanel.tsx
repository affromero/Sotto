'use client';

import { useState, useCallback, useEffect } from 'react';
import styles from './ScriptReviewPanel.module.css';

interface ScriptTurn {
  speaker: string;
  text: string;
  direction?: string;
}

interface ScriptReviewPanelProps {
  podcastId: string;
  podcastStatus: string;
  onStatusChange: () => void;
}

type PanelStatus = 'idle' | 'loading' | 'saving' | 'approving' | 'regenerating' | 'success' | 'error';

export function ScriptReviewPanel({ podcastId, podcastStatus, onStatusChange }: ScriptReviewPanelProps) {
  const [turns, setTurns] = useState<ScriptTurn[]>([]);
  const [version, setVersion] = useState<number>(0);
  const [panelStatus, setPanelStatus] = useState<PanelStatus>('idle');
  const [message, setMessage] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const isEditable = podcastStatus === 'SCRIPT_READY';

  // Fetch script turns
  const fetchScript = useCallback(async () => {
    setPanelStatus('loading');
    setMessage('');
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/script`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? 'Failed to load script');
      }
      const data = await res.json();
      setTurns(data.turns ?? []);
      setVersion(data.version ?? 0);
      setPanelStatus('idle');
      setHasUnsavedChanges(false);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to load script');
      setPanelStatus('error');
    }
  }, [podcastId]);

  useEffect(() => {
    if (podcastId) {
      fetchScript();
    }
  }, [podcastId, fetchScript]);

  // Update a turn's text
  const updateTurnText = useCallback((index: number, text: string) => {
    setTurns((prev) => prev.map((t, i) => (i === index ? { ...t, text } : t)));
    setHasUnsavedChanges(true);
  }, []);

  // Update a turn's speaker
  const updateTurnSpeaker = useCallback((index: number, speaker: string) => {
    setTurns((prev) => prev.map((t, i) => (i === index ? { ...t, speaker } : t)));
    setHasUnsavedChanges(true);
  }, []);

  // Update a turn's direction
  const updateTurnDirection = useCallback((index: number, direction: string) => {
    setTurns((prev) => prev.map((t, i) => (i === index ? { ...t, direction: direction || undefined } : t)));
    setHasUnsavedChanges(true);
  }, []);

  // Delete a turn
  const deleteTurn = useCallback((index: number) => {
    setTurns((prev) => prev.filter((_, i) => i !== index));
    setHasUnsavedChanges(true);
    setEditingIndex(null);
  }, []);

  // Save edited script
  const saveScript = useCallback(async () => {
    if (!isEditable) return;
    setPanelStatus('saving');
    setMessage('');
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/script`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turns }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? 'Save failed');
      }
      const data = await res.json();
      setTurns(data.turns ?? turns);
      setVersion(data.version ?? version);
      setMessage('Script saved');
      setPanelStatus('success');
      setHasUnsavedChanges(false);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Save failed');
      setPanelStatus('error');
    }
  }, [podcastId, turns, version, isEditable]);

  // Approve script (creates segments, queues audio)
  const approveScript = useCallback(async () => {
    if (!isEditable) return;
    if (hasUnsavedChanges) {
      setMessage('Save changes before approving');
      setPanelStatus('error');
      return;
    }
    setPanelStatus('approving');
    setMessage('');
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/script/approve`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? 'Approve failed');
      }
      setMessage('Script approved — audio generation started');
      setPanelStatus('success');
      onStatusChange();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Approve failed');
      setPanelStatus('error');
    }
  }, [podcastId, isEditable, hasUnsavedChanges, onStatusChange]);

  // Regenerate script
  const regenerateScript = useCallback(async () => {
    if (!isEditable) return;
    setPanelStatus('regenerating');
    setMessage('');
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/script/regenerate`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? 'Regenerate failed');
      }
      setMessage('Script regeneration started');
      setPanelStatus('success');
      onStatusChange();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Regenerate failed');
      setPanelStatus('error');
    }
  }, [podcastId, isEditable, onStatusChange]);

  const isBusy = panelStatus === 'saving' || panelStatus === 'approving' || panelStatus === 'regenerating';

  if (panelStatus === 'loading') {
    return (
      <div className={styles.root}>
        <div className={styles.loadingState} role="status">
          <span className={styles.spinner} />
          Loading script...
        </div>
      </div>
    );
  }

  if (turns.length === 0 && panelStatus !== 'error') {
    return (
      <div className={styles.root}>
        <p className={styles.emptyState}>No script turns found. The script may still be generating.</p>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.turnCount}>{turns.length} turns</span>
        <span className={styles.versionBadge}>v{version}</span>
        {hasUnsavedChanges && <span className={styles.unsavedBadge}>Unsaved changes</span>}
      </div>

      <div className={styles.turnList} role="list" aria-label="Script turns">
        {turns.map((turn, index) => (
          <div
            key={index}
            className={styles.turnCard}
            role="listitem"
            data-editing={editingIndex === index}
          >
            <div className={styles.turnHeader}>
              <span className={styles.turnIndex}>#{index + 1}</span>
              {editingIndex === index ? (
                <input
                  type="text"
                  className={styles.speakerInput}
                  value={turn.speaker}
                  onChange={(e) => updateTurnSpeaker(index, e.target.value)}
                  aria-label={`Speaker name for turn ${index + 1}`}
                  maxLength={50}
                />
              ) : (
                <span className={styles.speakerLabel}>{turn.speaker}</span>
              )}
              {turn.direction && editingIndex !== index && (
                <span className={styles.directionBadge}>{turn.direction}</span>
              )}
              <div className={styles.turnActions}>
                {isEditable && (
                  <>
                    <button
                      type="button"
                      className={styles.btnIcon}
                      onClick={() => setEditingIndex(editingIndex === index ? null : index)}
                      aria-label={editingIndex === index ? 'Done editing' : `Edit turn ${index + 1}`}
                    >
                      {editingIndex === index ? 'Done' : 'Edit'}
                    </button>
                    {editingIndex === index && turns.length > 1 && (
                      <button
                        type="button"
                        className={styles.btnIconDanger}
                        onClick={() => deleteTurn(index)}
                        aria-label={`Delete turn ${index + 1}`}
                      >
                        Delete
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {editingIndex === index ? (
              <div className={styles.editFields}>
                <textarea
                  className={styles.turnTextarea}
                  value={turn.text}
                  onChange={(e) => updateTurnText(index, e.target.value)}
                  aria-label={`Text for turn ${index + 1}`}
                  rows={4}
                  maxLength={10000}
                />
                <input
                  type="text"
                  className={styles.directionInput}
                  value={turn.direction ?? ''}
                  onChange={(e) => updateTurnDirection(index, e.target.value)}
                  placeholder="Direction (e.g. laughing, whispering)"
                  aria-label={`Direction for turn ${index + 1}`}
                  maxLength={50}
                />
              </div>
            ) : (
              <p className={styles.turnText}>{turn.text}</p>
            )}
          </div>
        ))}
      </div>

      {isEditable && (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={saveScript}
            disabled={isBusy || !hasUnsavedChanges}
          >
            {panelStatus === 'saving' ? 'Saving...' : 'Save Changes'}
          </button>
          <button
            type="button"
            className={styles.btnSuccess}
            onClick={approveScript}
            disabled={isBusy || hasUnsavedChanges}
          >
            {panelStatus === 'approving' ? 'Approving...' : 'Approve & Generate Audio'}
          </button>
          <button
            type="button"
            className={styles.btnGhost}
            onClick={regenerateScript}
            disabled={isBusy}
          >
            {panelStatus === 'regenerating' ? 'Regenerating...' : 'Regenerate Script'}
          </button>
        </div>
      )}

      {!isEditable && (
        <div className={styles.readOnlyNotice} role="status">
          Script is read-only — status must be SCRIPT_READY to edit.
        </div>
      )}

      {message && (
        <div
          className={styles.banner}
          data-variant={panelStatus === 'error' ? 'error' : 'success'}
          role="alert"
        >
          {message}
        </div>
      )}
    </div>
  );
}
