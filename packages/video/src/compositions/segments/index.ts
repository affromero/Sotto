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
  DATA_CHART: React.memo(DataChart),
  QUOTE: React.memo(Quote),
  COMPARISON: React.memo(Comparison),
  TIMELINE: React.memo(Timeline),
  DIAGRAM: React.memo(Diagram),
  AI_ILLUSTRATION: React.memo(ImageSlide),
  STOCK_FOOTAGE: React.memo(ImageSlide),
  TEXT_CARD: React.memo(TextCard),
};

export function resolveSegmentComponent(
  visualType: string,
): React.FC<{ segment: VideoSegment }> {
  return SEGMENT_MAP[visualType] ?? TextCard;
}

export { DataChart, Quote, Comparison, Timeline, Diagram, ImageSlide, TextCard };
