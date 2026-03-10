'use client';

import { useState, useCallback, useEffect } from 'react';
import type {
  VideoPipeline,
  PipelineSegmentNode,
  PipelineTransition,
  FalImageModelInfo,
  FalVideoModelInfo,
} from '@/types/pipeline';
import type { VisualMode } from '@/types/pipeline';
import styles from './VisualPipelinePanel.module.css';

const VISUAL_TYPE_LABELS: Record<string, string> = {
  AI_ILLUSTRATION: 'AI Illustration',
  STOCK_FOOTAGE: 'Stock Footage',
  DATA_CHART: 'Data Chart',
  QUOTE: 'Quote',
  COMPARISON: 'Comparison',
  TIMELINE: 'Timeline',
  DIAGRAM: 'Diagram',
  TEXT_CARD: 'Text Card',
  MAP_OVERLAY: 'Map Overlay',
};

const VISUAL_TYPES = Object.keys(VISUAL_TYPE_LABELS);

const VISUAL_MODE_OPTIONS: { value: VisualMode; label: string }[] = [
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Video' },
  { value: 'programmatic', label: 'Programmatic' },
];

interface VisualPipelinePanelProps {
  podcastId: string;
}

type PanelStatus = 'idle' | 'classifying' | 'validating' | 'success' | 'error';

export function VisualPipelinePanel({ podcastId }: VisualPipelinePanelProps) {
  const [pipeline, setPipeline] = useState<VideoPipeline | null>(null);
  const [imageModels, setImageModels] = useState<FalImageModelInfo[]>([]);
  const [videoModels, setVideoModels] = useState<FalVideoModelInfo[]>([]);
  const [panelStatus, setPanelStatus] = useState<PanelStatus>('idle');
  const [message, setMessage] = useState('');
  const [expandedSegment, setExpandedSegment] = useState<string | null>(null);

  // Fetch available models on mount
  useEffect(() => {
    async function loadModels() {
      try {
        const res = await fetch('/api/fal-models');
        if (!res.ok) return;
        const data = await res.json();
        setImageModels(data.imageModels ?? []);
        setVideoModels(data.videoModels ?? []);
      } catch {
        // Non-critical — models will show IDs instead of names
      }
    }
    loadModels();
  }, []);

  // Classify visuals — creates pipeline
  const classifyVisuals = useCallback(async () => {
    setPanelStatus('classifying');
    setMessage('');
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/video/pipeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? 'Classification failed');
      }
      const data: VideoPipeline = await res.json();
      setPipeline(data);
      setMessage(`Pipeline created: ${data.segments.length} segments, $${data.totalEstimatedCost.toFixed(2)} estimated`);
      setPanelStatus('success');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Classification failed');
      setPanelStatus('error');
    }
  }, [podcastId]);

  // Validate pipeline — recalculate costs
  const validatePipeline = useCallback(async () => {
    if (!pipeline) return;
    setPanelStatus('validating');
    setMessage('');
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/video/pipeline`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pipeline),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? 'Validation failed');
      }
      const data: VideoPipeline = await res.json();
      setPipeline(data);
      setMessage(`Pipeline validated: $${data.totalEstimatedCost.toFixed(2)} estimated`);
      setPanelStatus('success');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Validation failed');
      setPanelStatus('error');
    }
  }, [podcastId, pipeline]);

  // Update a segment field
  const updateSegment = useCallback((segmentId: string, updates: Partial<PipelineSegmentNode>) => {
    setPipeline((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        segments: prev.segments.map((s) =>
          s.segmentId === segmentId ? { ...s, ...updates } : s
        ),
      };
    });
  }, []);

  // Update a transition field
  const updateTransition = useCallback((fromOrder: number, toOrder: number, updates: Partial<PipelineTransition>) => {
    setPipeline((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        transitions: (prev.transitions ?? []).map((t) =>
          t.fromSegmentOrder === fromOrder && t.toSegmentOrder === toOrder
            ? { ...t, ...updates }
            : t
        ),
      };
    });
  }, []);

  const getModelName = useCallback((modelId: string | null, mode: VisualMode): string => {
    if (!modelId) return 'None';
    if (mode === 'image') {
      const found = imageModels.find((m) => m.modelId === modelId);
      return found?.displayName ?? modelId;
    }
    const found = videoModels.find((m) => m.modelId === modelId);
    return found?.displayName ?? modelId;
  }, [imageModels, videoModels]);

  const isBusy = panelStatus === 'classifying' || panelStatus === 'validating';

  // No pipeline yet — show classify button
  if (!pipeline) {
    return (
      <div className={styles.root}>
        <div className={styles.emptyState}>
          <p className={styles.emptyText}>
            Classify segment visuals to build a video pipeline. This uses AI to determine the best
            visual type for each segment.
          </p>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={classifyVisuals}
            disabled={isBusy}
          >
            {panelStatus === 'classifying' ? 'Classifying...' : 'Classify Visuals'}
          </button>
        </div>

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

  return (
    <div className={styles.root}>
      {/* Pipeline summary */}
      <div className={styles.pipelineSummary}>
        <span className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Segments</span>
          <span className={styles.summaryValue}>{pipeline.segments.length}</span>
        </span>
        <span className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Transitions</span>
          <span className={styles.summaryValue}>
            {(pipeline.transitions ?? []).filter((t) => t.enabled).length}
          </span>
        </span>
        <span className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Estimated Cost</span>
          <span className={styles.summaryCost}>${pipeline.totalEstimatedCost.toFixed(2)}</span>
        </span>
      </div>

      {/* Segment editors */}
      <div className={styles.segmentList} role="list" aria-label="Visual pipeline segments">
        {pipeline.segments.map((seg, index) => {
          const isExpanded = expandedSegment === seg.segmentId;
          const transition = (pipeline.transitions ?? []).find(
            (t) => t.fromSegmentOrder === seg.order
          );

          return (
            <div key={seg.segmentId}>
              <div className={styles.segmentCard} role="listitem">
                <button
                  type="button"
                  className={styles.segmentHeaderBtn}
                  onClick={() => setExpandedSegment(isExpanded ? null : seg.segmentId)}
                  aria-expanded={isExpanded}
                  aria-label={`Segment ${seg.order}: ${seg.speaker}`}
                >
                  <span className={styles.segmentOrder}>#{seg.order}</span>
                  <span className={styles.segmentSpeaker}>{seg.speaker}</span>
                  <span
                    className={styles.visualTypeBadge}
                    data-type={seg.visualType}
                  >
                    {VISUAL_TYPE_LABELS[seg.visualType] ?? seg.visualType}
                  </span>
                  <span className={styles.modeBadge} data-mode={seg.visualMode}>
                    {seg.visualMode}
                  </span>
                  <span className={styles.segmentCost}>
                    ${seg.estimatedCost.toFixed(3)}
                  </span>
                  <span className={styles.expandIcon} data-expanded={isExpanded}>
                    {isExpanded ? '\u25B2' : '\u25BC'}
                  </span>
                </button>

                {isExpanded && (
                  <div className={styles.segmentEditor}>
                    <p className={styles.segmentPreview}>
                      {seg.text.length > 200 ? `${seg.text.slice(0, 200)}...` : seg.text}
                    </p>

                    <div className={styles.editorGrid}>
                      {/* Visual type */}
                      <div className={styles.editorField}>
                        <label className={styles.editorLabel} htmlFor={`vtype-${seg.segmentId}`}>
                          Visual Type
                        </label>
                        <select
                          id={`vtype-${seg.segmentId}`}
                          className={styles.editorSelect}
                          value={seg.visualType}
                          onChange={(e) => updateSegment(seg.segmentId, {
                            visualType: e.target.value as PipelineSegmentNode['visualType'],
                          })}
                          aria-label={`Visual type for segment ${seg.order}`}
                        >
                          {VISUAL_TYPES.map((vt) => (
                            <option key={vt} value={vt}>{VISUAL_TYPE_LABELS[vt]}</option>
                          ))}
                        </select>
                      </div>

                      {/* Visual mode */}
                      <div className={styles.editorField}>
                        <label className={styles.editorLabel} htmlFor={`vmode-${seg.segmentId}`}>
                          Visual Mode
                        </label>
                        <select
                          id={`vmode-${seg.segmentId}`}
                          className={styles.editorSelect}
                          value={seg.visualMode}
                          onChange={(e) => updateSegment(seg.segmentId, {
                            visualMode: e.target.value as VisualMode,
                          })}
                          aria-label={`Visual mode for segment ${seg.order}`}
                        >
                          {VISUAL_MODE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>

                      {/* Model selector */}
                      {seg.visualMode !== 'programmatic' && (
                        <div className={styles.editorField}>
                          <label className={styles.editorLabel} htmlFor={`model-${seg.segmentId}`}>
                            Model
                          </label>
                          <select
                            id={`model-${seg.segmentId}`}
                            className={styles.editorSelect}
                            value={seg.model ?? ''}
                            onChange={(e) => updateSegment(seg.segmentId, {
                              model: e.target.value || null,
                            })}
                            aria-label={`Model for segment ${seg.order}`}
                          >
                            <option value="">Default ({getModelName(
                              seg.visualMode === 'image' ? pipeline.defaultImageModel : pipeline.defaultVideoModel,
                              seg.visualMode
                            )})</option>
                            {(seg.visualMode === 'image' ? imageModels : videoModels).map((m) => (
                              <option key={m.modelId} value={m.modelId}>{m.displayName}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>

                    {/* Image prompt */}
                    {seg.prompt !== null && (
                      <div className={styles.editorField}>
                        <label className={styles.editorLabel} htmlFor={`prompt-${seg.segmentId}`}>
                          Image Prompt
                        </label>
                        <textarea
                          id={`prompt-${seg.segmentId}`}
                          className={styles.editorTextarea}
                          value={seg.prompt ?? ''}
                          onChange={(e) => updateSegment(seg.segmentId, { prompt: e.target.value })}
                          rows={3}
                          aria-label={`Image prompt for segment ${seg.order}`}
                        />
                      </div>
                    )}

                    {/* End state prompt */}
                    {seg.endStatePrompt !== null && (
                      <div className={styles.editorField}>
                        <label className={styles.editorLabel} htmlFor={`endprompt-${seg.segmentId}`}>
                          End State Prompt
                        </label>
                        <textarea
                          id={`endprompt-${seg.segmentId}`}
                          className={styles.editorTextarea}
                          value={seg.endStatePrompt ?? ''}
                          onChange={(e) => updateSegment(seg.segmentId, { endStatePrompt: e.target.value })}
                          rows={2}
                          aria-label={`End state prompt for segment ${seg.order}`}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Transition editor */}
              {transition && (
                <div className={styles.transitionCard} data-enabled={transition.enabled}>
                  <div className={styles.transitionHeader}>
                    <label className={styles.transitionToggle}>
                      <input
                        type="checkbox"
                        checked={transition.enabled}
                        onChange={(e) => updateTransition(transition.fromSegmentOrder, transition.toSegmentOrder, {
                          enabled: e.target.checked,
                        })}
                        aria-label={`Enable transition between segment ${transition.fromSegmentOrder} and ${transition.toSegmentOrder}`}
                      />
                      <span className={styles.transitionLabel}>
                        Transition {seg.order} → {pipeline.segments[index + 1]?.order}
                      </span>
                    </label>
                    {transition.recommended && (
                      <span className={styles.recommendedBadge} title={transition.recommendationReason}>
                        Recommended
                      </span>
                    )}
                    {transition.enabled && (
                      <span className={styles.transitionCost}>
                        ${transition.estimatedCost.toFixed(3)}
                      </span>
                    )}
                  </div>

                  {transition.enabled && (
                    <div className={styles.transitionControls}>
                      {/* Transition model */}
                      <div className={styles.editorField}>
                        <label
                          className={styles.editorLabel}
                          htmlFor={`tmodel-${transition.fromSegmentOrder}-${transition.toSegmentOrder}`}
                        >
                          Transition Model
                        </label>
                        <select
                          id={`tmodel-${transition.fromSegmentOrder}-${transition.toSegmentOrder}`}
                          className={styles.editorSelect}
                          value={transition.transitionModel ?? ''}
                          onChange={(e) => updateTransition(transition.fromSegmentOrder, transition.toSegmentOrder, {
                            transitionModel: e.target.value || null,
                          })}
                          aria-label={`Transition model for ${transition.fromSegmentOrder} to ${transition.toSegmentOrder}`}
                        >
                          <option value="">Default</option>
                          {videoModels.map((m) => (
                            <option key={m.modelId} value={m.modelId}>{m.displayName}</option>
                          ))}
                        </select>
                      </div>

                      {/* Duration slider */}
                      <div className={styles.editorField}>
                        <label
                          className={styles.editorLabel}
                          htmlFor={`tdur-${transition.fromSegmentOrder}-${transition.toSegmentOrder}`}
                        >
                          Duration: {transition.durationSeconds}s
                        </label>
                        <input
                          id={`tdur-${transition.fromSegmentOrder}-${transition.toSegmentOrder}`}
                          type="range"
                          className={styles.slider}
                          min={0.5}
                          max={5}
                          step={0.5}
                          value={transition.durationSeconds}
                          onChange={(e) => updateTransition(transition.fromSegmentOrder, transition.toSegmentOrder, {
                            durationSeconds: Number(e.target.value),
                          })}
                          aria-label={`Transition duration for ${transition.fromSegmentOrder} to ${transition.toSegmentOrder}`}
                        />
                      </div>
                    </div>
                  )}

                  {transition.recommendationReason && (
                    <p className={styles.transitionReason}>{transition.recommendationReason}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.btnSecondary}
          onClick={validatePipeline}
          disabled={isBusy}
        >
          {panelStatus === 'validating' ? 'Validating...' : 'Validate & Recalculate'}
        </button>
        <button
          type="button"
          className={styles.btnGhost}
          onClick={classifyVisuals}
          disabled={isBusy}
        >
          {panelStatus === 'classifying' ? 'Reclassifying...' : 'Reclassify All'}
        </button>
      </div>

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
