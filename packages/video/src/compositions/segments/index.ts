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
  [VisualType.DATA_CHART]: DataChart,
  [VisualType.QUOTE]: Quote,
  [VisualType.COMPARISON]: Comparison,
  [VisualType.TIMELINE]: Timeline,
  [VisualType.DIAGRAM]: Diagram,
  [VisualType.AI_ILLUSTRATION]: ImageSlide,
  [VisualType.STOCK_FOOTAGE]: ImageSlide,
  [VisualType.TEXT_CARD]: TextCard,
};

export function resolveSegmentComponent(
  visualType: string,
): React.FC<{ segment: VideoSegment }> {
  return SEGMENT_MAP[visualType] ?? TextCard;
}

export { DataChart, Quote, Comparison, Timeline, Diagram, ImageSlide, TextCard };
