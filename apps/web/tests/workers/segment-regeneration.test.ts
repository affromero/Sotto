// @vitest-environment node
import type { Job } from 'bullmq';
import { expect, it } from 'vitest';
import { processSegmentRegeneration } from '@/workers/segment-regeneration.worker';

it.each(['regenerate_segment', 'segment-regeneration.v0', 'segment-regeneration.v2'])(
  'rejects unsupported job %s before provider or storage access',
  async (name) => {
    const job = { name, data: { episodeId: 'old-episode' } } as Job<unknown>;
    await expect(processSegmentRegeneration(job)).rejects.toThrow(
      'Unsupported segment regeneration job version'
    );
  }
);
