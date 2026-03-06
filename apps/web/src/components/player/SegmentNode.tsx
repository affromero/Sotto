'use client';

import { memo, useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { PipelineSegmentNode, FalImageModelInfo, FalVideoModelInfo, VisualMode } from '@/types/pipeline';
import type { VisualTypeString } from '@/lib/visual-classifier';
import { formatCost } from '@/lib/video-cost-estimator';
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

const PROGRAMMATIC_TYPES = new Set<VisualTypeString>([
  'DATA_CHART',
  'QUOTE',
  'COMPARISON',
  'TIMELINE',
  'DIAGRAM',
  'TEXT_CARD',
]);

export interface SegmentNodeData {
  segment: PipelineSegmentNode;
  speakerIndex: number;
  imageModels: FalImageModelInfo[];
  videoModels: FalVideoModelInfo[];
  hasFalKey: boolean;
  onUpdate: (segmentId: string, updates: Partial<PipelineSegmentNode>) => void;
  [key: string]: unknown;
}

type SegmentNodeType = {
  id: string;
  type: 'segment';
  position: { x: number; y: number };
  data: SegmentNodeData;
};

function SegmentNodeComponent({ data }: NodeProps<SegmentNodeType>) {
  const { segment, speakerIndex, imageModels, videoModels, hasFalKey, onUpdate } = data;

  const handleVisualTypeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const visualType = e.target.value as VisualTypeString;
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
        model = imageModels.reduce((a, b) => (a.pricePerImage <= b.pricePerImage ? a : b)).modelId;
      } else if (mode === 'video' && videoModels.length > 0) {
        model = videoModels.reduce((a, b) => (a.costPerMinute <= b.costPerMinute ? a : b)).modelId;
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
  const textPreview = segment.text.length > 80 ? `${segment.text.slice(0, 80)}...` : segment.text;

  return (
    <div className={styles.node}>
      <Handle type="target" position={Position.Left} className={styles.handle} />

      <div className={styles.header}>
        <span className={styles.speakerBadge} data-speaker-index={speakerIndex}>
          {segment.speaker}
        </span>
        <span className={styles.duration}>{segment.duration.toFixed(1)}s</span>
      </div>

      <p className={styles.textPreview}>{textPreview}</p>

      <div className={styles.controls}>
        <select
          className={styles.select}
          value={segment.visualType}
          onChange={handleVisualTypeChange}
          aria-label="Visual type"
        >
          {VISUAL_TYPES.map((vt) => (
            <option key={vt} value={vt}>
              {VISUAL_TYPE_LABELS[vt]}
            </option>
          ))}
        </select>

        {!isProgrammatic && (
          <div className={styles.modeToggle} role="group" aria-label="Visual mode">
            <button
              className={`${styles.modeBtn} ${segment.visualMode === 'image' ? styles.modeBtnActive : ''}`}
              onClick={() => handleModeChange('image')}
              type="button"
            >
              Image
            </button>
            <button
              className={`${styles.modeBtn} ${segment.visualMode === 'video' ? styles.modeBtnActive : ''}`}
              onClick={() => handleModeChange('video')}
              type="button"
            >
              Video
            </button>
          </div>
        )}

        {!isProgrammatic && models.length > 0 && (
          <select
            className={styles.select}
            value={segment.model ?? ''}
            onChange={handleModelChange}
            aria-label="Model"
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
        )}

        {!isProgrammatic && (
          <textarea
            className={styles.prompt}
            value={segment.prompt ?? ''}
            onChange={handlePromptChange}
            placeholder="Visual prompt..."
            rows={2}
            aria-label="Visual prompt"
          />
        )}
      </div>

      <div className={styles.footer}>
        <span className={styles.cost}>{formatCost(segment.estimatedCost)}</span>
        {!isProgrammatic && !hasFalKey && (
          <span className={styles.noKeyHint}>Add Fal key in Settings</span>
        )}
      </div>

      <Handle type="source" position={Position.Right} className={styles.handle} />
    </div>
  );
}

export const SegmentNode = memo(SegmentNodeComponent);
