import React from 'react';
import type { VideoSegment, VisualTypeValue } from '../../types';
import { VisualType } from '../../types';
import { DataChart } from './DataChart';
import { Quote } from './Quote';
import { Comparison } from './Comparison';
import { Timeline } from './Timeline';
import { Diagram } from './Diagram';
import { ImageSlide } from './ImageSlide';
import { TextCard } from './TextCard';
import { MapSlide } from './MapSlide';
import { DataTable } from './DataTable';

const SEGMENT_MAP: Record<VisualTypeValue, React.FC<{ segment: VideoSegment }>> = {
  [VisualType.DATA_CHART]: React.memo(DataChart),
  [VisualType.QUOTE]: React.memo(Quote),
  [VisualType.COMPARISON]: React.memo(Comparison),
  [VisualType.TIMELINE]: React.memo(Timeline),
  [VisualType.DIAGRAM]: React.memo(Diagram),
  [VisualType.AI_ILLUSTRATION]: React.memo(ImageSlide),
  [VisualType.STOCK_FOOTAGE]: React.memo(ImageSlide),
  [VisualType.TEXT_CARD]: React.memo(TextCard),
  [VisualType.MAP_OVERLAY]: React.memo(MapSlide),
  [VisualType.DATA_TABLE]: React.memo(DataTable),
};

const VIDEO_ASSET_TYPES = new Set(['video/mp4', 'video/webm']);

export function resolveSegmentComponent(
  visualType: string,
  assetUrl?: string | null,
  assetType?: string | null,
): React.FC<{ segment: VideoSegment }> {
  // Pre-rendered video (e.g. Hera motion graphic) takes priority
  if (assetUrl && assetType && VIDEO_ASSET_TYPES.has(assetType)) {
    return ImageSlide;
  }
  return SEGMENT_MAP[visualType as VisualTypeValue] ?? TextCard;
}

export { DataChart, Quote, Comparison, Timeline, Diagram, ImageSlide, TextCard, MapSlide, DataTable };
