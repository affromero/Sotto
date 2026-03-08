'use client';

import { memo, useCallback, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { PipelineSegmentNode, FalImageModelInfo, FalVideoModelInfo, VisualMode } from '@/types/pipeline';
import type { VisualTypeString } from '@/lib/visual-classifier';
import { formatCost, getClipInfo } from '@/lib/video-cost-estimator';
import styles from './SegmentNode.module.css';

const VISUAL_TYPES: VisualTypeString[] = [
  'AI_ILLUSTRATION',
  'STOCK_FOOTAGE',
  'DATA_CHART',
  'QUOTE',
  'COMPARISON',
  'TIMELINE',
  'DIAGRAM',
  'TEXT_CARD',
  'MAP_OVERLAY',
];

const VISUAL_TYPE_LABELS: Record<VisualTypeString, string> = {
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

const PROGRAMMATIC_TYPES = new Set<VisualTypeString>([
  'DATA_CHART',
  'QUOTE',
  'COMPARISON',
  'TIMELINE',
  'DIAGRAM',
  'TEXT_CARD',
]);

export interface StoryboardCardProps {
  segment: PipelineSegmentNode;
  index: number;
  speakerIndex: number;
  imageModels: FalImageModelInfo[];
  videoModels: FalVideoModelInfo[];
  hasFalKey: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onUpdate: (segmentId: string, updates: Partial<PipelineSegmentNode>) => void;
}

function StoryboardCardComponent({
  segment,
  index,
  speakerIndex,
  imageModels,
  videoModels,
  hasFalKey,
  isExpanded,
  onToggleExpand,
  onUpdate,
}: StoryboardCardProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleVisualTypeChange = useCallback(
    (visualType: VisualTypeString) => {
      const isProgrammatic = PROGRAMMATIC_TYPES.has(visualType);
      onUpdate(segment.segmentId, {
        visualType,
        visualMode: isProgrammatic ? 'programmatic' : segment.visualMode === 'programmatic' ? 'image' : segment.visualMode,
        model: isProgrammatic ? null : segment.model,
      });
    },
    [segment.segmentId, segment.visualMode, segment.model, onUpdate],
  );

  const handleModeChange = useCallback(
    (mode: VisualMode) => {
      if (mode === segment.visualMode) return;
      let model: string | null = null;
      if (mode === 'image' && imageModels.length > 0) {
        model = imageModels.reduce((a: FalImageModelInfo, b: FalImageModelInfo) => (a.pricePerImage <= b.pricePerImage ? a : b)).modelId;
      } else if (mode === 'video' && videoModels.length > 0) {
        model = videoModels.reduce((a: FalVideoModelInfo, b: FalVideoModelInfo) => (a.costPerMinute <= b.costPerMinute ? a : b)).modelId;
      }
      onUpdate(segment.segmentId, { visualMode: mode, model });
    },
    [segment.segmentId, segment.visualMode, imageModels, videoModels, onUpdate],
  );

  const handleModelChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onUpdate(segment.segmentId, { model: e.target.value || null });
    },
    [segment.segmentId, onUpdate],
  );

  const handlePromptChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onUpdate(segment.segmentId, { prompt: e.target.value || null });
    },
    [segment.segmentId, onUpdate],
  );

  const isProgrammatic = segment.visualMode === 'programmatic';
  const models = segment.visualMode === 'image' ? imageModels : segment.visualMode === 'video' ? videoModels : [];
  const textPreview = segment.text.length > 140 ? `${segment.text.slice(0, 140)}...` : segment.text;

  // Compute clip info for chained video segments
  const videoClipLabel = (() => {
    if (segment.visualMode !== 'video' || !segment.model) return null;
    const model = videoModels.find((m) => m.modelId === segment.model);
    if (!model) return null;
    const maxDur = model.maxDuration ?? 10;
    const { clipCount } = getClipInfo(segment.duration, maxDur);
    if (clipCount <= 1) return null;
    const perClipCost = (maxDur / 60) * model.costPerMinute;
    return `${clipCount} clips \u00d7 ${formatCost(perClipCost)}`;
  })();
  const headerId = `storyboard-header-${segment.segmentId}`;
  const panelId = `storyboard-panel-${segment.segmentId}`;

  return (
    <div className={`${styles.card} ${isExpanded ? styles.cardExpanded : ''}`}>
      <button
        id={headerId}
        className={styles.cardHeader}
        onClick={onToggleExpand}
        aria-expanded={isExpanded}
        aria-controls={panelId}
        type="button"
      >
        <span className={styles.sceneNumber}>Scene {index + 1}</span>
        <span className={styles.speakerBadge} data-speaker-index={speakerIndex}>
          {segment.speaker}
        </span>
        <p className={styles.textPreview}>{textPreview}</p>
        <span className={styles.visualTypeBadge}>
          {VISUAL_TYPE_LABELS[segment.visualType]}
          {!isProgrammatic && (
            <span className={styles.visualModeSuffix}>
              {segment.visualMode === 'video' ? 'Video' : 'Image'}
            </span>
          )}
        </span>
        <span className={styles.duration}>{segment.duration.toFixed(1)}s</span>
        <ChevronDown
          size={18}
          className={`${styles.chevron} ${isExpanded ? styles.chevronOpen : ''}`}
          aria-hidden="true"
        />
      </button>

      {isExpanded && (
        <div
          id={panelId}
          className={styles.expandedContent}
          role="region"
          aria-labelledby={headerId}
        >
          {/* Visual type pill grid */}
          <div>
            <span className={styles.fieldLabel}>Visual style</span>
            <div className={styles.typeGrid} role="group" aria-label="Visual type">
              {VISUAL_TYPES.map((vt) => (
                <button
                  key={vt}
                  className={`${styles.typePill} ${segment.visualType === vt ? styles.typePillActive : ''}`}
                  onClick={() => handleVisualTypeChange(vt)}
                  type="button"
                  aria-pressed={segment.visualType === vt}
                >
                  {VISUAL_TYPE_LABELS[vt]}
                </button>
              ))}
            </div>
          </div>

          {/* Image / Video toggle */}
          {!isProgrammatic && (
            <div>
              <span className={styles.fieldLabel}>Generate as</span>
              <div className={styles.modeToggle} role="group" aria-label="Generate as">
                <button
                  className={`${styles.modeBtn} ${segment.visualMode === 'image' ? styles.modeBtnActive : ''}`}
                  onClick={() => handleModeChange('image')}
                  type="button"
                  aria-pressed={segment.visualMode === 'image'}
                >
                  Image
                </button>
                <button
                  className={`${styles.modeBtn} ${segment.visualMode === 'video' ? styles.modeBtnActive : ''}`}
                  onClick={() => handleModeChange('video')}
                  type="button"
                  aria-pressed={segment.visualMode === 'video'}
                >
                  Video
                </button>
              </div>
            </div>
          )}

          {/* AI prompt (read-only by default) */}
          {!isProgrammatic && segment.prompt && !showAdvanced && (
            <div>
              <span className={styles.fieldLabel}>AI prompt</span>
              <p className={styles.promptPreview}>{segment.prompt}</p>
            </div>
          )}

          {/* Footer: cost + no-key hint + advanced toggle */}
          <div className={styles.cardFooter}>
            <span className={styles.segmentCost}>
              {formatCost(segment.estimatedCost)}
              {videoClipLabel && (
                <span className={styles.videoDurationHint}> ({videoClipLabel})</span>
              )}
            </span>
            {!isProgrammatic && !hasFalKey && (
              <span className={styles.noKeyHint}>Add Fal key in Settings</span>
            )}
            {!isProgrammatic && (
              <button
                className={styles.advancedToggle}
                onClick={() => setShowAdvanced(!showAdvanced)}
                type="button"
                aria-expanded={showAdvanced}
              >
                {showAdvanced ? 'Hide advanced' : 'Advanced'}
              </button>
            )}
          </div>

          {/* Layer 3: Advanced controls */}
          {showAdvanced && !isProgrammatic && (
            <div className={styles.advancedContent}>
              {models.length > 0 && (
                <div>
                  <label className={styles.fieldLabel} htmlFor={`model-${segment.segmentId}`}>
                    Model
                  </label>
                  <select
                    id={`model-${segment.segmentId}`}
                    className={styles.select}
                    value={segment.model ?? ''}
                    onChange={handleModelChange}
                  >
                    {models.map((m: FalImageModelInfo | FalVideoModelInfo) => (
                      <option key={m.modelId} value={m.modelId}>
                        {m.displayName} —{' '}
                        {'pricePerImage' in m
                          ? `$${(m as FalImageModelInfo).pricePerImage}/img`
                          : `$${(m as FalVideoModelInfo).costPerMinute}/min`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className={styles.fieldLabel} htmlFor={`prompt-${segment.segmentId}`}>
                  Visual prompt
                </label>
                <textarea
                  id={`prompt-${segment.segmentId}`}
                  className={styles.prompt}
                  value={segment.prompt ?? ''}
                  onChange={handlePromptChange}
                  placeholder="Describe the visual..."
                  rows={3}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const SegmentNode = memo(StoryboardCardComponent);
