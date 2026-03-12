import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VideoEditor } from '@/components/player/VideoEditor';
import type { SegmentData } from '@/types/podcast';
import type { SegmentVisualData } from '@/lib/segment-utils';
import type { FalModelsResponse } from '@/types/pipeline';

vi.mock('@/components/player/VideoEditorCard', () => ({
  VideoEditorCard: ({
    segment,
    onToggleExpand,
  }: {
    segment: { segmentVisualId: string; speaker: string };
    onToggleExpand: () => void;
  }) => (
    <button type="button" data-segment-id={segment.segmentVisualId} onClick={onToggleExpand}>
      {segment.speaker}
    </button>
  ),
}));

vi.mock('@/components/player/TransitionConnector', () => ({
  TransitionConnector: () => null,
}));

const falModels: FalModelsResponse = {
  imageModels: [],
  videoModels: [],
  hasFalKey: true,
};

const segments: SegmentData[] = [
  {
    id: 'seg-1',
    speaker: 'HOST',
    text: 'First segment',
    audioUrl: null,
    order: 0,
    startTime: 0,
    duration: 5,
  },
  {
    id: 'seg-2',
    speaker: 'EXPERT',
    text: 'Second segment',
    audioUrl: null,
    order: 1,
    startTime: 5,
    duration: 6,
  },
];

const segmentVisuals: SegmentVisualData[] = [
  {
    id: 'sv-1',
    segmentId: 'seg-1',
    visualType: 'AI_ILLUSTRATION',
    visualMode: 'image',
    videoModel: null,
    prompt: 'Prompt 1',
    metadata: null,
    assetUrl: null,
    assetType: null,
    status: 'ready',
    order: 0,
  },
  {
    id: 'sv-2',
    segmentId: 'seg-2',
    visualType: 'STOCK_FOOTAGE',
    visualMode: 'image',
    videoModel: null,
    prompt: 'Prompt 2',
    metadata: null,
    assetUrl: null,
    assetType: null,
    status: 'ready',
    order: 1,
  },
];

describe('VideoEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith('/video') && (!init || !init.method || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ transitions: [] }),
        });
      }

      if (url.endsWith('/video') && init?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ videoGenerationId: 'vg-2' }),
        });
      }

      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }) as typeof fetch;

    Element.prototype.scrollIntoView = vi.fn();
  });

  it('regenerates every storyboard scene from the footer button', async () => {
    const onRegenerate = vi.fn();

    render(
      <VideoEditor
        podcastId="pod-1"
        segments={segments}
        segmentVisuals={segmentVisuals}
        falModels={falModels}
        onRegenerate={onRegenerate}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate Everything' }));

    await waitFor(() => {
      expect(onRegenerate).toHaveBeenCalledWith('vg-2');
    });

    expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
      '/api/podcasts/pod-1/video',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const patchCall = vi.mocked(global.fetch).mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(patchCall).toBeDefined();

    const requestBody = JSON.parse((patchCall?.[1]?.body as string) ?? '{}') as {
      segments: Array<{ segmentVisualId: string }>;
    };

    expect(requestBody.segments).toHaveLength(2);
    expect(requestBody.segments.map((segment) => segment.segmentVisualId)).toEqual(['sv-1', 'sv-2']);
  });
});
