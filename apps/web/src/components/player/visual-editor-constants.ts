import {
  Image as ImageIcon, Film, BarChart3, Quote, GitCompare, Clock, Network, Type, Map,
} from 'lucide-react';
import type { VisualTypeString } from '@/lib/visual-classifier';
import type { VisualMode } from '@/types/pipeline';

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
  firstFrameUrl: string | null;
  status: string;
  failureReason: string | null;
}

export const VISUAL_TYPE_LABELS: Record<VisualTypeString, string> = {
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

export const VISUAL_TYPE_ICONS: Record<string, typeof ImageIcon> = {
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

export type BadgeVariant = 'purple' | 'amber' | 'navy' | 'green' | 'teal';

export const BADGE_VARIANTS: Record<VisualTypeString, BadgeVariant> = {
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

export const TYPE_GROUPS = [
  { label: 'AI-Generated', types: ['AI_ILLUSTRATION', 'STOCK_FOOTAGE', 'MAP_OVERLAY'] as VisualTypeString[] },
  { label: 'Programmatic', types: ['DATA_CHART', 'QUOTE', 'COMPARISON', 'TIMELINE', 'DIAGRAM', 'TEXT_CARD'] as VisualTypeString[] },
];

export const PROGRAMMATIC_TYPES = new Set<VisualTypeString>([
  'DATA_CHART', 'QUOTE', 'COMPARISON', 'TIMELINE', 'DIAGRAM', 'TEXT_CARD',
]);
