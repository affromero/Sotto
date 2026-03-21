'use client';

import { memo, useCallback, useState } from 'react';
import type { PipelineSegmentNode, PipelineSubVisualNode, FalImageModelInfo, FalVideoModelInfo, VisualMode } from '@/types/pipeline';
import type { VisualTypeString } from '@/lib/visual-classifier';
import { formatCost, getClipInfo } from '@/lib/video-cost-estimator';
import styles from './SegmentNode.module.css';

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
  DATA_TABLE: 'Data Table',
};

const PROGRAMMATIC_TYPES = new Set<VisualTypeString>([
  'DATA_CHART',
  'QUOTE',
  'COMPARISON',
  'TIMELINE',
  'DIAGRAM',
  'TEXT_CARD',
  'DATA_TABLE',
]);

// Color-coded badge variants — programmatic (green/teal) vs external (purple/navy/amber)
type BadgeVariant = 'purple' | 'amber' | 'navy' | 'green' | 'teal';
const BADGE_VARIANTS: Record<VisualTypeString, BadgeVariant> = {
  AI_ILLUSTRATION: 'purple',
  STOCK_FOOTAGE: 'navy',
  MAP_OVERLAY: 'amber',
  DATA_CHART: 'green',
  QUOTE: 'teal',
  COMPARISON: 'green',
  TIMELINE: 'teal',
  DIAGRAM: 'green',
  TEXT_CARD: 'teal',
  DATA_TABLE: 'green',
};

// Group visual types for the picker
const TYPE_GROUPS = [
  { label: 'AI-Generated', types: ['AI_ILLUSTRATION', 'STOCK_FOOTAGE', 'MAP_OVERLAY'] as VisualTypeString[] },
  { label: 'Programmatic', types: ['DATA_CHART', 'QUOTE', 'COMPARISON', 'TIMELINE', 'DIAGRAM', 'TEXT_CARD', 'DATA_TABLE'] as VisualTypeString[] },
];

function getBadgeClass(visualType: VisualTypeString): string {
  const variant = BADGE_VARIANTS[visualType] ?? 'amber';
  return styles[`badge${variant.charAt(0).toUpperCase()}${variant.slice(1)}`];
}

export interface StoryboardCardProps {
  segment: PipelineSegmentNode;
  index: number;
  speakerIndex: number;
  imageModels: FalImageModelInfo[];
  videoModels: FalVideoModelInfo[];
  defaultImageModel: string;
  defaultVideoModel: string;
  hasFalKey: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onUpdate: (segmentId: string, updates: Partial<PipelineSegmentNode>) => void;
  onSubVisualUpdate?: (segmentId: string, subOrder: number, updates: Partial<PipelineSubVisualNode>) => void;
}

function StoryboardCardComponent({
  segment,
  index,
  speakerIndex,
  imageModels,
  videoModels,
  defaultImageModel,
  defaultVideoModel,
  hasFalKey,
  isExpanded,
  onToggleExpand,
  onUpdate,
  onSubVisualUpdate,
}: StoryboardCardProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const hasMultipleSubVisuals = segment.subVisuals && segment.subVisuals.length > 1;

  const handleVisualTypeChange = useCallback(
    (visualType: VisualTypeString) => {
      const isProg = PROGRAMMATIC_TYPES.has(visualType);
      const isAiIllustration = visualType === 'AI_ILLUSTRATION';
      let visualMode: VisualMode;
      let model: string | null;

      if (isProg) {
        visualMode = 'programmatic';
        model = null;
      } else if (isAiIllustration) {
        // Keep current mode if already image/video, default to image from programmatic
        visualMode = segment.visualMode === 'programmatic' ? 'image' : segment.visualMode;
        // Keep current model if switching from another non-programmatic type; otherwise use plan default
        if (segment.model && !PROGRAMMATIC_TYPES.has(segment.visualType)) {
          model = segment.model;
        } else if (visualMode === 'video') {
          model = defaultVideoModel;
        } else {
          model = defaultImageModel;
        }
      } else {
        // STOCK_FOOTAGE, MAP_OVERLAY — no fal model, image mode
        visualMode = 'image';
        model = null;
      }

      onUpdate(segment.segmentId, { visualType, visualMode, model });
    },
    [segment.segmentId, segment.visualMode, segment.visualType, segment.model, defaultImageModel, defaultVideoModel, onUpdate],
  );

  const handleModeChange = useCallback(
    (mode: VisualMode) => {
      if (mode === segment.visualMode) return;
      const model = mode === 'image' ? defaultImageModel : mode === 'video' ? defaultVideoModel : null;
      onUpdate(segment.segmentId, { visualMode: mode, model });
    },
    [segment.segmentId, segment.visualMode, defaultImageModel, defaultVideoModel, onUpdate],
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
  const textPreview = segment.text.length > 100 ? `${segment.text.slice(0, 100)}...` : segment.text;
  const badgeClass = getBadgeClass(segment.visualType);

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
      {/* Collapsed row — clean single line like landing page */}
      <button
        id={headerId}
        className={styles.cardHeader}
        onClick={onToggleExpand}
        aria-expanded={isExpanded}
        aria-controls={panelId}
        type="button"
      >
        <span className={styles.sceneNumber} data-speaker-index={speakerIndex}>
          {index + 1}
        </span>
        <span className={styles.textPreview}>{textPreview}</span>
        {hasMultipleSubVisuals ? (
          <span className={styles.subVisualBadges}>
            {segment.subVisuals!.map((sv) => {
              const svBadgeClass = getBadgeClass(sv.visualType);
              return (
                <span key={sv.subOrder} className={`${styles.subVisualBadge} ${svBadgeClass}`}>
                  {VISUAL_TYPE_LABELS[sv.visualType]}
                </span>
              );
            })}
          </span>
        ) : (
          <span className={`${styles.typeBadge} ${badgeClass}`}>
            {VISUAL_TYPE_LABELS[segment.visualType]}
            {segment.visualType === 'AI_ILLUSTRATION' && segment.visualMode === 'video' && (
              <span className={styles.modeDot}> · Video</span>
            )}
          </span>
        )}
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div
          id={panelId}
          className={styles.expandedContent}
          role="region"
          aria-labelledby={headerId}
        >
          {/* Speaker + duration info */}
          <div className={styles.metaRow}>
            <span className={styles.speakerLabel} data-speaker-index={speakerIndex}>
              {segment.speaker}
            </span>
            <span className={styles.durationLabel}>{segment.duration.toFixed(1)}s</span>
            <span className={styles.segmentCost}>
              {formatCost(segment.estimatedCost)}
              {videoClipLabel && (
                <span className={styles.videoDurationHint}> ({videoClipLabel})</span>
              )}
            </span>
          </div>

          {/* Full text */}
          <p className={styles.fullText}>{segment.text}</p>

          {/* Sub-visuals breakdown — when multiple exist */}
          {hasMultipleSubVisuals ? (
            <div className={styles.subVisualList}>
              <span className={styles.fieldLabel}>
                {segment.subVisuals!.length} visual segments
              </span>
              {segment.subVisuals!.map((sv) => (
                <SubVisualRow
                  key={sv.subOrder}
                  sv={sv}
                  segmentId={segment.segmentId}
                  segmentDuration={segment.duration}
                  imageModels={imageModels}
                  videoModels={videoModels}
                  defaultImageModel={defaultImageModel}
                  defaultVideoModel={defaultVideoModel}
                  onSubVisualUpdate={onSubVisualUpdate}
                />
              ))}
            </div>
          ) : (
            <>
              {/* Single visual — full controls */}
              {/* Visual type picker — grouped */}
              <div>
                <span className={styles.fieldLabel}>Visual style</span>
                {TYPE_GROUPS.map((group) => (
                  <div key={group.label} className={styles.typeGroup}>
                    <span className={styles.typeGroupLabel}>{group.label}</span>
                    <div className={styles.typeGrid} role="group" aria-label={`${group.label} visual types`}>
                      {group.types.map((vt) => {
                        const variant = BADGE_VARIANTS[vt] ?? 'amber';
                        const pillClass = styles[`pill${variant.charAt(0).toUpperCase()}${variant.slice(1)}`];
                        return (
                          <button
                            key={vt}
                            className={`${styles.typePill} ${segment.visualType === vt ? `${styles.typePillActive} ${pillClass}` : ''}`}
                            onClick={() => handleVisualTypeChange(vt)}
                            type="button"
                            aria-pressed={segment.visualType === vt}
                          >
                            {VISUAL_TYPE_LABELS[vt]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* Image / Video toggle — only for AI Illustration */}
              {segment.visualType === 'AI_ILLUSTRATION' && (
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

              {/* AI prompt preview */}
              {!isProgrammatic && segment.prompt && !showAdvanced && (
                <div>
                  <span className={styles.fieldLabel}>AI prompt</span>
                  <p className={styles.promptPreview}>{segment.prompt}</p>
                </div>
              )}

              {/* Footer row: no-key hint + advanced toggle */}
              {!isProgrammatic && (
                <div className={styles.cardFooter}>
                  {!hasFalKey && (
                    <span className={styles.noKeyHint}>No API key — add in Settings to use your own</span>
                  )}
                  <button
                    className={styles.advancedToggle}
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    type="button"
                    aria-expanded={showAdvanced}
                  >
                    {showAdvanced ? 'Hide advanced' : 'Show advanced'}
                  </button>
                </div>
              )}

              {/* Advanced: Model + Prompt */}
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
                        {!segment.model && (
                          <option value="" disabled>Select a model...</option>
                        )}
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
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ---- Sub-visual row component ---- */

interface SubVisualRowProps {
  sv: PipelineSubVisualNode;
  segmentId: string;
  segmentDuration: number;
  imageModels: FalImageModelInfo[];
  videoModels: FalVideoModelInfo[];
  defaultImageModel: string;
  defaultVideoModel: string;
  onSubVisualUpdate?: (segmentId: string, subOrder: number, updates: Partial<PipelineSubVisualNode>) => void;
}

function SubVisualRowComponent({
  sv,
  segmentId,
  segmentDuration,
  imageModels,
  videoModels,
  defaultImageModel,
  defaultVideoModel,
  onSubVisualUpdate,
}: SubVisualRowProps) {
  const [expanded, setExpanded] = useState(false);
  const svBadgeClass = getBadgeClass(sv.visualType);
  const isProg = PROGRAMMATIC_TYPES.has(sv.visualType);
  const startSec = sv.startOffset.toFixed(1);
  const endSec = (sv.startOffset + sv.duration).toFixed(1);
  const models = sv.visualMode === 'image' ? imageModels : sv.visualMode === 'video' ? videoModels : [];

  const handleSvTypeChange = useCallback(
    (visualType: VisualTypeString) => {
      if (!onSubVisualUpdate) return;
      const newIsProg = PROGRAMMATIC_TYPES.has(visualType);
      let visualMode: VisualMode = newIsProg ? 'programmatic' : 'image';
      let model: string | null = null;
      if (!newIsProg && visualType === 'AI_ILLUSTRATION') {
        visualMode = sv.visualMode === 'programmatic' ? 'image' : sv.visualMode;
        model = visualMode === 'video' ? defaultVideoModel : defaultImageModel;
      }
      onSubVisualUpdate(segmentId, sv.subOrder, { visualType, visualMode, model });
    },
    [segmentId, sv.subOrder, sv.visualMode, defaultImageModel, defaultVideoModel, onSubVisualUpdate],
  );

  return (
    <div className={styles.subVisualRow}>
      <div className={styles.subVisualHeader}>
        <span className={styles.subVisualTime}>{startSec}s - {endSec}s</span>
        <span className={styles.subVisualDuration}>{sv.duration.toFixed(1)}s / {segmentDuration.toFixed(1)}s</span>
        <span className={`${styles.subVisualBadge} ${svBadgeClass}`}>
          {VISUAL_TYPE_LABELS[sv.visualType]}
        </span>
        {sv.estimatedCost > 0 && (
          <span className={styles.subVisualCost}>{formatCost(sv.estimatedCost)}</span>
        )}
        {!isProg && (
          <button
            className={styles.advancedToggle}
            onClick={() => setExpanded(!expanded)}
            type="button"
            aria-expanded={expanded}
          >
            {expanded ? 'Hide' : 'Edit'}
          </button>
        )}
      </div>

      {/* Prompt preview when not editing */}
      {sv.prompt && !expanded && (
        <p className={styles.subVisualPrompt}>{sv.prompt}</p>
      )}

      {/* Expanded edit controls */}
      {expanded && !isProg && (
        <div className={styles.subVisualEdit}>
          {/* Visual type picker */}
          <div className={styles.typeGrid} role="group" aria-label="Sub-visual type">
            {[...TYPE_GROUPS[0].types, ...TYPE_GROUPS[1].types].map((vt) => {
              const variant = BADGE_VARIANTS[vt] ?? 'amber';
              const pillClass = styles[`pill${variant.charAt(0).toUpperCase()}${variant.slice(1)}`];
              return (
                <button
                  key={vt}
                  className={`${styles.typePill} ${styles.typePillSmall} ${sv.visualType === vt ? `${styles.typePillActive} ${pillClass}` : ''}`}
                  onClick={() => handleSvTypeChange(vt)}
                  type="button"
                  aria-pressed={sv.visualType === vt}
                >
                  {VISUAL_TYPE_LABELS[vt]}
                </button>
              );
            })}
          </div>

          {/* Model selector */}
          {models.length > 0 && (
            <select
              className={styles.select}
              value={sv.model ?? ''}
              onChange={(e) => onSubVisualUpdate?.(segmentId, sv.subOrder, { model: e.target.value || null })}
            >
              {!sv.model && <option value="" disabled>Select a model...</option>}
              {models.map((m) => (
                <option key={m.modelId} value={m.modelId}>
                  {m.displayName} — {'pricePerImage' in m
                    ? `$${(m as FalImageModelInfo).pricePerImage}/img`
                    : `$${(m as FalVideoModelInfo).costPerMinute}/min`}
                </option>
              ))}
            </select>
          )}

          {/* Prompt editor */}
          <textarea
            className={styles.prompt}
            value={sv.prompt ?? ''}
            onChange={(e) => onSubVisualUpdate?.(segmentId, sv.subOrder, { prompt: e.target.value || null })}
            placeholder="Describe the visual..."
            rows={2}
          />
        </div>
      )}
    </div>
  );
}

const SubVisualRow = memo(SubVisualRowComponent);

export const SegmentNode = memo(StoryboardCardComponent);
