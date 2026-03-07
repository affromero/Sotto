import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PipelineEditor } from '@/components/player/PipelineEditor';
import type { VideoPipeline, FalModelsResponse, PipelineSegmentNode } from '@/types/pipeline';

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

function renderEditor(segments: PipelineSegmentNode[], overrides: { onApprove?: () => void; onCancel?: () => void } = {}) {
  const onApprove = overrides.onApprove ?? vi.fn();
  const onCancel = overrides.onCancel ?? vi.fn();
  const pipeline = makePipeline(segments);

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

  return { onApprove, onCancel };
}

describe('PipelineEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // scrollIntoView is not implemented in jsdom
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('renders scene cards for each segment', () => {
    const seg1 = makeSegment({ segmentId: 'seg-1', speaker: 'Host' });
    const seg2 = makeSegment({ segmentId: 'seg-2', speaker: 'Expert', order: 1 });
    renderEditor([seg1, seg2]);

    expect(screen.getByText('Scene 1')).toBeDefined();
    expect(screen.getByText('Scene 2')).toBeDefined();
    expect(screen.getByText('Host')).toBeDefined();
    expect(screen.getByText('Expert')).toBeDefined();
  });

  it('shows Video Storyboard title', () => {
    renderEditor([makeSegment()]);
    expect(screen.getByText('Video Storyboard')).toBeDefined();
  });

  it('displays visual type badge for AI classification', () => {
    renderEditor([makeSegment({ visualType: 'AI_ILLUSTRATION' })]);
    expect(screen.getByText('AI Illustration')).toBeDefined();
  });

  it('displays approval summary with scene count and cost', () => {
    const seg1 = makeSegment({ segmentId: 'seg-1', duration: 5, estimatedCost: 0.04 });
    const seg2 = makeSegment({ segmentId: 'seg-2', duration: 8, estimatedCost: 0.02 });
    renderEditor([seg1, seg2]);

    expect(screen.getByText(/2 scenes.*~13s video.*est\./)).toBeDefined();
  });

  it('approve button calls onApprove with current pipeline state', () => {
    const onApprove = vi.fn();
    renderEditor([makeSegment()], { onApprove });

    fireEvent.click(screen.getByText('Approve & Render'));
    expect(onApprove).toHaveBeenCalledTimes(1);
    const approved = onApprove.mock.calls[0][0] as VideoPipeline;
    expect(approved.segments).toHaveLength(1);
    expect(approved.version).toBe(1);
  });

  it('cancel button calls onCancel', () => {
    const onCancel = vi.fn();
    renderEditor([makeSegment()], { onCancel });

    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('expanding a card shows visual type pills and prompt', () => {
    renderEditor([makeSegment({ prompt: 'A test image' })]);

    // Card starts collapsed — no pill grid visible
    expect(screen.queryByRole('group', { name: 'Visual type' })).toBeNull();

    // Click header to expand
    fireEvent.click(screen.getByText('Scene 1'));

    // Pill grid and prompt should now be visible
    expect(screen.getByRole('group', { name: 'Visual type' })).toBeDefined();
    expect(screen.getByText('A test image')).toBeDefined();
  });

  it('changing visual type via pill click updates the badge', () => {
    renderEditor([makeSegment({ visualType: 'AI_ILLUSTRATION' })]);

    // Expand card
    fireEvent.click(screen.getByText('Scene 1'));

    // Click "Stock Footage" pill
    fireEvent.click(screen.getByRole('button', { name: 'Stock Footage' }));

    // Badge in header should update
    const badges = screen.getAllByText('Stock Footage');
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it('displays cost in approval summary', () => {
    renderEditor([makeSegment({ estimatedCost: 0.04 })]);

    // Cost appears in the approval summary footer
    expect(screen.getByText(/est\.\s*\$0\.040/)).toBeDefined();
  });
});
