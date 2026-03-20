'use client';

import { memo, useCallback, useState } from 'react';
import NextImage from 'next/image';
import { RotateCcw } from 'lucide-react';
import {
  VISUAL_TYPE_LABELS,
  VISUAL_TYPE_ICONS,
  BADGE_VARIANTS,
  TYPE_GROUPS,
  PROGRAMMATIC_TYPES,
} from './visual-editor-constants';
import type { EditableSegmentVisual } from './visual-editor-constants';
import { TransitionConnector } from './TransitionConnector';
import type { VisualTypeString } from '@/lib/visual-classifier';
import type { FalImageModelInfo, FalVideoModelInfo, VisualMode, PipelineTransition } from '@/types/pipeline';
import { Type } from 'lucide-react';
import styles from './SegmentDetailPanel.module.css';

interface SegmentDetailPanelProps {
  segment: EditableSegmentVisual;
  index: number;
  speakerIndex: number;
  voiceName: string | null;
  imageModels: FalImageModelInfo[];
  videoModels: FalVideoModelInfo[];
  defaultImageModel: string;
  defaultVideoModel: string;
  isDirty: boolean;
  transition: PipelineTransition | null;
  onUpdate: (segmentVisualId: string, updates: Partial<EditableSegmentVisual>) => void;
  onReset: (segmentVisualId: string) => void;
  onTransitionUpdate: (fromOrder: number, toOrder: number, updates: Partial<PipelineTransition>) => void;
}

function SegmentDetailPanelComponent({
  segment,
  index,
  speakerIndex,
  voiceName,
  imageModels,
  videoModels,
  defaultImageModel,
  defaultVideoModel,
  isDirty,
  transition,
  onUpdate,
  onReset,
  onTransitionUpdate,
}: SegmentDetailPanelProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

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
        visualMode = segment.visualMode === 'programmatic' ? 'image' : segment.visualMode;
        if (segment.model && !PROGRAMMATIC_TYPES.has(segment.visualType)) {
          model = segment.model;
        } else if (visualMode === 'video') {
          model = defaultVideoModel;
        } else {
          model = defaultImageModel;
        }
      } else {
        visualMode = 'image';
        model = null;
      }

      onUpdate(segment.segmentVisualId, { visualType, visualMode, model });
    },
    [segment.segmentVisualId, segment.visualMode, segment.visualType, segment.model, defaultImageModel, defaultVideoModel, onUpdate],
  );

  const handleModeChange = useCallback(
    (mode: VisualMode) => {
      if (mode === segment.visualMode) return;
      const model = mode === 'image' ? defaultImageModel : mode === 'video' ? defaultVideoModel : null;
      onUpdate(segment.segmentVisualId, { visualMode: mode, model });
    },
    [segment.segmentVisualId, segment.visualMode, defaultImageModel, defaultVideoModel, onUpdate],
  );

  const handleModelChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onUpdate(segment.segmentVisualId, { model: e.target.value || null });
    },
    [segment.segmentVisualId, onUpdate],
  );

  const handlePromptChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onUpdate(segment.segmentVisualId, { prompt: e.target.value || null });
    },
    [segment.segmentVisualId, onUpdate],
  );

  const isProgrammatic = segment.visualMode === 'programmatic';
  const models = segment.visualMode === 'image' ? imageModels : segment.visualMode === 'video' ? videoModels : [];
  const Icon = VISUAL_TYPE_ICONS[segment.visualType] || Type;
  const thumbnailSrc = segment.assetUrl || segment.firstFrameUrl;
  const showThumbnail = thumbnailSrc && !isProgrammatic;
  const isFailed = segment.status === 'failed';

  return (
    <div
      className={styles.root}
      role="tabpanel"
      id="segment-detail-panel"
      aria-label={`Scene ${index + 1} details`}
    >
      {/* Preview row: thumbnail + segment info */}
      <div className={styles.previewRow}>
        <div className={`${styles.largeThumb} ${isFailed ? styles.largeThumbFailed : ''}`}>
          {showThumbnail ? (
            <NextImage
              src={thumbnailSrc!}
              alt={`Scene ${index + 1} visual`}
              className={styles.thumbImage}
              fill
              sizes="240px"
            />
          ) : (
            <div className={styles.thumbPlaceholder}>
              <Icon size={32} strokeWidth={1.5} />
              <span className={styles.thumbLabel}>
                {VISUAL_TYPE_LABELS[segment.visualType]}
              </span>
            </div>
          )}
          {isFailed && <div className={styles.failedBadge}>Failed</div>}
        </div>

        <div className={styles.segmentInfo}>
          <div className={styles.headerRow}>
            <span className={styles.sceneNumber}>Scene {index + 1}</span>
            <span className={styles.speakerBadge} data-speaker-index={speakerIndex}>
              {segment.speaker}
            </span>
            {voiceName && (
              <span className={styles.voiceLabel}>{voiceName}</span>
            )}
            <span className={styles.durationBadge}>{segment.duration.toFixed(1)}s</span>
            {isDirty && <span className={styles.dirtyDot} title="Modified" />}
          </div>

          {isFailed && segment.failureReason ? (
            <p className={styles.failureReason}>{segment.failureReason}</p>
          ) : (
            <p className={styles.segmentText}>{segment.text}</p>
          )}
        </div>
      </div>

      {/* Visual type picker */}
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

      {/* Image / Video toggle */}
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

      {/* AI prompt preview (when not in advanced mode) */}
      {!isProgrammatic && !showAdvanced && segment.prompt && (
        <div>
          <span className={styles.fieldLabel}>AI prompt</span>
          <p className={styles.promptPreview}>{segment.prompt}</p>
        </div>
      )}

      {/* Advanced toggle + content */}
      {!isProgrammatic && (
        <div className={styles.advancedRow}>
          <button
            className={styles.advancedToggle}
            onClick={() => setShowAdvanced(!showAdvanced)}
            type="button"
            aria-expanded={showAdvanced}
          >
            {showAdvanced ? 'Hide advanced' : 'Show advanced'}
          </button>

          {isDirty && (
            <button
              className={styles.resetBtn}
              onClick={() => onReset(segment.segmentVisualId)}
              type="button"
            >
              <RotateCcw size={12} />
              Reset
            </button>
          )}
        </div>
      )}

      {showAdvanced && !isProgrammatic && (
        <div className={styles.advancedContent}>
          {models.length > 0 && (
            <div>
              <label className={styles.fieldLabel} htmlFor={`model-${segment.segmentVisualId}`}>
                Model
              </label>
              <select
                id={`model-${segment.segmentVisualId}`}
                className={styles.select}
                value={segment.model ?? ''}
                onChange={handleModelChange}
              >
                {!segment.model && (
                  <option value="" disabled>Select a model...</option>
                )}
                {models.map((m) => (
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
            <label className={styles.fieldLabel} htmlFor={`prompt-${segment.segmentVisualId}`}>
              Visual prompt
            </label>
            <textarea
              id={`prompt-${segment.segmentVisualId}`}
              className={styles.prompt}
              value={segment.prompt ?? ''}
              onChange={handlePromptChange}
              placeholder="Describe the visual..."
              rows={3}
            />
          </div>
        </div>
      )}

      {/* Programmatic reset */}
      {isProgrammatic && isDirty && (
        <div className={styles.advancedRow}>
          <button
            className={styles.resetBtn}
            onClick={() => onReset(segment.segmentVisualId)}
            type="button"
          >
            <RotateCcw size={12} />
            Reset
          </button>
        </div>
      )}

      {/* Transition connector */}
      {transition && (
        <TransitionConnector
          transition={transition}
          videoModels={videoModels}
          onUpdate={onTransitionUpdate}
        />
      )}
    </div>
  );
}

export const SegmentDetailPanel = memo(SegmentDetailPanelComponent);
