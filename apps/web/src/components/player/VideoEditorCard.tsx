'use client';

import { memo, useCallback, useState } from 'react';
import NextImage from 'next/image';
import {
  ChevronDown, RotateCcw,
  Image as ImageIcon, Film, BarChart3, Quote, GitCompare, Clock, Network, Type,
} from 'lucide-react';
import type { VisualTypeString } from '@/lib/visual-classifier';
import type { FalImageModelInfo, FalVideoModelInfo, VisualMode } from '@/types/pipeline';
import styles from './VideoEditorCard.module.css';

const VISUAL_TYPES: VisualTypeString[] = [
  'AI_ILLUSTRATION', 'STOCK_FOOTAGE', 'DATA_CHART', 'QUOTE',
  'COMPARISON', 'TIMELINE', 'DIAGRAM', 'TEXT_CARD',
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
};

const VISUAL_TYPE_ICONS: Record<string, typeof ImageIcon> = {
  AI_ILLUSTRATION: ImageIcon,
  STOCK_FOOTAGE: Film,
  DATA_CHART: BarChart3,
  QUOTE: Quote,
  COMPARISON: GitCompare,
  TIMELINE: Clock,
  DIAGRAM: Network,
  TEXT_CARD: Type,
};

const PROGRAMMATIC_TYPES = new Set<VisualTypeString>([
  'DATA_CHART', 'QUOTE', 'COMPARISON', 'TIMELINE', 'DIAGRAM', 'TEXT_CARD',
]);

export interface EditableSegmentVisual {
  segmentVisualId: string;
  segmentId: string;
  speaker: string;
  text: string;
  duration: number;
  order: number;
  visualType: VisualTypeString;
  visualMode: VisualMode;
  model: string | null;
  prompt: string | null;
  assetUrl: string | null;
  assetType: string | null;
}

export interface VideoEditorCardProps {
  segment: EditableSegmentVisual;
  original: EditableSegmentVisual;
  index: number;
  speakerIndex: number;
  imageModels: FalImageModelInfo[];
  videoModels: FalVideoModelInfo[];
  hasFalKey: boolean;
  isExpanded: boolean;
  isDirty: boolean;
  onToggleExpand: () => void;
  onUpdate: (segmentVisualId: string, updates: Partial<EditableSegmentVisual>) => void;
  onReset: (segmentVisualId: string) => void;
}

function VideoEditorCardComponent({
  segment,
  index,
  speakerIndex,
  imageModels,
  videoModels,
  isExpanded,
  isDirty,
  onToggleExpand,
  onUpdate,
  onReset,
}: VideoEditorCardProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleVisualTypeChange = useCallback(
    (visualType: VisualTypeString) => {
      const isProgrammatic = PROGRAMMATIC_TYPES.has(visualType);
      onUpdate(segment.segmentVisualId, {
        visualType,
        visualMode: isProgrammatic ? 'programmatic' : segment.visualMode === 'programmatic' ? 'image' : segment.visualMode,
        model: isProgrammatic ? null : segment.model,
      });
    },
    [segment.segmentVisualId, segment.visualMode, segment.model, onUpdate],
  );

  const handleModeChange = useCallback(
    (mode: VisualMode) => {
      if (mode === segment.visualMode) return;
      let model: string | null = null;
      if (mode === 'image' && imageModels.length > 0) {
        model = imageModels.reduce((a, b) => (a.pricePerImage <= b.pricePerImage ? a : b)).modelId;
      } else if (mode === 'video' && videoModels.length > 0) {
        model = videoModels.reduce((a, b) => (a.costPerMinute <= b.costPerMinute ? a : b)).modelId;
      }
      onUpdate(segment.segmentVisualId, { visualMode: mode, model });
    },
    [segment.segmentVisualId, segment.visualMode, imageModels, videoModels, onUpdate],
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
  const textPreview = segment.text.length > 120 ? `${segment.text.slice(0, 120)}...` : segment.text;
  const Icon = VISUAL_TYPE_ICONS[segment.visualType] || Type;

  const showThumbnail = segment.assetUrl && !isProgrammatic;

  const headerId = `editor-header-${segment.segmentVisualId}`;
  const panelId = `editor-panel-${segment.segmentVisualId}`;

  const cardClass = [
    styles.card,
    isExpanded ? styles.cardExpanded : '',
    isDirty ? styles.cardDirty : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={cardClass}>
      <button
        id={headerId}
        className={styles.cardHeader}
        onClick={onToggleExpand}
        aria-expanded={isExpanded}
        aria-controls={panelId}
        type="button"
      >
        <div className={styles.thumbnail}>
          {showThumbnail ? (
            <NextImage
              src={segment.assetUrl!}
              alt={`Scene ${index + 1} visual`}
              className={styles.thumbnailImage}
              fill
              sizes="80px"
            />
          ) : (
            <div className={styles.thumbnailPlaceholder}>
              <Icon size={16} strokeWidth={1.5} />
              <span className={styles.thumbnailLabel}>
                {VISUAL_TYPE_LABELS[segment.visualType]?.split(' ')[0] ?? segment.visualType}
              </span>
            </div>
          )}
        </div>

        <div className={styles.headerInfo}>
          <div className={styles.headerTop}>
            <span className={styles.sceneNumber}>#{index + 1}</span>
            <span className={styles.speakerBadge} data-speaker-index={speakerIndex}>
              {segment.speaker}
            </span>
            <span className={styles.visualTypeBadge}>
              {VISUAL_TYPE_LABELS[segment.visualType]}
            </span>
            {isDirty && <span className={styles.dirtyDot} title="Modified" />}
          </div>
          <p className={styles.textPreview}>{textPreview}</p>
        </div>

        <div className={styles.headerMeta}>
          <span className={styles.duration}>{segment.duration.toFixed(1)}s</span>
          <ChevronDown
            size={16}
            className={`${styles.chevron} ${isExpanded ? styles.chevronOpen : ''}`}
            aria-hidden="true"
          />
        </div>
      </button>

      {isExpanded && (
        <div
          id={panelId}
          className={styles.expandedContent}
          role="region"
          aria-labelledby={headerId}
        >
          {/* Visual type pills */}
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
              <span className={styles.fieldLabel}>Output format</span>
              <div className={styles.modeToggle} role="group" aria-label="Output format">
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

          {/* Model + Prompt (advanced) */}
          {!isProgrammatic && !showAdvanced && segment.prompt && (
            <div>
              <span className={styles.fieldLabel}>AI prompt</span>
              <p className={styles.textPreview}>{segment.prompt}</p>
            </div>
          )}

          {!isProgrammatic && (
            <button
              className={styles.resetBtn}
              onClick={() => setShowAdvanced(!showAdvanced)}
              type="button"
              aria-expanded={showAdvanced}
            >
              {showAdvanced ? 'Hide advanced' : 'Advanced'}
            </button>
          )}

          {showAdvanced && !isProgrammatic && (
            <>
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
            </>
          )}

          {/* Footer with reset */}
          {isDirty && (
            <div className={styles.cardFooter}>
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
        </div>
      )}
    </div>
  );
}

export const VideoEditorCard = memo(VideoEditorCardComponent);
