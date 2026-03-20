'use client';

import { memo } from 'react';
import NextImage from 'next/image';
import {
  Image as ImageIcon, Film, BarChart3, Quote, GitCompare, Clock, Network, Type, Map,
} from 'lucide-react';
import type { EditableSegmentVisual } from './VideoEditorCard';
import styles from './FilmstripBlock.module.css';

const VISUAL_TYPE_ICONS: Record<string, typeof ImageIcon> = {
  AI_ILLUSTRATION: ImageIcon,
  STOCK_FOOTAGE: Film,
  DATA_CHART: BarChart3,
  QUOTE: Quote,
  COMPARISON: GitCompare,
  TIMELINE: Clock,
  DIAGRAM: Network,
  TEXT_CARD: Type,
  MAP_OVERLAY: Map,
};

interface FilmstripBlockProps {
  segment: EditableSegmentVisual;
  index: number;
  speakerIndex: number;
  isSelected: boolean;
  isDirty: boolean;
  voiceName: string | null;
  widthPercent: number;
  onClick: () => void;
}

function FilmstripBlockComponent({
  segment,
  index,
  speakerIndex,
  isSelected,
  isDirty,
  voiceName,
  widthPercent,
  onClick,
}: FilmstripBlockProps) {
  const isFailed = segment.status === 'failed';
  const isProgrammatic = segment.visualMode === 'programmatic';
  const thumbnailSrc = segment.assetUrl || segment.firstFrameUrl;
  const showThumbnail = thumbnailSrc && !isProgrammatic;
  const Icon = VISUAL_TYPE_ICONS[segment.visualType] || Type;

  const blockClass = [
    styles.block,
    isSelected ? styles.blockSelected : '',
    isDirty ? styles.blockDirty : '',
    isFailed ? styles.blockFailed : '',
  ].filter(Boolean).join(' ');

  return (
    <button
      className={blockClass}
      style={{ '--block-width': `${widthPercent}%` } as React.CSSProperties}
      onClick={onClick}
      role="tab"
      aria-selected={isSelected}
      aria-label={`Scene ${index + 1}: ${segment.speaker}`}
      tabIndex={isSelected ? 0 : -1}
      type="button"
    >
      <div className={styles.thumbnail}>
        <span className={styles.sceneNumber}>#{index + 1}</span>
        {showThumbnail ? (
          <NextImage
            src={thumbnailSrc!}
            alt={`Scene ${index + 1}`}
            className={styles.thumbnailImage}
            fill
            sizes="120px"
          />
        ) : (
          <div className={styles.thumbnailPlaceholder}>
            <Icon size={18} strokeWidth={1.5} />
          </div>
        )}
        {isFailed && (
          <div className={styles.failedOverlay}>
            <span className={styles.failedIcon}>!</span>
          </div>
        )}
        {isDirty && <span className={styles.dirtyDot} />}
      </div>

      <div className={styles.speakerBar} data-speaker-index={speakerIndex} />

      <div className={styles.meta}>
        {voiceName ? (
          <span className={styles.voiceName}>{voiceName}</span>
        ) : (
          <span className={styles.voiceName}>{segment.speaker}</span>
        )}
        <span className={styles.duration}>{segment.duration.toFixed(1)}s</span>
      </div>
    </button>
  );
}

export const FilmstripBlock = memo(FilmstripBlockComponent);
