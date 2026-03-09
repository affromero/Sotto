'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SegmentNode } from './SegmentNode';
import { TransitionConnector } from './TransitionConnector';
import type { VideoPipeline, PipelineSegmentNode, PipelineTransition, FalModelsResponse } from '@/types/pipeline';
import { estimateSegmentCost, estimatePipelineCost, estimateTransitionCost, formatCost } from '@/lib/video-cost-estimator';
import { getSpeakerIndex, getUniqueSpeakers } from '@/lib/speaker-colors';
import styles from './PipelineEditor.module.css';

interface PipelineEditorProps {
  podcastId: string;
  podcastTitle: string;
  pipeline: VideoPipeline;
  falModels: FalModelsResponse;
  onApprove: (pipeline: VideoPipeline) => void;
  onCancel: () => void;
}

export function PipelineEditor({ pipeline, falModels, onApprove, onCancel }: PipelineEditorProps) {
  const [segments, setSegments] = useState<PipelineSegmentNode[]>(pipeline.segments);
  const [transitions, setTransitions] = useState<PipelineTransition[]>(pipeline.transitions ?? []);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const cardListRef = useRef<HTMLDivElement>(null);

  const allSpeakers = useMemo(() => getUniqueSpeakers(segments), [segments]);
  const enabledTransitions = useMemo(() => transitions.filter((t) => t.enabled), [transitions]);
  const totalCost = useMemo(
    () => estimatePipelineCost(segments, falModels.imageModels, falModels.videoModels, transitions),
    [segments, falModels.imageModels, falModels.videoModels, transitions],
  );
  const totalDuration = useMemo(
    () => segments.reduce((sum, s) => sum + s.duration, 0),
    [segments],
  );

  const handleSegmentUpdate = useCallback(
    (segmentId: string, updates: Partial<PipelineSegmentNode>) => {
      setSegments((prev) =>
        prev.map((seg) => {
          if (seg.segmentId !== segmentId) return seg;
          const updated = { ...seg, ...updates };
          updated.estimatedCost = estimateSegmentCost(updated, falModels.imageModels, falModels.videoModels);
          return updated;
        }),
      );
    },
    [falModels.imageModels, falModels.videoModels],
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

  const handleApprove = useCallback(() => {
    onApprove({
      ...pipeline,
      segments,
      transitions,
      totalEstimatedCost: estimatePipelineCost(segments, falModels.imageModels, falModels.videoModels, transitions),
    });
  }, [pipeline, segments, transitions, onApprove, falModels.imageModels, falModels.videoModels]);

  const toggleExpand = useCallback((segmentId: string) => {
    setExpandedId((prev) => (prev === segmentId ? null : segmentId));
  }, []);

  // Scroll expanded card into view
  useEffect(() => {
    if (!expandedId || !cardListRef.current) return;
    const card = cardListRef.current.querySelector(`[data-segment-id="${expandedId}"]`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [expandedId]);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <h3 className={styles.title}>Video Storyboard</h3>
      </div>

      <div className={styles.cardList} ref={cardListRef} role="list" aria-label="Video storyboard scenes">
        {segments.map((seg, i) => {
          const transition = transitions.find((t) => t.fromSegmentOrder === seg.order);
          return (
            <div key={seg.segmentId}>
              <div role="listitem" data-segment-id={seg.segmentId}>
                <SegmentNode
                  segment={seg}
                  index={i}
                  speakerIndex={getSpeakerIndex(seg.speaker, allSpeakers)}
                  imageModels={falModels.imageModels}
                  videoModels={falModels.videoModels}
                  hasFalKey={falModels.hasFalKey}
                  isExpanded={expandedId === seg.segmentId}
                  onToggleExpand={() => toggleExpand(seg.segmentId)}
                  onUpdate={handleSegmentUpdate}
                />
              </div>
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
        <p className={styles.approvalSummary}>
          {segments.length} scene{segments.length !== 1 ? 's' : ''}
          {enabledTransitions.length > 0 && ` · ${enabledTransitions.length} transition${enabledTransitions.length !== 1 ? 's' : ''}`}
          , ~{Math.ceil(totalDuration)}s video
          <br />
          <span className={styles.costLabel}>Free</span> · est. {formatCost(totalCost)} on us
        </p>
        <div className={styles.footerActions}>
          <button className={styles.cancelBtn} onClick={onCancel} type="button">
            Cancel
          </button>
          <button className={styles.approveBtn} onClick={handleApprove} type="button">
            Approve &amp; Render
          </button>
        </div>
      </div>
    </div>
  );
}
