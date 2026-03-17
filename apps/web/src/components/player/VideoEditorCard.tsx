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

// Match SegmentNode's grouped type picker with color-coded badges
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
};

const TYPE_GROUPS = [
  { label: 'AI-Generated', types: ['AI_ILLUSTRATION', 'STOCK_FOOTAGE', 'MAP_OVERLAY'] as VisualTypeString[] },
  { label: 'Programmatic', types: ['DATA_CHART', 'QUOTE', 'COMPARISON', 'TIMELINE', 'DIAGRAM', 'TEXT_CARD'] as VisualTypeString[] },
];

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
  defaultImageModel: string;
  defaultVideoModel: string;
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
  defaultImageModel,
  defaultVideoModel,
  isExpanded,
  isDirty,
  onToggleExpand,
  onUpdate,
  onReset,
}: VideoEditorCardProps) {
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
        // STOCK_FOOTAGE, MAP_OVERLAY — no fal model
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
          {/* Visual type picker — grouped, matching SegmentNode */}
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

          {/* Model + Prompt (advanced) */}
          {!isProgrammatic && !showAdvanced && segment.prompt && (
            <div>
              <span className={styles.fieldLabel}>AI prompt</span>
              <p className={styles.textPreview}>{segment.prompt}</p>
            </div>
          )}

          {!isProgrammatic && (
            <div className={styles.cardFooter}>
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
