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

const SEGMENT_MAP: Record<VisualTypeValue, React.FC<{ segment: VideoSegment }>> = {
  [VisualType.DATA_CHART]: React.memo(DataChart),
  [VisualType.QUOTE]: React.memo(Quote),
  [VisualType.COMPARISON]: React.memo(Comparison),
  [VisualType.TIMELINE]: React.memo(Timeline),
  [VisualType.DIAGRAM]: React.memo(Diagram),
  [VisualType.AI_ILLUSTRATION]: React.memo(ImageSlide),
  [VisualType.STOCK_FOOTAGE]: React.memo(ImageSlide),
  [VisualType.TEXT_CARD]: React.memo(TextCard),
};

export function resolveSegmentComponent(
  visualType: string,
): React.FC<{ segment: VideoSegment }> {
  return SEGMENT_MAP[visualType as VisualTypeValue] ?? TextCard;
}

export { DataChart, Quote, Comparison, Timeline, Diagram, ImageSlide, TextCard };
