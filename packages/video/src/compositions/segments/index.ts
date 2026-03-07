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
  data_chart: React.memo(DataChart),
  quote: React.memo(Quote),
  comparison: React.memo(Comparison),
  timeline: React.memo(Timeline),
  diagram: React.memo(Diagram),
  image_slide: React.memo(ImageSlide),
  text_card: React.memo(TextCard),
};

export function resolveSegmentComponent(
  visualType: string,
): React.FC<{ segment: VideoSegment }> {
  return SEGMENT_MAP[visualType] ?? TextCard;
}

export { DataChart, Quote, Comparison, Timeline, Diagram, ImageSlide, TextCard };
