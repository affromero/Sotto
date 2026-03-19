'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VideoEditorCard } from './VideoEditorCard';
import type { EditableSegmentVisual } from './VideoEditorCard';
import { TransitionConnector } from './TransitionConnector';
import type { SegmentVisualData } from '@/lib/segment-utils';
import type { SegmentData } from '@/types/podcast';
import type { FalModelsResponse, PipelineTransition } from '@/types/pipeline';
import type { VisualTypeString } from '@/lib/visual-classifier';
import type { VisualMode } from '@/types/pipeline';
import { estimateTransitionCost } from '@/lib/video-cost-estimator';
import { getSpeakerIndex, getUniqueSpeakers } from '@/lib/speaker-colors';
import styles from './VideoEditor.module.css';

interface TransitionData {
  id: string;
  fromSegmentOrder: number;
  toSegmentOrder: number;
  transitionModel: string | null;
  status: string;
  enabled: boolean;
  recommended: boolean;
  durationSeconds: number;
  cost: number | null;
}

interface VideoEditorProps {
  podcastId: string;
  segments: SegmentData[];
  segmentVisuals: SegmentVisualData[];
  falModels: FalModelsResponse;
  onRegenerate: (videoGenerationId: string) => void;
  onCancel: () => void;
}

function toEditable(visual: SegmentVisualData, segment: SegmentData): EditableSegmentVisual {
  return {
    segmentVisualId: visual.id,
    segmentId: visual.segmentId,
    speaker: segment.speaker,
    text: segment.text,
    duration: segment.duration ?? 0,
    order: visual.order,
    visualType: (visual.visualType as VisualTypeString) ?? 'TEXT_CARD',
    visualMode: (visual.visualMode as VisualMode) ?? 'image',
    model: visual.videoModel ?? null,
    prompt: visual.prompt ?? null,
    assetUrl: visual.assetUrl ?? null,
    assetType: visual.assetType ?? null,
    firstFrameUrl: visual.firstFrameUrl ?? null,
    status: visual.status,
    failureReason: visual.failureReason ?? null,
  };
}

function isDirty(current: EditableSegmentVisual, original: EditableSegmentVisual): boolean {
  return (
    current.visualType !== original.visualType ||
    current.visualMode !== original.visualMode ||
    current.model !== original.model ||
    current.prompt !== original.prompt
  );
}

function toPipelineTransition(t: TransitionData): PipelineTransition {
  return {
    fromSegmentOrder: t.fromSegmentOrder,
    toSegmentOrder: t.toSegmentOrder,
    fromSegmentId: '',
    toSegmentId: '',
    enabled: t.enabled,
    recommended: t.recommended,
    transitionModel: t.transitionModel,
    durationSeconds: t.durationSeconds,
    estimatedCost: t.cost ?? 0,
  };
}

export function VideoEditor({
  podcastId,
  segments,
  segmentVisuals,
  falModels,
  onRegenerate,
  onCancel,
}: VideoEditorProps) {
  const segmentMap = useMemo(() => {
    const map = new Map<string, SegmentData>();
    for (const s of segments) map.set(s.id, s);
    return map;
  }, [segments]);

  const originals = useMemo(() => {
    return segmentVisuals
      .map((sv) => {
        const seg = segmentMap.get(sv.segmentId);
        if (!seg) return null;
        return toEditable(sv, seg);
      })
      .filter((x): x is EditableSegmentVisual => x !== null);
  }, [segmentVisuals, segmentMap]);

  const [editedSegments, setEditedSegments] = useState<EditableSegmentVisual[]>(originals);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [transitions, setTransitions] = useState<PipelineTransition[]>([]);
  const cardListRef = useRef<HTMLDivElement>(null);

  // Reset when source data changes
  useEffect(() => {
    setEditedSegments(originals);
  }, [originals]);

  // Fetch transitions on mount
  useEffect(() => {
    let cancelled = false;
    async function fetchTransitions() {
      try {
        const res = await fetch(`/api/podcasts/${podcastId}/video`);
        if (!res.ok || cancelled) return;
        const json = await res.json() as { transitions?: TransitionData[] };
        if (cancelled || !json.transitions) return;
        setTransitions(json.transitions.map(toPipelineTransition));
      } catch {
        // Best-effort — transitions are optional in the editor
      }
    }
    void fetchTransitions();
    return () => { cancelled = true; };
  }, [podcastId]);

  const originalMap = useMemo(() => {
    const map = new Map<string, EditableSegmentVisual>();
    for (const o of originals) map.set(o.segmentVisualId, o);
    return map;
  }, [originals]);

  const allSpeakers = useMemo(() => getUniqueSpeakers(editedSegments), [editedSegments]);

  const dirtyIds = useMemo(() => {
    const ids = new Set<string>();
    for (const seg of editedSegments) {
      const orig = originalMap.get(seg.segmentVisualId);
      if (orig && isDirty(seg, orig)) ids.add(seg.segmentVisualId);
    }
    return ids;
  }, [editedSegments, originalMap]);

  const dirtyCount = dirtyIds.size;

  const handleSegmentUpdate = useCallback(
    (segmentVisualId: string, updates: Partial<EditableSegmentVisual>) => {
      setEditedSegments((prev) =>
        prev.map((seg) =>
          seg.segmentVisualId === segmentVisualId ? { ...seg, ...updates } : seg,
        ),
      );
    },
    [],
  );

  const handleReset = useCallback(
    (segmentVisualId: string) => {
      const orig = originalMap.get(segmentVisualId);
      if (!orig) return;
      setEditedSegments((prev) =>
        prev.map((seg) => (seg.segmentVisualId === segmentVisualId ? { ...orig } : seg)),
      );
    },
    [originalMap],
  );

  const handleTransitionUpdate = useCallback(
    (fromOrder: number, toOrder: number, updates: Partial<PipelineTransition>) => {
      setTransitions((prev) =>
        prev.map((t) => {
          if (t.fromSegmentOrder !== fromOrder || t.toSegmentOrder !== toOrder) return t;
          const updated = { ...t, ...updates };
          updated.estimatedCost = estimateTransitionCost(updated, falModels.videoModels);
          return updated;
        }),
      );
    },
    [falModels.videoModels],
  );

  const toggleExpand = useCallback((segmentVisualId: string) => {
    setExpandedId((prev) => (prev === segmentVisualId ? null : segmentVisualId));
  }, []);

  // Scroll expanded card into view
  useEffect(() => {
    if (!expandedId || !cardListRef.current) return;
    const card = cardListRef.current.querySelector(`[data-segment-id="${expandedId}"]`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [expandedId]);

  const enabledTransitions = useMemo(() => transitions.filter((t) => t.enabled), [transitions]);

  const submitRegeneration = useCallback(async (segmentIds: Set<string>) => {
    if (segmentIds.size === 0) return;
    setSubmitting(true);

    const changedSegments = editedSegments
      .filter((seg) => segmentIds.has(seg.segmentVisualId))
      .map((seg) => ({
        segmentVisualId: seg.segmentVisualId,
        visualType: seg.visualType,
        visualMode: seg.visualMode,
        model: seg.model,
        prompt: seg.prompt,
      }));

    try {
      const res = await fetch(`/api/podcasts/${podcastId}/video`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segments: changedSegments }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || 'Failed to update segments');
      }

      const data = await res.json() as { videoGenerationId: string };
      onRegenerate(data.videoGenerationId);
    } catch {
      setSubmitting(false);
    }
  }, [podcastId, editedSegments, onRegenerate]);

  const handleRegenerate = useCallback(async () => {
    if (dirtyCount === 0) return;
    await submitRegeneration(dirtyIds);
  }, [dirtyCount, dirtyIds, submitRegeneration]);

  const handleRegenerateAll = useCallback(async () => {
    await submitRegeneration(new Set(editedSegments.map((seg) => seg.segmentVisualId)));
  }, [editedSegments, submitRegeneration]);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <h3 className={styles.title}>Edit Storyboard</h3>
        <span className={styles.headerHint}>
          {editedSegments.length} scene{editedSegments.length !== 1 ? 's' : ''}
          {enabledTransitions.length > 0 && ` · ${enabledTransitions.length} transition${enabledTransitions.length !== 1 ? 's' : ''}`}
          {' '}— click to edit
        </span>
      </div>

      <div className={styles.cardList} ref={cardListRef} role="list" aria-label="Video storyboard scenes">
        {editedSegments.map((seg, i) => {
          const transition = transitions.find((t) => t.fromSegmentOrder === seg.order);
          return (
            <div key={seg.segmentVisualId} role="listitem" data-segment-id={seg.segmentVisualId}>
              <VideoEditorCard
                segment={seg}
                original={originalMap.get(seg.segmentVisualId)!}
                index={i}
                speakerIndex={getSpeakerIndex(seg.speaker, allSpeakers)}
                imageModels={falModels.imageModels}
                videoModels={falModels.videoModels}
                defaultImageModel={falModels.defaultImageModel}
                defaultVideoModel={falModels.defaultVideoModel}
                hasFalKey={falModels.hasFalKey}
                isExpanded={expandedId === seg.segmentVisualId}
                isDirty={dirtyIds.has(seg.segmentVisualId)}
                onToggleExpand={() => toggleExpand(seg.segmentVisualId)}
                onUpdate={handleSegmentUpdate}
                onReset={handleReset}
              />
              {transition && (
                <TransitionConnector
                  transition={transition}
                  videoModels={falModels.videoModels}
                  onUpdate={handleTransitionUpdate}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className={styles.footer}>
        <p className={styles.footerSummary}>
          {dirtyCount > 0 ? (
            <>
              <span className={styles.dirtyCount}>{dirtyCount}</span>
              {' '}segment{dirtyCount !== 1 ? 's' : ''} modified
            </>
          ) : (
            'No changes'
          )}
        </p>
        <div className={styles.footerActions}>
          <button
            className={styles.cancelBtn}
            onClick={onCancel}
            type="button"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            className={styles.regenerateAllBtn}
            onClick={handleRegenerateAll}
            type="button"
            disabled={editedSegments.length === 0 || submitting}
          >
            {submitting ? 'Submitting...' : 'Regenerate Everything'}
          </button>
          <button
            className={styles.regenerateBtn}
            onClick={handleRegenerate}
            type="button"
            disabled={dirtyCount === 0 || submitting}
          >
            {submitting ? 'Submitting...' : `Regenerate (${dirtyCount})`}
          </button>
        </div>
      </div>
    </div>
  );
}
