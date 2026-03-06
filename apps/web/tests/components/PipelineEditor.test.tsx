import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PipelineEditor } from '@/components/player/PipelineEditor';
import type { VideoPipeline, FalModelsResponse, PipelineSegmentNode } from '@/types/pipeline';

vi.mock('@xyflow/react', () => {
  const Background = () => <div data-testid="rf-background" />;
  const Controls = () => <div data-testid="rf-controls" />;

  const ReactFlow = ({ nodes, children }: { nodes: Array<{ id: string; data: Record<string, unknown> }>; children: React.ReactNode }) => (
    <div data-testid="react-flow">
      {nodes.map((n) => {
        if (n.id.startsWith('segment-') && typeof n.data === 'object') {
          const SegNode = nodeTypes.segment;
          return <SegNode key={n.id} id={n.id} type="segment" data={n.data as Record<string, unknown>} />;
        }
        return <div key={n.id} data-testid={`node-${n.id}`} />;
      })}
      {children}
    </div>
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeTypes: Record<string, any> = {};

  return {
    ReactFlow: ({ nodes, nodeTypes: nt, children, ...rest }: Record<string, unknown>) => {
      Object.assign(nodeTypes, nt as Record<string, unknown>);
      return <ReactFlow nodes={nodes as Array<{ id: string; data: Record<string, unknown> }>} children={children as React.ReactNode} {...rest} />;
    },
    Background,
    Controls,
    Handle: ({ position }: { position: string }) => <div data-testid={`handle-${position}`} />,
    Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
    BackgroundVariant: { Dots: 'dots' },
  };
});

vi.mock('@/lib/speaker-colors', () => ({
  getSpeakerIndex: (speaker: string, all: string[]) => all.indexOf(speaker) % 4,
  getUniqueSpeakers: (items: Array<{ speaker: string }>) => {
    const seen = new Set<string>();
    return items.filter((i) => !seen.has(i.speaker) && seen.add(i.speaker)).map((i) => i.speaker);
  },
}));

function makeSegment(overrides: Partial<PipelineSegmentNode> = {}): PipelineSegmentNode {
  return {
    segmentId: 'seg-1',
    order: 0,
    speaker: 'Host',
    text: 'Hello world, this is a test segment with some text',
    duration: 5,
    visualType: 'AI_ILLUSTRATION',
    visualMode: 'image',
    model: 'fal-flux-2-pro',
    prompt: 'A test image',
    metadata: null,
    estimatedCost: 0.04,
    ...overrides,
  };
}

const defaultModels: FalModelsResponse = {
  imageModels: [
    { modelId: 'fal-recraft-v3', displayName: 'fal Recraft V3', pricePerImage: 0.02, defaultResolution: '1024x1024', qualityTier: 'standard' },
    { modelId: 'fal-flux-2-pro', displayName: 'fal FLUX 2 Pro', pricePerImage: 0.04, defaultResolution: '1024x1024', qualityTier: 'standard' },
  ],
  videoModels: [
    { modelId: 'fal-wan2.5-480p', displayName: 'FAL WAN 2.5 480p', costPerMinute: 3, resolution: '480p', maxDuration: 5, qualityMode: 'standard' },
  ],
  hasFalKey: true,
};

function makePipeline(segments: PipelineSegmentNode[]): VideoPipeline {
  return {
    version: 1,
    segments,
    totalEstimatedCost: segments.reduce((sum, s) => sum + s.estimatedCost, 0),
    defaultImageModel: 'fal-recraft-v3',
    defaultVideoModel: 'fal-wan2.5-480p',
  };
}

describe('PipelineEditor', () => {
  const onApprove = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders segment nodes for each pipeline segment', () => {
    const seg1 = makeSegment({ segmentId: 'seg-1', speaker: 'Host' });
    const seg2 = makeSegment({ segmentId: 'seg-2', speaker: 'Expert', order: 1 });
    const pipeline = makePipeline([seg1, seg2]);

    render(
      <PipelineEditor
        podcastId="pod-1"
        podcastTitle="Test"
        pipeline={pipeline}
        falModels={defaultModels}
        onApprove={onApprove}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText('Host')).toBeDefined();
    expect(screen.getByText('Expert')).toBeDefined();
  });

  it('approve button calls onApprove with current pipeline state', () => {
    const seg = makeSegment();
    const pipeline = makePipeline([seg]);

    render(
      <PipelineEditor
        podcastId="pod-1"
        podcastTitle="Test"
        pipeline={pipeline}
        falModels={defaultModels}
        onApprove={onApprove}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByText('Approve & Render'));
    expect(onApprove).toHaveBeenCalledTimes(1);
    const approved = onApprove.mock.calls[0][0] as VideoPipeline;
    expect(approved.segments).toHaveLength(1);
    expect(approved.version).toBe(1);
  });

  it('cancel button calls onCancel', () => {
    const pipeline = makePipeline([makeSegment()]);

    render(
      <PipelineEditor
        podcastId="pod-1"
        podcastTitle="Test"
        pipeline={pipeline}
        falModels={defaultModels}
        onApprove={onApprove}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('displays total cost in toolbar', () => {
    const seg = makeSegment({ estimatedCost: 0.04 });
    const pipeline = makePipeline([seg]);

    render(
      <PipelineEditor
        podcastId="pod-1"
        podcastTitle="Test"
        pipeline={pipeline}
        falModels={defaultModels}
        onApprove={onApprove}
        onCancel={onCancel}
      />,
    );

    const costElements = screen.getAllByText('$0.040');
    expect(costElements.length).toBeGreaterThanOrEqual(1);
  });
});
