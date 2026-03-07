import React from 'react';
import type { VideoSegment } from '../../types';
import { DataChart } from './DataChart';
import { Quote } from './Quote';
import { Comparison } from './Comparison';
import { Timeline } from './Timeline';
import { Diagram } from './Diagram';
import { ImageSlide } from './ImageSlide';
import { TextCard } from './TextCard';

const SEGMENT_MAP: Record<string, React.FC<{ segment: VideoSegment }>> = {
  DATA_CHART: DataChart,
  QUOTE: Quote,
  COMPARISON: Comparison,
  TIMELINE: Timeline,
  DIAGRAM: Diagram,
  AI_ILLUSTRATION: ImageSlide,
  STOCK_FOOTAGE: ImageSlide,
  TEXT_CARD: TextCard,
};

export function resolveSegmentComponent(
  visualType: string,
): React.FC<{ segment: VideoSegment }> {
  return SEGMENT_MAP[visualType] ?? TextCard;
}

export { DataChart, Quote, Comparison, Timeline, Diagram, ImageSlide, TextCard };
